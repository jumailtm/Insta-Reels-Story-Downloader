import { loadSettings } from "../src/config.js";
import { TelegramClient } from "../src/telegram.js";

const settings = loadSettings();
const webhookUrl = `${settings.webhookBaseUrl}/api`;
const telegram = new TelegramClient(settings.mainBotToken);

await telegram.setWebhook(webhookUrl, settings.webhookSecret);
const info = await telegram.getWebhookInfo();
if (info.url !== webhookUrl) {
  throw new Error("Telegram did not retain the requested main webhook URL");
}
console.log(`Main webhook active: ${info.url}`);
