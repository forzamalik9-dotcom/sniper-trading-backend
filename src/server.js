import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = "7312421368";

app.get("/", (req, res) => {
  res.send("Bot is running 🚀");
});

app.get("/send", async (req, res) => {
  try {
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: "🔥 Bot connecté avec succès !"
    });

    res.send("Message envoyé !");
  } catch (error) {
    res.send("Erreur: " + error.message);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
