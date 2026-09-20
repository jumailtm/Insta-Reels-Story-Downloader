import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { Settings } from "./config.js";
import {
  InstagramDownloader,
  InvalidInstagramUrl,
  MediaDownloadError,
  isInstagramUrl,
  type DownloadedMedia,
} from "./downloader.js";
import {
  getEffectiveMessage,
  TelegramClient,
  TelegramError,
  type TelegramMessage,
  type TelegramUpdate,
} from "./telegram.js";

export const WELCOME_TEXT =
  "👋 Welcome!\n\nSend me an Instagram Reel or Story link and I will download the media.";

export const HELP_TEXT =
  "Send one Instagram Reel or Story URL as text.\n\n" +
  "Supported examples:\n" +
  "https://www.instagram.com/reel/ABC123/\n" +
  "https://www.instagram.com/stories/username/123456789/\n\n" +
  "Private media works only when the bot's Instagram account is permitted to view it. " +
  "Never send your Instagram password to this bot.";

export interface UserBotDependencies {
  readonly settings: Settings;
  readonly downloader: InstagramDownloader;
  readonly telegram: TelegramClient;
}

async function sendMedia(
  telegram: TelegramClient,
  message: TelegramMessage,
  media: DownloadedMedia,
): Promise<void> {
  const kind = media.mimeType.startsWith("video/")
    ? "video"
    : media.mimeType.startsWith("image/")
      ? "photo"
      : "document";
  await telegram.sendMedia(kind, message.chat.id, media.path, media.mimeType);
}

function commandFrom(text: string): string | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/.exec(text);
  return match?.[1]?.toLowerCase() ?? null;
}

export async function processUpdate(
  update: TelegramUpdate,
  dependencies: UserBotDependencies,
): Promise<void> {
  const message = getEffectiveMessage(update);
  if (!message) return;
  const { settings, downloader, telegram } = dependencies;

  if (typeof message.text !== "string") {
    await telegram.sendMessage(message.chat.id, "Please send the Instagram Reel or Story URL as text.");
    return;
  }

  const command = commandFrom(message.text);
  if (command === "start") {
    await telegram.sendMessage(message.chat.id, WELCOME_TEXT);
    return;
  }
  if (command === "help") {
    await telegram.sendMessage(message.chat.id, HELP_TEXT);
    return;
  }
  if (command) {
    await telegram.sendMessage(message.chat.id, "Unknown command. Send /help for instructions.");
    return;
  }

  const url = message.text.trim();
  if (!isInstagramUrl(url)) {
    await telegram.sendMessage(message.chat.id, "Please send a valid Instagram Reel or Story URL.");
    return;
  }

  const progress = await telegram.sendMessage(message.chat.id, "⏳ Downloading...");
  const temporary = await mkdtemp(path.join(settings.downloadDir, "request-"));
  try {
    const mediaFiles = await downloader.download(url, temporary);
    for (const media of mediaFiles) {
      await sendMedia(telegram, message, media);
    }
    await telegram.editMessageText(message.chat.id, progress.message_id, "✅ Done");
  } catch (error) {
    if (error instanceof InvalidInstagramUrl || error instanceof MediaDownloadError) {
      console.info("Instagram download rejected:", error.message);
      await telegram.editMessageText(
        message.chat.id,
        progress.message_id,
        `❌ Could not download that media.\n\n${error.message}`,
      );
    } else if (error instanceof TelegramError) {
      console.error("Telegram media upload failed", error);
      await telegram.editMessageText(
        message.chat.id,
        progress.message_id,
        "❌ The media was downloaded, but Telegram could not upload it.",
      );
    } else {
      console.error("Unexpected Instagram download failure", error);
      await telegram.editMessageText(
        message.chat.id,
        progress.message_id,
        "❌ Something went wrong while downloading that link.",
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
