import { createApp } from "./server.js";

const host = process.env.HOST?.trim() || "0.0.0.0";
const portText = process.env.PORT?.trim() || "8000";
const port = Number(portText);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

createApp().listen(port, host, () => {
  console.log(`Instagram bot listening on http://${host}:${port}`);
});
