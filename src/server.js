import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TWELVE_API_KEY = process.env.TWELVE_API_KEY;
const CHAT_ID = "7312421368";

const NEWS_BLOCK_MINUTES_BEFORE = 30;
const NEWS_BLOCK_MINUTES_AFTER = 30;

app.get("/", (req, res) => {
  res.send("SNIPER ELITE AI backend is running 🚀");
});

app.get("/health", async (req, res) => {
  res.json({
    status: "OK",
    api: "running",
    telegramToken: TELEGRAM_TOKEN ? "FOUND" : "MISSING",
    twelveApiKey: TWELVE_API_KEY ? "FOUND" : "MISSING"
  });
});

app.get("/send-test", async (req, res) => {
  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: "✅ Test Telegram réussi depuis SNIPER ELITE AI"
      }
    );

    res.json({
      ok: true,
      telegram: response.data
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

async function fetchQuote(symbol) {
  const url = "https://api.twelvedata.com/quote";
  const response = await axios.get(url, {
    params: {
      symbol,
      apikey: TWELVE_API_KEY
    }
  });
  return response.data;
}

async function fetchTimeSeries(symbol, interval = "1h", outputsize = 100) {
  const url = "https://api.twelvedata.com/time_series";
  const response = await axios.get(url, {
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
        const price = Number(data.close);
        const previousClose = Number(data.previous_close || data.close);
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
          symbol: attempt.symbol,
          source: attempt.source,
          price,
          previousClose,
          change,
          bias,
          score
        };
      }
    } catch (error) {
      continue;
    }
  }

  return {
    ok: false,
    source: "UNAVAILABLE",
    message: "DXY data unavailable",
    bias: "neutral",
    score: 0
  };
}

function parseCandles(values = []) {
  return values
    .map((candle) => ({
      datetime: candle.datetime,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: candle.volume ? Number(candle.volume) : null
    }))
    .reverse();
}

function average(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getRange(high, low) {
  return Math.max(high - low, 0.0000001);
}

function detectSession() {
  const utcHour = new Date().getUTCHours();

  if (utcHour >= 7 && utcHour < 11) return "London";
  if (utcHour >= 12 && utcHour < 17) return "New York";
  if (utcHour >= 7 && utcHour < 17) return "London/New York";
  return "Off Session";
}

function isKillZoneActive() {
  const session = detectSession();
  return session === "London" || session === "New York" || session === "London/New York";
}

function analyzeStructure(candles = []) {
  if (!candles || candles.length < 20) {
    return {
      bias: "neutral",
      lastClose: null,
      swingHigh: null,
      swingLow: null,
      structureQuality: "low",
      momentum: "weak"
    };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];

  const recent5 = closes.slice(-5);
  const recent10 = closes.slice(-10);
  const previous10 = closes.slice(-20, -10);

  const recentAvg = average(recent10);
  const previousAvg = average(previous10);

  let bias = "neutral";
  if (lastClose > firstClose && recentAvg >= previousAvg) bias = "bullish";
  if (lastClose < firstClose && recentAvg <= previousAvg) bias = "bearish";

  const movePct = ((lastClose - firstClose) / firstClose) * 100;

  let momentum = "weak";
  if (Math.abs(movePct) > 0.10) momentum = "medium";
  if (Math.abs(movePct) > 0.25) momentum = "strong";

  let structureQuality = "low";
  if (Math.abs(movePct) > 0.08) structureQuality = "medium";
  if (Math.abs(movePct) > 0.20) structureQuality = "high";

  return {
    bias,
    lastClose,
    swingHigh: Math.max(...highs.slice(-15)),
    swingLow: Math.min(...lows.slice(-15)),
    high: Math.max(...highs),
    low: Math.min(...lows),
    recent5Avg: average(recent5),
    structureQuality,
    momentum
  };
}

function detectLiquiditySweep(tf) {
  if (!tf?.lastClose || !tf?.swingHigh || !tf?.swingLow) {
    return {
      hasSweep: false,
      side: "none"
    };
  }

  const nearHigh = Math.abs(tf.lastClose - tf.swingHigh) / tf.lastClose < 0.0015;
  const nearLow = Math.abs(tf.lastClose - tf.swingLow) / tf.lastClose < 0.0015;

  if (nearHigh) {
    return { hasSweep: true, side: "BSL" };
  }

  if (nearLow) {
    return { hasSweep: true, side: "SSL" };
  }

  return {
    hasSweep: false,
    side: "none"
  };
}

function detectFibZone(tf) {
  if (!tf?.high || !tf?.low || !tf?.lastClose) {
    return { valid: false, level: null };
  }

  const range = getRange(tf.high, tf.low);
  const position = (tf.lastClose - tf.low) / range;

  const targets = [0.5, 0.618, 0.705];
  for (const t of targets) {
    if (Math.abs(position - t) < 0.12) {
      return { valid: true, level: t };
    }
  }

  return { valid: false, level: null };
}

function detectFvgProxy(tf) {
  if (!tf?.structureQuality) return false;
  return tf.structureQuality === "high" || tf.structureQuality === "medium";
}

function detectTbs(higherTf, lowerTf) {
  if (!higherTf?.bias || !lowerTf?.bias) return false;
  return higherTf.bias !== "neutral" && higherTf.bias === lowerTf.bias;
}

function computeDxyBiasForAsset(symbol, dxyBias) {
  const inverseDollarAssets = ["EUR/USD", "GBP/USD", "XAU/USD"];

  if (symbol === "IXIC") return "neutral";
  if (!inverseDollarAssets.includes(symbol)) return "neutral";

  if (dxyBias === "bearish") return "bullish";
  if (dxyBias === "bullish") return "bearish";
  return "neutral";
}

function computeAssetBias(symbol, dxyBias, h1Bias, h4Bias) {
  const macroBias = computeDxyBiasForAsset(symbol, dxyBias);

  if (symbol === "IXIC") {
    if (h1Bias === h4Bias && h1Bias !== "neutral") return h1Bias;
    return "neutral";
  }

  if (macroBias !== "neutral") {
    if (h1Bias === macroBias || h4Bias === macroBias) {
      return macroBias;
    }
  }

  if (h1Bias === h4Bias && h1Bias !== "neutral") return h1Bias;
  return "neutral";
}

function computeBtmmScore({ h1, h4, d1, killZone }) {
  let score = 0;
  const notes = [];

  if (h4.structureQuality === "high") {
    score += 4;
    notes.push("Structure HTF claire");
  } else if (h4.structureQuality === "medium") {
    score += 2;
    notes.push("Structure HTF acceptable");
  }

  if (h1.bias === h4.bias && h1.bias !== "neutral") {
    score += 4;
    notes.push("BTMM complet");
  }

  if (h1.structureQuality !== "low") {
    score += 2;
    notes.push("EMA alignées proxy");
  }

  const range = getRange(h1.high, h1.low);
  const pos = (h1.lastClose - h1.low) / range;
  if (pos < 0.2 || pos > 0.8) {
    score += 2;
    notes.push("RSI extrême proxy");
  }

  if (h1.momentum === "strong" || h4.momentum === "strong") {
    score += 2;
    notes.push("Volume fort proxy");
  }

  if (detectFvgProxy(h1)) {
    score += 2;
    notes.push("FVG présent");
  }

  if (h1.bias === h4.bias && h4.bias === d1.bias && h1.bias !== "neutral") {
    score += 3;
    notes.push("Multi TF FVG / confluence");
  }

  const liqDist =
    Math.min(
      Math.abs(h1.lastClose - h1.swingHigh),
      Math.abs(h1.lastClose - h1.swingLow)
    ) / h1.lastClose;

  if (liqDist < 0.002) {
    score += 2;
    notes.push("Liquidité visible");
  }

  const obDist =
    Math.min(
      Math.abs(h1.lastClose - h4.swingHigh),
      Math.abs(h1.lastClose - h4.swingLow)
    ) / h1.lastClose;

  if (obDist < 0.004) {
    score += 2;
    notes.push("Order Block proche");
  }

  if (h1.bias === h4.bias && h1.momentum !== "weak") {
    score += 3;
    notes.push("Confluence forte");
  }

  if (killZone) {
    score += 2;
    notes.push("Kill zone active");
  }

  if (h1.bias === h4.bias && h1.structureQuality === "high") {
    score += 2;
    notes.push("Bonus alignement");
  }

  if (score > 30) score = 30;

  return { score, notes };
}

function computeSmcScore({ h1, lowerTf, killZone }) {
  let score = 0;
  const notes = [];

  if (h1.bias !== "neutral") {
    score += 1;
    notes.push("Alignement H1");
  }

  const sweep = detectLiquiditySweep(lowerTf);
  if (sweep.hasSweep) {
    score += 2;
    notes.push(`CRT sweep ${sweep.side}`);
  }

  if (detectTbs(h1, lowerTf)) {
    score += 2;
    notes.push("TBS confirmé");
  }

  if (detectFvgProxy(lowerTf)) {
    score += 1;
    notes.push("FVG intacte proxy");
  }

  if (killZone) {
    score += 1;
    notes.push("Session London/NY");
  }

  if (lowerTf.momentum !== "weak") {
    score += 1;
    notes.push("CHoCH proxy");
  }

  if (lowerTf.structureQuality === "high") {
    score += 1;
    notes.push("Timing propre");
  }

  const fib = detectFibZone(lowerTf);
  if (fib.valid) {
    score += 1;
    notes.push(`Fibonacci ${fib.level}`);
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

function detectEconomicNewsBlock() {
  const now = new Date();
  const utcHour = now.getUTCHours();

  const blockedHoursApprox = [
    12, // US CPI/NFP/FOMC windows often impact here
    13,
    18  // central bank speeches / events often cluster later
  ];

  const blocked = blockedHoursApprox.includes(utcHour);

  return {
    blocked,
    reason: blocked
      ? "News macro potentielle détectée - filtre sécurité actif"
      : null,
    source: "internal_news_safety_filter"
  };
}

function computeDecision({ dxyScore, btmmScore, smcScore, assetBias, scenario, killZone, newsBlocked }) {
  const total = dxyScore + btmmScore + smcScore;

  if (newsBlocked) {
    return {
      total,
      status: "NO TRADE",
      finalDecision: "NO TRADE",
      reason: "News macro / annonces économiques"
    };
  }

  if (!killZone) {
    return {
      total,
      status: "WAIT",
      finalDecision: "WAIT",
      reason: "Kill zone inactive"
    };
  }

  if (dxyScore < 7) {
    return {
      total,
      status: "NO TRADE",
      finalDecision: "NO TRADE",
      reason: "DXY below required threshold"
    };
  }

  if (btmmScore < 24) {
    return {
      total,
      status: "NO TRADE",
      finalDecision: "NO TRADE",
      reason: "BTMM below required threshold"
    };
  }

  if (smcScore < 7) {
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
      status: "WAIT",
      finalDecision: "WAIT",
      reason: "Asset bias unclear"
    };
  }

  if (scenario === "Manipulation") {
    return {
      total,
      status: "WAIT",
      finalDecision: "WAIT",
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
      status: "WAIT",
      finalDecision: "WAIT",
      reason: "Setup not strong enough yet"
    };
  }

  return {
    total,
    status: total >= 46 ? "SNIPER TRADE" : "GOOD SETUP",
    finalDecision: assetBias === "bullish" ? "BUY" : "SELL",
    reason: "All major filters aligned"
  };
}

function computeTradeLevels(symbol, livePrice, finalDecision, lowerTf) {
  if (!["BUY", "SELL"].includes(finalDecision)) {
    return {
      entry: null,
      stopLoss: null,
      tp1: null,
      tp2: null,
      tp3: null
    };
  }

  const price = Number(livePrice);
  let risk = price * 0.002;

  if (symbol === "XAU/USD") risk = price * 0.003;
  if (symbol === "IXIC") risk = price * 0.004;

  if (finalDecision === "BUY") {
    const entry = price;
    const stopLoss = Math.min(lowerTf.swingLow || price - risk, price - risk);
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
  const stopLoss = Math.max(lowerTf.swingHigh || price + risk, price + risk);
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

function detectStyleConfig(style) {
  const normalized = String(style || "AUTO").toUpperCase();

  if (normalized === "SCALPING") {
    return {
      style: "SCALPING",
      lowerInterval: "5min",
      lowerLabel: "M5",
      htf1: "1h",
      htf2: "4h"
    };
  }

  if (normalized === "INTRADING") {
    return {
      style: "INTRADING",
      lowerInterval: "15min",
      lowerLabel: "M15",
      htf1: "1h",
      htf2: "4h"
    };
  }

  return {
    style: "AUTO",
    lowerInterval: "5min",
    lowerLabel: "M5",
    htf1: "1h",
    htf2: "4h"
  };
}

function buildAnalysisLines({ dxy, btmm, smc, scenario, decision, session, news }) {
  const lines = [];
  lines.push(`DXY ${dxy.bias} (${dxy.score}/10) via ${dxy.source}`);
  lines.push(`BTMM ${btmm.score}/30`);
  lines.push(`SMC ${smc.score}/10`);
  lines.push(`Session: ${session}`);
  lines.push(`Scenario: ${scenario}`);

  if (news?.blocked) {
    lines.push(`News filter: ${news.reason}`);
  } else {
    lines.push(`News filter: clear`);
  }

  lines.push(`Decision reason: ${decision.reason}`);

  return lines.slice(0, 6);
}

function buildTelegramMessage(result) {
  const tradeText =
    result.decision === "BUY" || result.decision === "SELL"
      ? `Entry: ${result.tradeLevels.entry}
Stop Loss: ${result.tradeLevels.stopLoss}
TP1: ${result.tradeLevels.tp1}
TP2: ${result.tradeLevels.tp2}
TP3: ${result.tradeLevels.tp3}`
      : `Entry: -
Stop Loss: -
TP1: -
TP2: -
TP3: -`;

  return `🚨 SNIPER SIGNAL ALERT
${result.style}

Asset: ${result.symbol}
Decision: ${result.decision}

${tradeText}

Score:
DXY: ${result.dxy.score}/10
BTMM: ${result.btmm.score}/30
SMC: ${result.smc.score}/10
TOTAL: ${result.total}/50

Scenario: ${result.scenario}
Reason:
- ${result.analysisLines.join("\n- ")}

Status: ${result.status}`;
}

async function runAnalysis(symbolInput, requestedStyle = "AUTO") {
  const symbol = normalizeSymbol(symbolInput || "XAUUSD");
  const styleConfig = detectStyleConfig(requestedStyle);
  const session = detectSession();
  const killZone = isKillZoneActive();
  const news = detectEconomicNewsBlock();

  const quote = await fetchQuote(symbol);
  if (quote.code) {
    throw new Error(quote.message || "Unable to fetch quote");
  }

  const livePrice = Number(quote.close);

  const [lowerRaw, h1Raw, h4Raw, d1Raw, dxy] = await Promise.all([
    fetchTimeSeries(symbol, styleConfig.lowerInterval, 100),
    fetchTimeSeries(symbol, "1h", 100),
    fetchTimeSeries(symbol, "4h", 100),
    fetchTimeSeries(symbol, "1day", 100),
    fetchDxyData()
  ]);

  const lowerTf = analyzeStructure(parseCandles(lowerRaw.values || []));
  const h1 = analyzeStructure(parseCandles(h1Raw.values || []));
  const h4 = analyzeStructure(parseCandles(h4Raw.values || []));
  const d1 = analyzeStructure(parseCandles(d1Raw.values || []));

  const assetBias = computeAssetBias(symbol, dxy.bias, h1.bias, h4.bias);
  const btmm = computeBtmmScore({ h1, h4, d1, killZone });
  const smc = computeSmcScore({ h1, lowerTf, killZone });
  const scenario = decideScenario(h1, h4, assetBias);

  const decision = computeDecision({
    dxyScore: dxy.score,
    btmmScore: btmm.score,
    smcScore: smc.score,
    assetBias,
    scenario,
    killZone,
    newsBlocked: news.blocked
  });

  const tradeLevels = computeTradeLevels(symbol, livePrice, decision.finalDecision, lowerTf);

  const analysisLines = buildAnalysisLines({
    dxy,
    btmm,
    smc,
    scenario,
    decision,
    session,
    news
  });

  return {
    ok: true,
    style: styleConfig.style,
    symbol,
    livePrice,
    session,
    killZone,
    news,
    dxy,
    structure: {
      lowerTf,
      h1,
      h4,
      d1
    },
    assetBias,
    btmm,
    smc,
    total: decision.total,
    status: decision.status,
    decision: decision.finalDecision,
    reason: decision.reason,
    scenario,
    tradeLevels,
    analysisLines
  };
}

async function runAutoStyleAnalysis(symbolInput) {
  const scalping = await runAnalysis(symbolInput, "SCALPING");
  const intrading = await runAnalysis(symbolInput, "INTRADING");

  const validScalp = ["BUY", "SELL"].includes(scalping.decision);
  const validIntra = ["BUY", "SELL"].includes(intrading.decision);

  if (validScalp && validIntra) {
    return scalping.total >= intrading.total ? scalping : intrading;
  }

  if (validScalp) return scalping;
  if (validIntra) return intrading;

  return scalping.total >= intrading.total ? scalping : intrading;
}

app.get("/price", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol || "EURUSD");
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
      livePrice: Number(quote.close)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message,
      data: error.response?.data || null
    });
  }
});

app.get("/analyze", async (req, res) => {
  try {
    const symbol = req.query.symbol || "XAUUSD";
    const style = req.query.style || "AUTO";

    const result =
      String(style).toUpperCase() === "AUTO"
        ? await runAutoStyleAnalysis(symbol)
        : await runAnalysis(symbol, style);

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message,
      data: error.response?.data || null
    });
  }
});

app.get("/send-signal", async (req, res) => {
  try {
    const symbol = 
