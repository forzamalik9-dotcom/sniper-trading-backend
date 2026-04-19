import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TWELVE_API_KEY = process.env.TWELVE_API_KEY;
const CHAT_ID = "7312421368";

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
  const value = String(input).toUpperCase();

  const map = {
    EURUSD: "EUR/USD",
    GBPUSD: "GBP/USD",
    XAUUSD: "XAU/USD",
    NAS100: "IXIC",
    DXY: "DXY",
    UUP: "UUP"
  };

  return map[value] || value;
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

async function fetchTimeSeries(symbol, interval = "1h", outputsize = 50) {
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
  return values.map((candle) => ({
    datetime: candle.datetime,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: candle.volume ? Number(candle.volume) : null
  }));
}

function average(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function analyzeStructure(candles = []) {
  if (!candles || candles.length < 10) {
    return {
      bias: "neutral",
      high: null,
      low: null,
      lastClose: null,
      momentum: "weak",
      structureQuality: "low",
      swingHigh: null,
      swingLow: null
    };
  }

  const ordered = [...candles].reverse();
  const closes = ordered.map((c) => c.close);
  const highs = ordered.map((c) => c.high);
  const lows = ordered.map((c) => c.low);

  const lastClose = closes[closes.length - 1];
  const firstClose = closes[0];
  const high = Math.max(...highs);
  const low = Math.min(...lows);

  const recentCloses = closes.slice(-5);
  const previousCloses = closes.slice(-10, -5);

  const recentAvg = average(recentCloses);
  const previousAvg = average(previousCloses);

  let bias = "neutral";
  if (lastClose > firstClose && recentAvg >= previousAvg) bias = "bullish";
  if (lastClose < firstClose && recentAvg <= previousAvg) bias = "bearish";

  const movePct = ((lastClose - firstClose) / firstClose) * 100;

  let momentum = "weak";
  if (Math.abs(movePct) > 0.15) momentum = "medium";
  if (Math.abs(movePct) > 0.35) momentum = "strong";

  let structureQuality = "low";
  if (Math.abs(movePct) > 0.10) structureQuality = "medium";
  if (Math.abs(movePct) > 0.25) structureQuality = "high";

  const swingHigh = Math.max(...highs.slice(-10));
  const swingLow = Math.min(...lows.slice(-10));

  return {
    bias,
    high,
    low,
    lastClose,
    momentum,
    structureQuality,
    swingHigh,
    swingLow
  };
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

function computeAssetBias(symbol, dxyBias, h1Bias, h4Bias) {
  const forexGold = ["EUR/USD", "GBP/USD", "XAU/USD"];

  if (symbol === "IXIC") {
    if (h1Bias === h4Bias && h1Bias !== "neutral") return h1Bias;
    return "neutral";
  }

  if (forexGold.includes(symbol)) {
    if (dxyBias === "bearish") {
      if (h1Bias === "bullish" || h4Bias === "bullish") return "bullish";
    }
    if (dxyBias === "bullish") {
      if (h1Bias === "bearish" || h4Bias === "bearish") return "bearish";
    }
  }

  if (h1Bias === h4Bias) return h1Bias;
  return "neutral";
}

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
    notes.push("BTMM aligned");
  }

  if (h1.momentum === "strong" || h4.momentum === "strong") {
    score += 2;
    notes.push("Momentum present");
  }

  if (h1.structureQuality !== "low") {
    score += 2;
    notes.push("EMA alignment proxy");
  }

  if (Math.abs((h1.lastClose - h1.low) / (h1.high - h1.low || 1)) < 0.2 ||
      Math.abs((h1.high - h1.lastClose) / (h1.high - h1.low || 1)) < 0.2) {
    score += 2;
    notes.push("RSI extreme proxy");
  }

  if (h1.momentum !== "weak") {
    score += 2;
    notes.push("Volume proxy strong");
  }

  if (h1.structureQuality === "high") {
    score += 2;
    notes.push("FVG proxy present");
  }

  if (h1.bias === h4.bias && h4.bias === d1.bias && h1.bias !== "neutral") {
    score += 3;
    notes.push("Multi TF confluence");
  }

  if (Math.abs(h1.lastClose - h1.swingHigh) / (h1.lastClose || 1) < 0.002 ||
      Math.abs(h1.lastClose - h1.swingLow) / (h1.lastClose || 1) < 0.002) {
    score += 2;
    notes.push("Liquidity visible");
  }

  if (Math.abs(h1.lastClose - h4.swingHigh) / (h1.lastClose || 1) < 0.004 ||
      Math.abs(h1.lastClose - h4.swingLow) / (h1.lastClose || 1) < 0.004) {
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

function computeSmcScore({ h1, m5, killZone }) {
  let score = 0;
  const notes = [];

  if (h1.bias !== "neutral") {
    score += 1;
    notes.push("H1 alignment valid");
  }

  const hasSweep =
    Math.abs(m5.lastClose - m5.swingHigh) / (m5.lastClose || 1) < 0.0015 ||
    Math.abs(m5.lastClose - m5.swingLow) / (m5.lastClose || 1) < 0.0015;

  if (hasSweep) {
    score += 2;
    notes.push("CRT sweep proxy valid");
  }

  if (m5.bias === h1.bias && m5.bias !== "neutral") {
    score += 2;
    notes.push("TBS confirmed");
  }

  if (m5.structureQuality !== "low") {
    score += 1;
    notes.push("FVG proxy intact");
  }

  if (killZone) {
    score += 1;
    notes.push("London/NY session active");
  }

  if (m5.momentum !== "weak") {
    score += 1;
    notes.push("M5 CHoCH proxy valid");
  }

  if (m5.structureQuality === "high") {
    score += 1;
    notes.push("Timing clean");
  }

  if (
    Math.abs((m5.lastClose - m5.low) / (m5.high - m5.low || 1) - 0.5) < 0.25 ||
    Math.abs((m5.lastClose - m5.low) / (m5.high - m5.low || 1) - 0.618) < 0.25 ||
    Math.abs((m5.lastClose - m5.low) / (m5.high - m5.low || 1) - 0.705) < 0.25
  ) {
    score += 1;
    notes.push("Fibonacci zone valid");
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

function computeDecision({ dxyScore, btmmScore, smcScore, assetBias, scenario, killZone }) {
  const total = dxyScore + btmmScore + smcScore;

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

  if (scenario === "Manipulation") {
    return {
      total,
      status: "WAIT",
      finalDecision: "WAIT",
      reason: "Manipulation scenario detected"
    };
  }

  return {
    total,
    status: total >= 46 ? "SNIPER TRADE" : "GOOD SETUP",
    finalDecision: assetBias === "bullish" ? "BUY" : "SELL",
    reason: "All major filters aligned"
  };
}

function computeTradeLevels(symbol, livePrice, finalDecision, h1, h4) {
  if (finalDecision !== "BUY" && finalDecision !== "SELL") {
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
    const stopLoss = Math.min(h1.swingLow || price - risk, price - risk);
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
  const stopLoss = Math.max(h1.swingHigh || price + risk, price + risk);
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

function buildAnalysisLines({ dxy, btmm, smc, scenario, decision }) {
  const lines = [];

  lines.push(`DXY ${dxy.bias} (${dxy.score}/10) via ${dxy.source}`);
  lines.push(`BTMM ${btmm.score}/30 - ${btmm.notes.slice(0, 2).join(", ") || "weak structure"}`);
  lines.push(`SMC ${smc.score}/10 - ${smc.notes.slice(0, 2).join(", ") || "weak confirmation"}`);
  lines.push(`Scenario: ${scenario}`);
  lines.push(`Decision reason: ${decision.reason}`);

  return lines.slice(0, 5);
}

function buildTelegramMessage(result) {
  const tradeText =
    result.decision === "BUY" || result.decision === "SELL"
      ? `📍 Entrée : ${result.tradeLevels.entry}
🛑 Stop Loss : ${result.tradeLevels.stopLoss}
🎯 TP1 : ${result.tradeLevels.tp1}
🎯 TP2 : ${result.tradeLevels.tp2}
🎯 TP3 : ${result.tradeLevels.tp3}`
      : `📍 Entrée : -
🛑 Stop Loss : -
🎯 TP1 : -
🎯 TP2 : -
🎯 TP3 : -`;

  return `🎯 Décision : ${result.decision}

📊 Score :
DXY : ${result.dxy.score}/10
BTMM : ${result.btmm.score}/30
SMC : ${result.smc.score}/10
TOTAL : ${result.total}/50

${tradeText}

🧠 Scénario : ${result.scenario}

📊 Analyse :
- ${result.analysisLines.join("\n- ")}

⚠️ Raison : ${result.reason}`;
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
    const symbol = normalizeSymbol(req.query.symbol || "XAUUSD");

    const quote = await fetchQuote(symbol);
    if (quote.code) {
      return res.status(400).json({
        ok: false,
        message: quote.message || "Unable to fetch quote"
      });
    }

    const livePrice = Number(quote.close);

    const [m5Raw, h1Raw, h4Raw, d1Raw, dxy] = await Promise.all([
      fetchTimeSeries(symbol, "5min", 50),
      fetchTimeSeries(symbol, "1h", 50),
      fetchTimeSeries(symbol, "4h", 50),
      fetchTimeSeries(symbol, "1day", 50),
      fetchDxyData()
    ]);

    const m5 = analyzeStructure(parseCandles(m5Raw.values || []));
    const h1 = analyzeStructure(parseCandles(h1Raw.values || []));
    const h4 = analyzeStructure(parseCandles(h4Raw.values || []));
    const d1 = analyzeStructure(parseCandles(d1Raw.values || []));

    const killZone = isKillZoneActive();
    const assetBias = computeAssetBias(symbol, dxy.bias, h1.bias, h4.bias);
    const btmm = computeBtmmScore({ h1, h4, d1, killZone });
    const smc = computeSmcScore({ h1, m5, killZone });
    const scenario = decideScenario(h1, h4, assetBias);

    const decision = computeDecision({
      dxyScore: dxy.score,
      btmmScore: btmm.score,
      smcScore: smc.score,
      assetBias,
      scenario,
      killZone
    });

    const tradeLevels = computeTradeLevels(symbol, livePrice, decision.finalDecision, h1, h4);
    const analysisLines = buildAnalysisLines({
      dxy,
      btmm,
      smc,
      scenario,
      decision
    });

    return res.json({
      ok: true,
      symbol,
      livePrice,
      session: detectSession(),
      killZone,
      dxy,
      structure: {
        m5,
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
    });
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
    const symbol = normalizeSymbol(req.query.symbol || "XAUUSD");

    const quote = await fetchQuote(symbol);
    if (quote.code) {
      return res.status(400).json({
        ok: false,
        message: quote.message || "Unable to fetch quote"
      });
    }

    const livePrice = Number(quote.close);

    const [m5Raw, h1Raw, h4Raw, d1Raw, dxy] = await Promise.all([
      fetchTimeSeries(symbol, "5min", 50),
      fetchTimeSeries(symbol, "1h", 50),
      fetchTimeSeries(symbol, "4h", 50),
      fetchTimeSeries(symbol, "1day", 50),
      fetchDxyData()
    ]);

    const m5 = analyzeStructure(parseCandles(m5Raw.values || []));
    const h1 = analyzeStructure(parseCandles(h1Raw.values || []));
    const h4 = analyzeStructure(parseCandles(h4Raw.values || []));
    const d1 = analyzeStructure(parseCandles(d1Raw.values || []));

    const killZone = isKillZoneActive();
    const assetBias = computeAssetBias(symbol, dxy.bias, h1.bias, h4.bias);
    const btmm = computeBtmmScore({ h1, h4, d1, killZone });
    const smc = computeSmcScore({ h1, m5, killZone });
    const scenario = decideScenario(h1, h4, assetBias);

    const decision = computeDecision({
      dxyScore: dxy.score,
      btmmScore: btmm.score,
      smcScore: smc.score,
      assetBias,
      scenario,
      killZone
    });

    const tradeLevels = computeTradeLevels(symbol, livePrice, decision.finalDecision, h1, h4);
    const analysisLines = buildAnalysisLines({
      dxy,
      btmm,
      smc,
      scenario,
      decision
    });

    const result = {
      symbol,
      decision: decision.finalDecision,
      total: decision.total,
      reason: decision.reason,
      scenario,
      dxy,
      btmm,
      smc,
      tradeLevels,
      analysisLines
    };

    const message = buildTelegramMessage(result);

    const telegramResponse = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: message
      }
    );

    return res.json({
      ok: true,
      sent: true,
      result,
      telegram: telegramResponse.data
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message,
      telegramStatus: error.response?.status || null,
      telegramData: error.response?.data || null
    });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running 🚀");
});
