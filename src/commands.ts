export interface BotCommand {
  readonly command: string;
  readonly description: string;
}

export const BOT_SHORT_DESCRIPTION =
  "Download public Instagram Reels and Stories from a shared link.";

export const BOT_DESCRIPTION =
  "Download publicly available Instagram Reels and Stories directly in Telegram. " +
  "Send a public Reel or Story link and the bot will return the available media. " +
  "Login-protected media is not supported.";

export const MAIN_BOT_COMMANDS: readonly BotCommand[] = Object.freeze([
  { command: "start", description: "Start the bot" },
  { command: "help", description: "Show Reel and Story instructions" },
]);
