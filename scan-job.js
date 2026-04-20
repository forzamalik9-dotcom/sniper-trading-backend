import axios from "axios";

const API_BASE_URL = process.env.API_BASE_URL;

async function runScan() {
  try {
    console.log("🚀 SCAN JOB STARTED");

    const response = await axios.get(`${API_BASE_URL}/scan`);

    console.log("✅ Scan result:", response.data);
  } catch (error) {
    console.error("❌ Scan error:", error.message);
  }
}

runScan();
