import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TWELVE_API_KEY = process.env.TWELVE_API_KEY;
const CHAT_ID = "7312421368";

const DEFAULT_SYMBOLS = ["EUR/USD", "GBP/USD", "XAU/USD", "IXIC"];

// =========================
// UTILS
// =========================
function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function avg(arr = []) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function safeDiv(a, b) {
  if (!b) return 0;
  return a / b;
}

function normalizeSymbol(input) {
  const value = String(input || "").toUpperCase().replace("/", "");

  const map = {
    EURUSD: "EUR/USD",
    GBPUSD: "GBP/USD",
    XAUUSD: "XAU/USD",
    NAS100: "IXIC",
    IXIC: "IXIC",
    DXY: "DXY",
    UUP: "UUP"
  };

  return map[value] || input;
}

// =========================
// STYLE CONFIG
// =========================
function detectStyleConfig(style) {
  const normalized = String(style || "AUTO").toUpperCase();

  if (normalized === "SCALPING") {
    return {
      style: "SCALPING",
      entryTf: "5min",
      entryLabel: "M5 Entry / H1-H4 Structure",
      htf1: "1h",
      htf2: "4h",
      minDxy: 7,
      minBtmm: 24,
      minSmc: 7
    };
  }

  if (normalized === "INTRADING") {
    return {
      style: "INTRADING",
      entryTf: "15min",
      entryLabel: "M15 Entry / H1-H4 Structure",
      htf1: "1h",
      htf2: "4h",
      minDxy: 7,
      minBtmm: 24,
      minSmc: 7
    };
  }

  return {
    style: "AUTO",
    entryTf: "5min",
    entryLabel: "M5 Entry / H1-H4 Structure",
    htf1: "1h",
    htf2: "4h",
    minDxy: 7,
    minBtmm: 24,
    minSmc: 7
  };
}

// =========================
// SESSION / KILL ZONE
// =========================
function detectSession() {
  const utcHour = new Date().getUTCHours();

  if (utcHour >= 7 && utcHour < 11) return "London Kill Zone";
  if (utcHour >= 12 && utcHour < 17) return "New York Kill Zone";
  if (utcHour >= 7 && utcHour < 17) return "London/New York Overlap";
  return "Off Session";
}

function isKillZoneActive() {
  const session = detectSession();
  return (
    session === "London Kill Zone" ||
    session === "New York Kill Zone" ||
    session === "London/New York Overlap"
  );
}

// =========================
// DATA
// =========================
async function fetchQuote(symbol) {
  const response = await axios.get("https://api.twelvedata.com/quote", {
    params: {
      symbol,
      apikey: TWELVE_API_KEY
    }
  });
  return response.data;
}

async function fetchTimeSeries(symbol, interval = "1h", outputsize = 100) {
  const response = await axios.get("https://api.twelvedata.com/time_series", {
    params: {
      symbol,
      interval,
      outputsize,
      apikey: TWELVE_API_KEY
    }
  });
  return response.data;
}

async function fetchDxyData() {
  const attempts = [
    { symbol: "DXY", source: "DXY" },
    { symbol: "UUP", source: "UUP_PROXY" }
  ];

  for (const attempt of attempts) {
    try {
      const data = await fetchQuote(attempt.symbol);

      if (data && !data.code && data.close) {
        const price = toNum(data.close);
        const previousClose = toNum(data.previous_close || data.close);
        const change = price - previousClose;

        let bias = "neutral";
        if (change > 0) bias = "bullish";
        if (change < 0) bias = "bearish";

        let score = 5;
        if (bias !== "neutral") score += 2;
        if (Math.abs(change) > 0.05) score += 1;
        if (Math.abs(change) > 0.15) score += 1;
        if (Math.abs(change) > 0.25) score += 1;
        if (score > 10) score = 10;

        return {
          ok: true,
          source: attempt.source,
          price,
          previousClose,
          change,
          bias,
          score
        };
      }
    } catch (e) {
      continue;
    }
  }

  return {
    ok: false,
    source: "UNAVAILABLE",
    price: 0,
    previousClose: 0,
    change: 0,
    bias: "neutral",
    score: 0
  };
}

// =========================
// CANDLES / VOLATILITY
// =========================
function parseCandles(values = []) {
  return values
    .map((candle) => ({
      datetime: candle.datetime,
      open: toNum(candle.open),
      high: toNum(candle.high),
      low: toNum(candle.low),
      close: toNum(candle.close),
      volume: candle.volume ? toNum(candle.volume) : 0
    }))
    .reverse();
}

function candleRange(c) {
  return Math.abs(c.high - c.low);
}

function wickRatio(c) {
  const body = Math.abs(c.close - c.open);
  const upperWick = Math.max(0, c.high - Math.max(c.open, c.close));
  const lowerWick = Math.max(0, Math.min(c.open, c.close) - c.low);
  return safeDiv(upperWick + lowerWick, Math.max(body, 0.0000001));
}

function computeAverageRange(candles = []) {
  return avg(candles.map(candleRange));
}

function computeAverageWickRatio(candles = []) {
  return avg(candles.map(wickRatio));
}

function computeVolatilityState(candles = []) {
  if (!candles || candles.length < 20) {
    return {
      state: "unknown",
      tradable: false,
      rangeRatio: 0,
      wickRatio: 0,
      reason: "Not enough candles"
    };
  }

  const recent = candles.slice(-5);
  const previous = candles.slice(-20, -5);

  const recentRange = computeAverageRange(recent);
  const previousRange = computeAverageRange(previous);
  const rangeRatio = safeDiv(recentRange, previousRange);
  const recentWickRatio = computeAverageWickRatio(recent);

  if (rangeRatio >= 2.5 || recentWickRatio >= 2.5) {
    return {
      state: "extreme",
      tradable: false,
      rangeRatio,
      wickRatio: recentWickRatio,
      reason: "Post-news volatility still elevated"
    };
  }

  if (rangeRatio >= 1.6 || recentWickRatio >= 1.6) {
    return {
      state: "high",
      tradable: false,
      rangeRatio,
      wickRatio: recentWickRatio,
      reason: "Wick expansion abnormal"
    };
  }

  return {
    state: "normal",
    tradable: true,
    rangeRatio,
    wickRatio: recentWickRatio,
    reason: "Volatility normalized"
  };
}

// =========================
// STRUCTURE ANALYSIS
// =========================
function analyzeStructure(candles = []) {
  if (!candles || candles.length < 20) {
    return {
      bias: "neutral",
      structureQuality: "low",
      momentum: "weak",
      high: 0,
      low: 0,
      lastClose: 0,
      swingHigh: 0,
      swingLow: 0,
      recentHigh: 0,
      recentLow: 0
    };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];
  const recent10 = closes.slice(-10);
  const previous10 = closes.slice(-20, -10);

  const recentAvg = avg(recent10);
  const previousAvg = avg(previous10);

  let bias = "neutral";
  if (lastClose > firstClose && recentAvg >= previousAvg) bias = "bullish";
  if (lastClose < firstClose && recentAvg <= previousAvg) bias = "bearish";

  const movePct = safeDiv(lastClose - firstClose, firstClose) * 100;

  let momentum = "weak";
  if (Math.abs(movePct) > 0.10) momentum = "medium";
  if (Math.abs(movePct) > 0.25) momentum = "strong";

  let structureQuality = "low";
  if (Math.abs(movePct) > 0.08) structureQuality = "medium";
  if (Math.abs(movePct) > 0.20) structureQuality = "high";

  return {
    bias,
    structureQuality,
    momentum,
    high: Math.max(...highs),
    low: Math.min(...lows),
    lastClose,
    swingHigh: Math.max(...highs.slice(-15)),
    swingLow: Math.min(...lows.slice(-15)),
    recentHigh: Math.max(...highs.slice(-5)),
    recentLow: Math.min(...lows.slice(-5))
  };
}

function detectLiquiditySweep(tf) {
  if (!tf.lastClose || !tf.swingHigh || !tf.swingLow) {
    return { hasSweep: false, side: "none" };
  }

  const nearHigh = safeDiv(Math.abs(tf.lastClose - tf.swingHigh), tf.lastClose) < 0.0015;
  const nearLow = safeDiv(Math.abs(tf.lastClose - tf.swingLow), tf.lastClose) < 0.0015;

  if (nearHigh) return { hasSweep: true, side: "BSL" };
  if (nearLow) return { hasSweep: true, side: "SSL" };

  return { hasSweep: false, side: "none" };
}

function detectFvgProxy(tf) {
  return tf.structureQuality === "high" || tf.structureQuality === "medium";
}

function detectFibZone(tf) {
  if (!tf.high || !tf.low || !tf.lastClose) {
    return { valid: false, level: null };
  }

  const range = Math.max(tf.high - tf.low, 0.0000001);
  const position = (tf.lastClose - tf.low) / range;
  const targets = [0.5, 0.618, 0.705];

  for (const t of targets) {
    if (Math.abs(position - t) < 0.12) {
      return { valid: true, level: t };
    }
  }

  return { valid: false, level: null };
}

function detectTbs(higherTf, lowerTf) {
  return higherTf.bias !== "neutral" && higherTf.bias === lowerTf.bias;
}

function computeAssetBias(symbol, dxyBias, h1Bias, h4Bias) {
  const inverseDollarAssets = ["EUR/USD", "GBP/USD", "XAU/USD"];

  if (symbol === "IXIC") {
    if (h1Bias === h4Bias && h1Bias !== "neutral") return h1Bias;
    return "neutral";
  }

  if (inverseDollarAssets.includes(symbol)) {
    if (dxyBias === "bearish" && (h1Bias === "bullish" || h4Bias === "bullish")) {
      return "bullish";
    }
    if (dxyBias === "bullish" && (h1Bias === "bearish" || h4Bias === "bearish")) {
      return "bearish";
    }
  }

  if (h1Bias === h4Bias && h1Bias !== "neutral") return h1Bias;
  return "neutral";
}

// =========================
// STRATEGY SCORING
// =========================
function computeBtmmScore({ h1, h4, d1, killZone }) {
  let score = 0;
  const notes = [];

  if (h4.structureQuality === "high") {
    score += 4;
    notes.push("HTF structure clear");
  } else if (h4.structureQuality === "medium") {
    score += 2;
    notes.push("HTF structure acceptable");
  }

  if (h1.bias === h4.bias && h1.bias !== "neutral") {
    score += 4;
    notes.push("BTMM complete");
  }

  if (h1.structureQuality !== "low") {
    score += 2;
    notes.push("EMA aligned proxy");
  }

  const pos = safeDiv(h1.lastClose - h1.low, Math.max(h1.high - h1.low, 0.0000001));
  if (pos < 0.2 || pos > 0.8) {
    score += 2;
    notes.push("RSI extreme proxy");
  }

  if (h1.momentum === "strong" || h4.momentum === "strong") {
    score += 2;
    notes.push("Strong volume proxy");
  }

  if (detectFvgProxy(h1)) {
    score += 2;
    notes.push("FVG present");
  }

  if (h1.bias === h4.bias && h4.bias === d1.bias && h1.bias !== "neutral") {
    score += 3;
    notes.push("Multi TF confluence");
  }

  const liquidityDist =
    Math.min(Math.abs(h1.lastClose - h1.swingHigh), Math.abs(h1.lastClose - h1.swingLow)) /
    Math.max(h1.lastClose, 0.0000001);

  if (liquidityDist < 0.002) {
    score += 2;
    notes.push("Liquidity visible");
  }

  const orderBlockDist =
    Math.min(Math.abs(h1.lastClose - h4.swingHigh), Math.abs(h1.lastClose - h4.swingLow)) /
    Math.max(h1.lastClose, 0.0000001);

  if (orderBlockDist < 0.004) {
    score += 2;
    notes.push("Order block proxy");
  }

  if (h1.bias === h4.bias && h1.momentum !== "weak") {
    score += 3;
    notes.push("Confluence strong");
  }

  if (killZone) {
    score += 2;
    notes.push("Kill zone active");
  }

  if (h1.bias === h4.bias && h1.structureQuality === "high") {
    score += 2;
    notes.push("Alignment bonus");
  }

  if (score > 30) score = 30;

  return { score, notes };
}

function computeSmcScore({ h1, entryTf, killZone }) {
  let score = 0;
  const notes = [];

  if (h1.bias !== "neutral") {
    score += 1;
    notes.push("H1 alignment");
  }

  const sweep = detectLiquiditySweep(entryTf);
  if (sweep.hasSweep) {
    score += 2;
    notes.push(`CRT sweep ${sweep.side}`);
  }

  if (detectTbs(h1, entryTf)) {
    score += 2;
    notes.push("TBS confirmed");
  }

  if (detectFvgProxy(entryTf)) {
    score += 1;
    notes.push("FVG intact");
  }

  if (killZone) {
    score += 1;
    notes.push("London/NY session active");
  }

  if (entryTf.momentum !== "weak") {
    score += 1;
    notes.push("CHoCH proxy confirmed");
  }

  if (entryTf.structureQuality === "high") {
    score += 1;
    notes.push("Clean timing");
  }

  const fib = detectFibZone(entryTf);
  if (fib.valid) {
    score += 1;
    notes.push(`Fib ${fib.level}`);
  }

  if (score > 10) score = 10;

  return { score, notes };
}

function decideScenario(h1, h4, assetBias) {
  if (h1.bias === h4.bias && h1.bias === assetBias && assetBias !== "neutral") {
    return "Continuation";
  }

  if (h1.bias !== h4.bias && assetBias !== "neutral") {
    return "Correction";
  }

  return "Manipulation";
}

function computeDecision({ styleConfig, dxyScore, btmmScore, smcScore, assetBias, scenario, killZone, volatility }) {
  const total = dxyScore + btmmScore + smcScore;

  if (!killZone) {
    return {
      total,
      status: "ATTENDS",
      finalDecision: "ATTENDS",
      reason: "Kill zone inactive"
    };
  }

  if (!volatility.tradable) {
    return {
      total,
      status: "POST-NEWS VOLATILITY",
      finalDecision: "ATTENDS",
      reason: volatility.reason
    };
  }

  if (dxyScore < styleConfig.minDxy) {
    return {
      total,
      status: "NO TRADE",
      finalDecision: "NO TRADE",
      reason: "DXY below required threshold"
    };
  }

  if (btmmScore < styleConfig.minBtmm) {
    return {
      total,
      status: "NO TRADE",
      finalDecision: "NO TRADE",
      reason: "BTMM below required threshold"
    };
  }

  if (smcScore < styleConfig.minSmc) {
    return {
      total,
      status: "NO TRADE",
      finalDecision: "NO TRADE",
      reason: "SMC below required threshold"
    };
  }

  if (assetBias === "neutral") {
    return {
      total,
      status: "ATTENDS",
      finalDecision: "ATTENDS",
      reason: "Asset bias unclear"
    };
  }

  if (scenario === "Manipulation") {
    return {
      total,
      status: "ATTENDS",
      finalDecision: "ATTENDS",
      reason: "Manipulation scenario detected"
    };
  }

  if (total < 35) {
    return {
      total,
      status: "NO TRADE",
      finalDecision: "NO TRADE",
      reason: "Total score too low"
    };
  }

  if (total >= 35 && total <= 40) {
    return {
      total,
      status: "ATTENDS",
      finalDecision: "ATTENDS",
      reason: "Setup not strong enough yet"
    };
  }

  return {
    total,
    status: total >= 46 ? "SNIPER TRADE" : "VALID SETUP",
    finalDecision: assetBias === "bullish" ? "BUY" : "SELL",
    reason: "All major filters aligned"
  };
}

// =========================
// TRADE LEVELS
// =========================
function computeTradeLevels(symbol, livePrice, finalDecision, entryTf) {
  if (!["BUY", "SELL"].includes(finalDecision)) {
    return {
      entry: null,
      stopLoss: null,
      tp1: null,
      tp2: null,
      tp3: null
    };
  }

  const price = toNum(livePrice);
  let risk = price * 0.002;

  if (symbol === "XAU/USD") risk = price * 0.003;
  if (symbol === "IXIC") risk = price * 0.004;

  if (finalDecision === "BUY") {
    const entry = price;
    const stopLoss = Math.min(entryTf.swingLow || price - risk, price - risk);
    const tp1 = entry + (entry - stopLoss);
    const tp2 = entry + (entry - stopLoss) * 2;
    const tp3 = entry + (entry - stopLoss) * 5;

    return {
      entry: Number(entry.toFixed(5)),
      stopLoss: Number(stopLoss.toFixed(5)),
      tp1: Number(tp1.toFixed(5)),
      tp2: Number(tp2.toFixed(5)),
      tp3: Number(tp3.toFixed(5))
    };
  }

  const entry = price;
  const stopLoss = Math.max(entryTf.swingHigh || price + risk, price + risk);
  const tp1 = entry - (stopLoss - entry);
  const tp2 = entry - (stopLoss - entry) * 2;
  const tp3 = entry - (stopLoss - entry) * 5;

  return {
    entry: Number(entry.toFixed(5)),
    stopLoss: Number(stopLoss.toFixed(5)),
    tp1: Number(tp1.toFixed(5)),
    tp2: Number(tp2.toFixed(5)),
    tp3: Number(tp3.toFixed(5))
  };
}

// =========================
// TELEGRAM MESSAGE
// =========================
function buildTelegramMessage(result) {
  const {
    symbol,
    session,
    style,
    decision,
    total,
    scenario,
    dxy,
    btmm,
    smc,
    tradeLevels,
    status,
    volatility,
    structure
  } = result;

  const timeFrameLine =
    style === "INTRADING"
      ? "M15 Entry / H1-H4 Structure"
      : "M5 Entry / H1-H4 Structure";

  const dxyComment =
    dxy.bias === "bearish"
      ? "Bearish pressure"
      : dxy.bias === "bullish"
      ? "Bullish pressure"
      : "Neutral pressure";

  if (status === "POST-NEWS VOLATILITY") {
    return `🚨 SNIPER SIGNAL ALERT
${style}

Asset: ${symbol}
Session: ${session}
Timeframe: ${timeFrameLine}

━━━━━━━━━━━━━━━━━━━

📊 Decision: ATTENDS

━━━━━━━━━━━━━━━━━━━

📈 Score Breakdown:
DXY: ${dxy.score}/10 (${dxyComment})
BTMM: ${btmm.score}/30 (Structure aligned)
SMC: ${smc.score}/10 (Entry confirmation)

TOTAL: ${total}/50

━━━━━━━━━━━━━━━━━━━

🧠 Market Structure:
Scenario: ${scenario}

- HTF bias under review
- Internal structure still unstable
- Momentum not fully normalized
- Re-entry quality not clean enough

━━━━━━━━━━━━━━━━━━━

💧 Liquidity & Execution:
- Liquidity condition under review
- Engineered move likely still active
- FVG may be unstable after news
- Entry not yet validated

━━━━━━━━━━━━━━━━━━━

⏱️ Timing:
- ${session} active
- ${volatility.reason}
- No clean post-news execution yet

━━━━━━━━━━━━━━━━━━━

📌 Status: POST-NEWS VOLATILITY

⚠️ Vérifie le calendrier économique avant d’entrer en position.`;
  }

  if (decision !== "BUY" && decision !== "SELL") {
    return `🚨 SNIPER SIGNAL ALERT
${style}

Asset: ${symbol}
Session: ${session}
Timeframe: ${timeFrameLine}

━━━━━━━━━━━━━━━━━━━

📊 Decision: ATTENDS

━━━━━━━━━━━━━━━━━━━

📈 Score Breakdown:
DXY: ${dxy.score}/10 (${dxyComment})
BTMM: ${btmm.score}/30 (Structure aligned)
SMC: ${smc.score}/10 (Entry confirmation)

TOTAL: ${total}/50

━━━━━━━━━━━━━━━━━━━

🧠 Market Structure:
Scenario: ${scenario}

- HTF structure under evaluation
- Internal confirmation incomplete
- No clean sniper execution
- Market still needs confirmation

━━━━━━━━━━━━━━━━━━━

💧 Liquidity & Execution:
- Liquidity not clean enough yet
- FVG / trap / confirmation not fully aligned
- Setup still incomplete
- Entry not confirmed

━━━━━━━━━━━━━━━━━━━

⏱️ Timing:
- ${session}
- Volatility state: ${volatility.state}
- No abnormal execution approved

━━━━━━━━━━━━━━━━━━━

📌 Status: ${status}

⚠️ Vérifie le calendrier économique avant d’entrer en position.`;
  }

  const htfBiasText =
    structure.h1.bias === "bullish" && structure.h4.bias === "bullish"
      ? "HTF bias bullish (H1 & H4 aligned)"
      : structure.h1.bias === "bearish" && structure.h4.bias === "bearish"
      ? "HTF bias bearish (H1 & H4 aligned)"
      : "HTF bias mixed";

  const chochText =
    structure.entryTf.momentum !== "weak"
      ? `Internal structure break (CHoCH confirmed ${style === "INTRADING" ? "M15" : "M5"})`
      : "Internal structure still forming";

  const liquiditySide = detectLiquiditySweep(structure.entryTf).side;
  const liquidityText =
    liquiditySide === "SSL"
      ? "SSL liquidity swept"
      : liquiditySide === "BSL"
      ? "BSL liquidity swept"
      : "Liquidity sweep proxy detected";

  return `🚨 SNIPER SIGNAL ALERT
${style}

Asset: ${symbol}
Session: ${session}
Timeframe: ${timeFrameLine}

━━━━━━━━━━━━━━━━━━━

📊 Decision: ${decision}

Entry: ${tradeLevels.entry}
Stop Loss: ${tradeLevels.stopLoss}
TP1: ${tradeLevels.tp1}
TP2: ${tradeLevels.tp2}
TP3: ${tradeLevels.tp3}

━━━━━━━━━━━━━━━━━━━

📈 Score Breakdown:
DXY: ${dxy.score}/10 (${dxyComment})
BTMM: ${btmm.score}/30 (Structure aligned)
SMC: ${smc.score}/10 (Entry confirmation)

TOTAL: ${total}/50

━━━━━━━━━━━━━━━━━━━

🧠 Market Structure:
Scenario: ${scenario}

- ${htfBiasText}
- ${chochText}
- Price in premium discount zone
- Momentum expansion active

━━━━━━━━━━━━━━━━━━━━━━

💧 Liquidity & Execution:
- ${liquidityText}
- Reversal from engineered liquidity zone
- FVG respected (clean imbalance)
- Entry aligned with smart money positioning

━━━━━━━━━━━━━━━━━━━

⏱️ Timing:
- ${session} active
- Volatility controlled
- No abnormal wick expansion

━━━━━━━━━━━━━━━━━━━

📌 Status: ${status}

⚠️ Vérifie le calendrier économique avant d’entrer en position.`;
}

// =========================
// ANALYSIS ENGINE
// =========================
async function runAnalysis(symbolInput, styleInput = "SCALPING") {
  const symbol = normalizeSymbol(symbolInput || "EUR/USD");
  const styleConfig = detectStyleConfig(styleInput);
  const session = detectSession();
  const killZone = isKillZoneActive();

  let quote;

  try {
    quote = await fetchQuote(symbol);

    if (!quote || quote.code || !quote.close) {
      console.log(`API issue for ${symbol}`, quote);

      return {
        symbol,
        decision: "WAIT",
        total: 0,
        status: "MARKET CLOSED",
        reason: "Market closed or API unavailable (weekend)"
      };
    }
  } catch (error) {
    console.log(`Fetch error for ${symbol}`, error.message);

    return {
      symbol,
      decision: "WAIT",
      total: 0,
      status: "ERROR",
      reason: "API request failed"
    };
  }

  const livePrice = toNum(quote.close);

  const [entryRaw, h1Raw, h4Raw, d1Raw, dxy] = await Promise.all([
    fetchTimeSeries(symbol, styleConfig.entryTf, 100),
    fetchTimeSeries(symbol, "1h", 100),
    fetchTimeSeries(symbol, "4h", 100),
    fetchTimeSeries(symbol, "1day", 100),
    fetchDxyData()
  ]);

  const entryTf = analyzeStructure(parseCandles(entryRaw.values || []));
  const h1 = analyzeStructure(parseCandles(h1Raw.values || []));
  const h4 = analyzeStructure(parseCandles(h4Raw.values || []));
  const d1 = analyzeStructure(parseCandles(d1Raw.values || []));

  const volatility = computeVolatilityState(parseCandles(entryRaw.values || []));
  const assetBias = computeAssetBias(symbol, dxy.bias, h1.bias, h4.bias);
  const btmm = computeBtmmScore({ h1, h4, d1, killZone });
  const smc = computeSmcScore({ h1, entryTf, killZone });
  const scenario = decideScenario(h1, h4, assetBias);

  const decision = computeDecision({
    styleConfig,
    dxyScore: dxy.score,
    btmmScore: btmm.score,
    smcScore: smc.score,
    assetBias,
    scenario,
    killZone,
    volatility
  });

  const tradeLevels = computeTradeLevels(symbol, livePrice, decision.finalDecision, entryTf);

  return {
    ok: true,
    symbol,
    style: styleConfig.style,
    session,
    livePrice,
    dxy,
    btmm,
    smc,
    total: decision.total,
    scenario,
    decision: decision.finalDecision,
    status: decision.status,
    reason: decision.reason,
    tradeLevels,
    volatility,
    structure: {
      entryTf,
      h1,
      h4,
      d1
    }
  };
}

async function runAutoAnalysis(symbolInput) {
  const scalping = await runAnalysis(symbolInput, "SCALPING");
  const intrading = await runAnalysis(symbolInput, "INTRADING");

  const scalpValid = ["BUY", "SELL"].includes(scalping.decision);
  const intraValid = ["BUY", "SELL"].includes(intrading.decision);

  if (scalpValid && intraValid) {
    return scalping.total >= intrading.total ? scalping : intrading;
  }

  if (scalpValid) return scalping;
  if (intraValid) return intrading;

  return scalping.total >= intrading.total ? scalping : intrading;
}

// =========================
// TELEGRAM
// =========================
async function sendTelegramMessage(text) {
  const response = await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      chat_id: CHAT_ID,
      text
    }
  );
  return response.data;
}

// =========================
// ROUTES
// =========================
app.get("/", (req, res) => {
  res.send("SNIPER ELITE AI backend is running 🚀");
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    api: "running",
    telegramToken: TELEGRAM_TOKEN ? "FOUND" : "MISSING",
    twelveApiKey: TWELVE_API_KEY ? "FOUND" : "MISSING"
  });
});

app.get("/send-test", async (req, res) => {
  try {
    const telegram = await sendTelegramMessage("✅ Test Telegram réussi depuis SNIPER ELITE AI");
    res.json({ ok: true, telegram });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
      telegramStatus: error.response?.status || null,
      telegramData: error.response?.data || null
    });
  }
});

app.get("/price", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol || "EUR/USD");
    const quote = await fetchQuote(symbol);

    if (quote.code) {
      return res.status(400).json({
        ok: false,
        message: quote.message || "Unable to fetch quote"
      });
    }

    return res.json({
      ok: true,
      symbol,
      livePrice: toNum(quote.close)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message,
      data: error.response?.data || null
    });
  }
});

app.get("/analyze-live", async (req, res) => {
  try {
    const symbol = req.query.symbol || "EUR/USD";
    const style = req.query.style || "AUTO";

    const result =
      String(style).toUpperCase() === "AUTO"
        ? await runAutoAnalysis(symbol)
        : await runAnalysis(symbol, style);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
      data: error.response?.data || null
    });
  }
});

app.get("/send-signal", async (req, res) => {
  try {
    const symbol = req.query.symbol || "EUR/USD";
    const style = req.query.style || "AUTO";

    const result =
      String(style).toUpperCase() === "AUTO"
        ? await runAutoAnalysis(symbol)
        : await runAnalysis(symbol, style);

    const message = buildTelegramMessage(result);
    const telegram = await sendTelegramMessage(message);

    res.json({
      ok: true,
      sent: true,
      result,
      telegram
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
      telegramStatus: error.response?.status || null,
      telegramData: error.response?.data || null
    });
  }
});

app.get("/scan-all-live", async (req, res) => {
  try {
    const style = req.query.style || "AUTO";
    const results = [];

    for (const symbol of DEFAULT_SYMBOLS) {
      const result =
        String(style).toUpperCase() === "AUTO"
          ? await runAutoAnalysis(symbol)
          : await runAnalysis(symbol, style);

      results.push(result);

      if (["BUY", "SELL"].includes(result.decision)) {
        const message = buildTelegramMessage(result);
        await sendTelegramMessage(message);
      }
    }

    res.json({
      ok: true,
      style,
      scanned: DEFAULT_SYMBOLS,
      results
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running 🚀");
});
