import axios from "axios";

const API_BASE_URL = process.env.API_BASE_URL;

function formatScanLine(result) {
  const symbol = result?.symbol || "UNKNOWN";
  const decision = result?.decision || "UNKNOWN";
  const total = result?.total ?? "N/A";
  const status = result?.status || "NO_STATUS";
  const reason = result?.reason || "No reason";

  return `[SCAN RESULT] ${symbol} | ${decision} | ${total}/50 | ${status} | ${reason}`;
}

function printScanSummary(data) {
  if (!data) {
    console.log("SCAN SUMMARY: empty response");
    return;
  }

  if
