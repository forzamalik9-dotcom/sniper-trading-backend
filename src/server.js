import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Test
app.get("/", (req, res) => {
  res.send("Sniper Backend LIVE 🚀");
});

// Health check (debug API)
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    api: "running",
    twelveKey: process.env.TWELVE_API_KEY ? "FOUND" : "MISSING"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
