import { timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { BOT_DESCRIPTION, BOT_SHORT_DESCRIPTION, MAIN_BOT_COMMANDS } from "./commands.js";
import { loadSettings, type Settings } from "./config.js";
import { InstagramDownloader } from "./downloader.js";
import { TelegramClient, type TelegramUpdate } from "./telegram.js";
import { processUpdate } from "./user-bot.js";

interface Runtime {
  readonly settings: Settings;
  readonly telegram: TelegramClient;
  readonly downloader: InstagramDownloader;
}

interface WebhookStatus {
  readonly active: boolean;
  readonly url?: string;
  readonly pending_updates?: number;
  readonly last_error?: string;
  readonly error?: string;
}

function safeSecretEqual(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

function createRuntime(): { runtime: Runtime | null; configurationError: string | null } {
  try {
    let settings = loadSettings();
    if (process.env.VERCEL) {
      settings = Object.freeze({ ...settings, downloadDir: path.join(tmpdir(), "downloads") });
    }
    mkdirSync(settings.downloadDir, { recursive: true });
    const telegram = new TelegramClient(settings.mainBotToken);
    return {
      runtime: {
        settings,
        telegram,
        downloader: new InstagramDownloader({
          maxBytes: settings.maxUploadBytes,
        }),
      },
      configurationError: null,
    };
  } catch (error) {
    return {
      runtime: null,
      configurationError: error instanceof Error ? error.message : "Unknown configuration error",
    };
  }
}

async function configureBotProfile(telegram: TelegramClient): Promise<void> {
  await telegram.setMyCommands(MAIN_BOT_COMMANDS);
  await telegram.setMyShortDescription(BOT_SHORT_DESCRIPTION);
  await telegram.setMyDescription(BOT_DESCRIPTION);
}

export function createApp(): Express {
  const app = express();
  const { runtime, configurationError } = createRuntime();
  let initialized = false;
  let initialization: Promise<void> | null = null;
  let updateQueue: Promise<void> = Promise.resolve();

  async function ensureInitialized(): Promise<void> {
    if (!runtime) throw new Error("Webhook environment is not configured");
    if (initialized) return;
    initialization ??= configureBotProfile(runtime.telegram)
      .catch((error) => console.error("Could not configure the main bot profile", error))
      .then(() => {
        initialized = true;
      });
    await initialization;
  }

  async function ensureWebhookRegistered(): Promise<WebhookStatus> {
    if (!runtime) return { active: false, error: "Webhook environment is not configured" };
    const expectedUrl = `${runtime.settings.webhookBaseUrl}/api`;
    try {
      await configureBotProfile(runtime.telegram);
      let info = await runtime.telegram.getWebhookInfo();
      if (info.url !== expectedUrl) {
        await runtime.telegram.setWebhook(expectedUrl, runtime.settings.webhookSecret);
        info = await runtime.telegram.getWebhookInfo();
      }
      return {
        active: info.url === expectedUrl,
        url: info.url,
        pending_updates: info.pending_update_count,
        last_error: info.last_error_message,
      };
    } catch (error) {
      console.error("Could not enforce the Telegram webhook", error);
      return { active: false, error: error instanceof Error ? error.name : "TelegramError" };
    }
  }

  app.use(express.json({ limit: "1mb" }));

  const health = async (_request: Request, response: Response): Promise<void> => {
    const webhook = await ensureWebhookRegistered();
    response.json({
      ok: configurationError === null,
      configured: configurationError === null,
      configuration_error: configurationError,
      bot: "instagram_reels_and_stories",
      update_mode: "webhook",
      webhook_path: "/api",
      telegram_webhook: webhook,
    });
  };
  app.get("/", health);
  app.get("/api", health);
  app.get("/api/health", health);

  app.post("/api", async (request: Request, response: Response): Promise<void> => {
    if (!runtime) {
      response.status(503).json({ detail: "Webhook environment is not configured" });
      return;
    }
    const secretHeader = request.header("X-Telegram-Bot-Api-Secret-Token");
    if (!safeSecretEqual(secretHeader, runtime.settings.webhookSecret)) {
      response.status(403).json({ detail: "Invalid Telegram webhook secret" });
      return;
    }
    const update = request.body as Partial<TelegramUpdate>;
    if (!Number.isSafeInteger(update?.update_id)) {
      response.status(400).json({ detail: "Invalid Telegram update" });
      return;
    }
    await ensureInitialized();
    const work = updateQueue.then(() => processUpdate(update as TelegramUpdate, runtime));
    updateQueue = work.catch((error) => console.error("Unhandled main-bot update", error));
    await work;
    response.json({ ok: true });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({ detail: "Invalid Telegram update" });
      return;
    }
    console.error("Unhandled HTTP error", error);
    response.status(500).json({ detail: "Internal server error" });
  });
  return app;
}
