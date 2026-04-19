import axios from "axios";

const API_BASE_URL = process.env.API_BASE_URL;

async function run() {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = dimanche, 6 = samedi

  if (day === 0 || day === 6) {
    console.log("WEEKEND SKIP - markets filter active");
    return;
  }

  if (!API_BASE_URL) {
    throw new Error("API_BASE_URL is missing");
  }

  const url = `${API_BASE_URL}/scan-all-live?style=AUTO`;

  console.log("Calling:", url);

  try {
    const response = await axios.get(url, {
      timeout: 10000
    });

    console.log("RESPONSE RECEIVED");
    console.log("STATUS:", response.status);
    console.log("DATA:", JSON.stringify(response.data, null, 2));
    console.log("SCAN OK");
  } catch (error) {
    console.error("REQUEST ERROR:");
    console.error(error.response?.data || error.message);
    throw error;
  }
}

run()
  .then(() => {
    console.log("JOB DONE");
    process.exit(0);
  })
  .catch((error) => {
    console.error("SCAN FAILED");
    console.error(error.response?.data || error.message);
    process.exit(1);
  });
