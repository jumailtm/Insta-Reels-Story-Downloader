import { openAsBlob } from "node:fs";
import type { BotCommand } from "./commands.js";

export class TelegramError extends Error {
  override name = "TelegramError";
}

export interface TelegramChat {
  readonly id: number;
}

export interface TelegramMessage {
  readonly message_id: number;
  readonly chat: TelegramChat;
  readonly text?: string;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly edited_message?: TelegramMessage;
  readonly channel_post?: TelegramMessage;
  readonly edited_channel_post?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly description?: string;
}

export interface WebhookInfo {
  readonly url: string;
  readonly pending_update_count: number;
  readonly last_error_message?: string;
}

export const ALLOWED_UPDATES = ["message", "edited_message"] as const;

export function getEffectiveMessage(update: TelegramUpdate): TelegramMessage | null {
  return (
    update.message ??
    update.edited_message ??
    update.channel_post ??
    update.edited_channel_post ??
    null
  );
}

export class TelegramClient {
  private readonly apiBase: string;

  constructor(
    token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  private async call<T>(method: string, body?: object | FormData): Promise<T> {
    const isFormData = body instanceof FormData;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBase}/${method}`, {
        method: "POST",
        headers: isFormData ? undefined : { "Content-Type": "application/json" },
        body: isFormData ? body : JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new TelegramError(
        `Telegram request failed: ${error instanceof Error ? error.message : "network error"}`,
      );
    }
    let payload: TelegramApiResponse<T>;
    try {
      payload = (await response.json()) as TelegramApiResponse<T>;
    } catch {
      throw new TelegramError(`Telegram returned HTTP ${response.status}`);
    }
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new TelegramError(payload.description ?? `Telegram returned HTTP ${response.status}`);
    }
    return payload.result;
  }

  async sendMessage(chatId: number, text: string): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", { chat_id: chatId, text });
  }

  async editMessageText(chatId: number, messageId: number, text: string): Promise<void> {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
    });
  }

  async sendMedia(
    kind: "video" | "photo" | "document",
    chatId: number,
    filePath: string,
    mimeType: string,
  ): Promise<void> {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set(kind, await openAsBlob(filePath, { type: mimeType }), filePath.split(/[\\/]/).at(-1));
    if (kind === "video") form.set("supports_streaming", "true");
    await this.call(`send${kind[0]?.toUpperCase()}${kind.slice(1)}`, form);
  }

  async setMyCommands(commands: readonly BotCommand[]): Promise<void> {
    await this.call("setMyCommands", { commands });
  }

  async setMyShortDescription(shortDescription: string): Promise<void> {
    await this.call("setMyShortDescription", { short_description: shortDescription });
  }

  async setMyDescription(description: string): Promise<void> {
    await this.call("setMyDescription", { description });
  }

  async getWebhookInfo(): Promise<WebhookInfo> {
    return this.call<WebhookInfo>("getWebhookInfo");
  }

  async setWebhook(url: string, secretToken: string): Promise<void> {
    await this.call("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ALLOWED_UPDATES,
      max_connections: 1,
      drop_pending_updates: false,
    });
  }
}
