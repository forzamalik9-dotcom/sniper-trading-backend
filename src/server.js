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
