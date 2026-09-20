export interface BotCommand {
  readonly command: string;
  readonly description: string;
}

export const BOT_SHORT_DESCRIPTION =
  "Download Instagram Reels and Stories quickly from a shared link.";

export const BOT_DESCRIPTION =
  "Download Instagram Reels and Stories directly in Telegram. " +
  "Send a Reel or Story link and the bot will return the available media. " +
  "Private media works only when the bot has permission to view it.";

export const MAIN_BOT_COMMANDS: readonly BotCommand[] = Object.freeze([
  { command: "start", description: "Start the bot" },
  { command: "help", description: "Show Reel and Story instructions" },
]);
