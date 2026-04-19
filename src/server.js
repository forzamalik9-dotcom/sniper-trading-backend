import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TWELVE_API_KEY = process.env.TWELVE_API_KEY;
const CHAT_ID = "7312421368";
// =========================
// STYLE CONFIG
// =========================
function detectStyleConfig(style) {
  const normalized = String(style || "AUTO").toUpperCase();

  if (normalized === "SCALPING") {
    return {
      style: "SCALPING",
      entryTf: "5min",
      entryLabel: "M5",
      htf1: "1h",
      htf2: "4h",
      newsBlockBeforeMajor: 60,
      newsBlockAfterMajor: 60
    };
  }

  if (normalized === "INTRADING") {
    return {
      style: "INTRADING",
      entryTf: "15min",
      entryLabel: "M15",
      htf1: "1h",
      htf2: "4h",
      newsBlockBeforeMajor: 30,
      newsBlockAfterMajor: 45
    };
  }

  return {
    style: "AUTO",
    entryTf: "5min",
    entryLabel: "M5",
    htf1: "1h",
    htf2: "4h",
    newsBlockBeforeMajor: 60,
    newsBlockAfterMajor: 60
  };
}

// =========================
// SESSION / KILL ZONE
// =========================
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

// =========================
// NEWS FILTER
// =========================
// Pour l'instant : filtre interne simple.
// Plus tard : vraie API calendrier économique.
function getMockEconomicEvents() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");

  return [
    {
      name: "CPI",
      currency: "USD",
      impact: "high",
      datetimeUtc: `${yyyy}-${mm}-${dd}T12:30:00Z`
    },
    {
      name: "FOMC",
      currency: "USD",
      impact: "high",
      datetimeUtc: `${yyyy}-${mm}-${dd}T18:00:00Z`
    },
    {
      name: "NFP",
      currency: "USD",
      impact: "high",
      datetimeUtc: `${yyyy}-${mm}-${dd}T12:30:00Z`
    }
  ];
}

function getNewsBlockWindow(styleConfig, eventName) {
  const ultraMajor = ["FOMC", "NFP", "CPI", "ECB", "BOE", "BOJ"];

  if (ultraMajor.includes(String(eventName).toUpperCase())) {
    return {
      before: styleConfig.newsBlockBeforeMajor,
      after: styleConfig.newsBlockAfterMajor
    };
  }

  return {
    before: 30,
    after: 30
  };
}

function getRelevantCurrenciesForSymbol(symbol) {
  const normalized = String(symbol).toUpperCase();

  if (normalized === "EUR/USD") return ["EUR", "USD"];
  if (normalized === "GBP/USD") return ["GBP", "USD"];
  if (normalized === "XAU/USD") return ["USD"];
  if (normalized === "IXIC") return ["USD"];

  return ["USD"];
}

function getNewsStatus(symbol, styleConfig) {
  const events = getMockEconomicEvents();
  const now = new Date();
  const relevantCurrencies = getRelevantCurrenciesForSymbol(symbol);

  for (const event of events) {
    if (!relevantCurrencies.includes(event.currency)) continue;
    if (event.impact !== "high") continue;

    const eventTime = new Date(event.datetimeUtc);
    const window = getNewsBlockWindow(styleConfig, event.name);

    const diffMinutes = (now.getTime() - eventTime.getTime()) / 60000;
    const blocked = diffMinutes >= -window.before && diffMinutes <= window.after;

    if (blocked) {
      if (diffMinutes < 0) {
        return {
          blocked: true,
          phase: "PRE_NEWS",
          status: "NEWS BLOCK",
          event: event.name,
          currency: event.currency,
          reason: `${event.name} ${event.currency} dans la fenêtre interdite`
        };
      }

      return {
        blocked: true,
        phase: "POST_NEWS",
        status: "NEWS BLOCK",
        event: event.name,
        currency: event.currency,
        reason: `${event.name} ${event.currency} vient de passer - attente post-news`
      };
    }
  }

  return {
    blocked: false,
    phase: "CLEAR",
    status: "CLEAR",
    event: null,
    currency: null,
    reason: null
  };
}

// =========================
// VOLATILITY CHECK
// =========================
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

function computeAverageRange(candles = []) {
  if (!candles.length) return 0;
  return candles.reduce((sum, c) => sum + Math.abs(c.high - c.low), 0) / candles.length;
}

function computeAverageWickRatio(candles = []) {
  if (!candles.length) return 0;

  const ratios = candles.map((c) => {
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const totalWick = Math.max(upperWick, 0) + Math.max(lowerWick, 0);
    return totalWick / Math.max(body, 0.0000001);
  });

  return ratios.reduce((sum, v) => sum + v, 0) / ratios.length;
}

function computePostNewsVolatilityState(candles = []) {
  if (!candles || candles.length < 20) {
    return {
      state: "unknown",
      rangeRatio: 0,
      wickRatio: 0,
      tradable: false,
      reason: "Not enough candles"
    };
  }

  const recent = candles.slice(-5);
  const previous = candles.slice(-20, -5);

  const recentRange = computeAverageRange(recent);
  const previousRange = computeAverageRange(previous);
  const rangeRatio = previousRange === 0 ? 0 : recentRange / previousRange;

  const recentWickRatio = computeAverageWickRatio(recent);

  if (rangeRatio >= 2.5 || recentWickRatio >= 2.5) {
    return {
      state: "extreme",
      rangeRatio,
      wickRatio: recentWickRatio,
      tradable: false,
      reason: "Post-news volatility still elevated"
    };
  }

  if (rangeRatio >= 1.6 || recentWickRatio >= 1.6) {
    return {
      state: "high",
      rangeRatio,
      wickRatio: recentWickRatio,
      tradable: false,
      reason: "Wick expansion abnormal"
    };
  }

  return {
    state: "normal",
    rangeRatio,
    wickRatio: recentWickRatio,
    tradable: true,
    reason: "Volatility normalized"
  };
      }
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
});app.get("/send-signal", async (req, res) => {
  try {
    const symbol = req.query.symbol || "EUR/USD";
    const styleConfig = detectStyleConfig(req.query.style);

    // 📊 Fetch market data
    const m5Raw = await axios.get("https://api.twelvedata.com/time_series", {
      params: {
        symbol,
        interval: "5min",
        outputsize: 50,
        apikey: TWELVE_API_KEY
      }
    });

    const candles = parseCandles(m5Raw.data.values || []);

    // 🔥 NEWS FILTER
    const newsStatus = getNewsStatus(symbol, styleConfig);

    // 🔥 VOLATILITY CHECK
    const volatility = computePostNewsVolatilityState(candles);

    // 🔥 MOCK SCORES (temporaire)
    const dxy = { score: 8, bias: "bearish" };
    const btmm = { score: 25 };
    const smc = { score: 7 };

    const total = dxy.score + btmm.score + smc.score;
    const scenario = "Manipulation";

    const decision = "WAIT";

    const result = {
      symbol,
      decision,
      total,
      scenario,
      dxy,
      btmm,
      smc,
      tradeLevels: {},
      newsStatus,
      volatility,
      style: styleConfig.style
    };

    const message = buildTelegramMessage(result);

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message
    });

    res.json({
      ok: true,
      message
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get("/price", async (req, res) => {
  try {
    const symbol = req.query.symbol || "EUR/USD";

    const response = await axios.get("https://api.twelvedata.com/quote", {
      params: {
        symbol,
        apikey: TWELVE_API_KEY
      }
    });

    if (response.data.code) {
      return res.status(400).json({
        ok: false,
        message: response.data.message || "Unable to fetch quote"
      });
    }

    return res.json({
      ok: true,
      symbol,
      livePrice: Number(response.data.close)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message,
      data: error.response?.data || null
    });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running 🚀");
});
