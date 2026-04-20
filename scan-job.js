import axios from "axios";

const API_BASE_URL = process.env.API_BASE_URL;

async function runScan() {
  try {
    console.log("SCAN JOB STARTED");

    if (!API_BASE_URL) {
      throw new Error("API_BASE_URL is missing");
    }

    const response = await axios.get(
      `${API_BASE_URL}/scan-all-live?style=AUTO`,
      { timeout: 15000 }
    );

    console.log("SCAN OK");
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error("SCAN ERROR:", error.message);

    if (error.response) {
      console.error("RESPONSE STATUS:", error.response.status);
      console.error("RESPONSE DATA:", JSON.stringify(error.response.data, null, 2));
    }

    process.exit(1);
  }
}

runScan();
