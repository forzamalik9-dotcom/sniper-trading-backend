import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = "7312421368";

app.get("/", (req, res) => {
  res.send("Bot is running 🚀");
});

app.get("/debug", (req, res) => {
  res.json({
    tokenExists: !!TOKEN,
    tokenPrefix: TOKEN ? TOKEN.slice(0, 10) : null,
    chatId: CHAT_ID
  });
});

app.get("/send", async (req, res) => {
  try {
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;

    const response = await axios.post(url, {
      chat_id: CHAT_ID,
      text: "🔥 Bot connecté avec succès !"
    });

    res.json({
      ok: true,
      telegram: response.data
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
      telegramStatus: error.response?.status || null,
      telegramData: error.response?.data || null,
      tokenExists: !!TOKEN,
      tokenPrefix: TOKEN ? TOKEN.slice(0, 10) : null
    });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running 🚀");
});
