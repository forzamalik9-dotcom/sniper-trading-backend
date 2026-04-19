import axios from "axios";

const API_BASE_URL = process.env.API_BASE_URL;

async function run() {
  if (!API_BASE_URL) {
    throw new Error("API_BASE_URL is missing");
  }

  const url = `${API_BASE_URL}/scan-all-live?style=AUTO`;

  console.log("Calling:", url);

  try {
    const response = await axios.get(url, {
      timeout: 10000 // ⬅️ réduit pour debug
    });

    console.log("RESPONSE RECEIVED");
    console.log("STATUS:", response.status);
    console.log("DATA:", JSON.stringify(response.data).slice(0, 200));

  } catch (error) {
    console.error("REQUEST ERROR:");
    console.error(error.message);
  }
}

run()
  .then(() => {
    console.log("JOB DONE");
    process.exit(0);
  })
  .catch((err) => {
    console.error("FATAL ERROR:", err.message);
    process.exit(1);
  });
