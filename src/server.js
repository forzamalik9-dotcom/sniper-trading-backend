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
        if (Math.abs(change) > 0.1) score += 1;
        if (Math.abs(change) > 0.2) score += 1;
        if (Math.abs(change) > 0.3) score += 1;
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
    message: "DXY data unavailable"
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

function analyzeStructure(candles = []) {
  if (!candles || candles.length < 10) {
    return {
      bias: "neutral",
      high: null,
      low: null,
      lastClose: null,
      momentum: "weak"
    };
  }

  const recent = candles.slice(0, 10);
  const last = recent[0];
  const first = recent[recent.length - 1];

  const highestHigh = Math.max(...recent.map((c) => c.high));
  const lowestLow = Math.min(...recent.map((c) => c.low));

  let bias = "neutral";
  if (last.close > first.close) bias = "bullish";
  if (last.close < first.close) bias = "bearish";

  const range = highestHigh - lowestLow;
  const move = Math.abs(last.close - first.close);

  let momentum = "weak";
  if (range > 0 && move / range > 0.3) momentum = "moderate";
  if (range > 0 && move / range > 0.55) momentum = "strong";

  return {
    bias,
    high: highestHigh,
    low: lowestLow,
    lastClose: last.close,
    momentum
  };
}

function buildAssetBias(symbol, dxyBias) {
  if (["EUR/USD", "GBP/USD", "XAU/USD"].includes(symbol)) {
    if (dxyBias === "bearish") return "bullish";
    if (dxyBias === "bullish") return "bearish";
  }

  if (symbol === "IXIC") {
    if (dxyBias === "bearish") return "bullish";
    if (dxyBias === "bullish") return "bearish";
  }

  return "neutral";
}

function scorePreAnalysis(dxy, h1, h4, assetBias) {
  let score = 0;

  if (dxy.ok && dxy.score >= 7) score += 10;
  if (h1.bias !== "neutral") score += 5;
  if (h4.bias !== "neutral") score += 5;
  if (h1.momentum === "moderate") score += 3;
  if (h1.momentum === "strong") score += 5;
  if (h4.momentum === "moderate") score += 3;
  if (h4.momentum === "strong") score += 5;
  if (assetBias === h1.bias) score += 8;
  if (assetBias === h4.bias) score += 9;

  if (score > 50) score = 50;

  let status = "NO TRADE";
  if (score >= 35 && score <= 40) status = "WAIT";
  if (score >= 41 && score <= 45) status = "GOOD SETUP";
  if (score >= 46) status = "SNIPER TRADE";

  return { score, status };
}

app.get("/dxy", async (req, res) => {
  try {
    const dxy = await fetchDxyData();
    res.json(dxy);
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.get("/price/:symbol", async (req, res) => {
  try {
    const rawSymbol = req.params.symbol;
    const symbol = normalizeSymbol(rawSymbol);
    const data = await fetchQuote(symbol);

    if (data.code) {
      return res.status(400).json({
        ok: false,
        symbol,
        message: data.message || "Quote unavailable"
      });
    }

    res.json({
      ok: true,
      symbol,
      source: "TWELVEDATA",
      price: Number(data.close),
      previousClose: Number(data.previous_close || data.close),
      change: Number(data.close) - Number(data.previous_close || data.close),
      percentChange: data.percent_change || null,
      datetime: data.datetime || null
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.get("/candles/:symbol/:interval", async (req, res) => {
  try {
    const rawSymbol = req.params.symbol;
    const interval = req.params.interval;
    const outputsize = Number(req.query.outputsize || 50);
    const symbol = normalizeSymbol(rawSymbol);

    const data = await fetchTimeSeries(symbol, interval, outputsize);

    if (data.code) {
      return res.status(400).json({
        ok: false,
        symbol,
        interval,
        message: data.message || "Candles unavailable"
      });
    }

    const values = parseCandles(data.values || []);

    res.json({
      ok: true,
      symbol,
      interval,
      source: "TWELVEDATA",
      count: values.length,
      candles: values
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.get("/analyze/:symbol", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);

    const [dxy, quote, h1Raw, h4Raw] = await Promise.all([
      fetchDxyData(),
      fetchQuote(symbol),
      fetchTimeSeries(symbol, "1h", 50),
      fetchTimeSeries(symbol, "4h", 50)
    ]);

    if (quote.code) {
      return res.status(400).json({
        ok: false,
        symbol,
        message: quote.message || "Quote unavailable"
      });
    }

    if (h1Raw.code || h4Raw.code) {
      return res.status(400).json({
        ok: false,
        symbol,
        message: "Candles unavailable for analysis"
      });
    }

    const h1Candles = parseCandles(h1Raw.values || []);
    const h4Candles = parseCandles(h4Raw.values || []);

    const h1 = analyzeStructure(h1Candles);
    const h4 = analyzeStructure(h4Candles);
    const assetBias = buildAssetBias(symbol, dxy.bias);
    const scored = scorePreAnalysis(dxy, h1, h4, assetBias);

    res.json({
      ok: true,
      symbol,
      livePrice: Number(quote.close),
      dxy,
      structure: {
        h1,
        h4
      },
      assetBias,
      preAnalysis: scored,
      scenario:
        scored.status === "SNIPER TRADE"
          ? "Continuation"
          : scored.status === "GOOD SETUP"
          ? "Developing"
          : "Unclear"
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} 🚀`);
});
