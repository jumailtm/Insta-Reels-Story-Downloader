import path from "node:path";
import { config as loadDotenv } from "dotenv";

export interface Settings {
  readonly mainBotToken: string;
  readonly webhookBaseUrl: string;
  readonly webhookSecret: string;
  readonly downloadDir: string;
  readonly maxUploadBytes: number;
  readonly instagramCookiesFile: string | null;
  readonly instagramCookiesB64: string | null;
}

export function loadSettings(environment: NodeJS.ProcessEnv = process.env): Settings {
  if (environment === process.env) {
    loadDotenv({ quiet: true });
  }

  const mainBotToken = environment.MAIN_BOT_TOKEN?.trim() ?? "";
  const webhookBaseUrl = (environment.WEBHOOK_BASE_URL?.trim() ?? "").replace(/\/+$/, "");
  const webhookSecret = environment.WEBHOOK_SECRET?.trim() ?? "";
  const missing = [
    ["MAIN_BOT_TOKEN", mainBotToken],
    ["WEBHOOK_BASE_URL", webhookBaseUrl],
    ["WEBHOOK_SECRET", webhookSecret],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const maxUploadMbText = environment.MAX_UPLOAD_MB?.trim() || "49";
  if (!/^\d+$/.test(maxUploadMbText)) {
    throw new Error("MAX_UPLOAD_MB must be an integer");
  }
  const maxUploadMb = Number(maxUploadMbText);
  if (!Number.isSafeInteger(maxUploadMb) || maxUploadMb < 1) {
    throw new Error("MAX_UPLOAD_MB must be at least 1");
  }
  if (!webhookBaseUrl.startsWith("https://")) {
    throw new Error("WEBHOOK_BASE_URL must start with https://");
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
    throw new Error(
      "WEBHOOK_SECRET must be 1-256 characters using only letters, numbers, _ and -",
    );
  }

  const instagramCookiesFile = environment.INSTAGRAM_COOKIES_FILE?.trim() || null;
  const instagramCookiesB64 = environment.INSTAGRAM_COOKIES_B64?.trim() || null;
  if (instagramCookiesFile && instagramCookiesB64) {
    throw new Error("Set only one of INSTAGRAM_COOKIES_FILE or INSTAGRAM_COOKIES_B64");
  }

  return Object.freeze({
    mainBotToken,
    webhookBaseUrl,
    webhookSecret,
    downloadDir: path.normalize(environment.DOWNLOAD_DIR?.trim() || "data/downloads"),
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    instagramCookiesFile: instagramCookiesFile ? path.normalize(instagramCookiesFile) : null,
    instagramCookiesB64,
  });
}
