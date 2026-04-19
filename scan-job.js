import axios from "axios";

const API_BASE_URL = process.env.API_BASE_URL;

async function run() {
  try {
    if (!API_BASE_URL) {
      throw new Error("API_BASE_URL is missing");
    }

    const url = `${API_BASE_URL}/scan-all-live?style=AUTO`;

    console.log("Calling:", url);

    const response = await axios.get(url, {
      timeout: 60000
    });

    console.log("SCAN OK");
    console.log(JSON.stringify(response.data, null, 2));

    process.exit(0);
  } catch (error) {
    console.error("SCAN FAILED");
    console.error(error.response?.data || error.message);

    process.exit(1);
  }
}

run();
// trigger deploy
