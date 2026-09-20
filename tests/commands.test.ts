import { describe, expect, it } from "vitest";
import { BOT_DESCRIPTION, BOT_SHORT_DESCRIPTION, MAIN_BOT_COMMANDS } from "../src/commands.js";
import { HELP_TEXT, WELCOME_TEXT } from "../src/user-bot.js";

describe("bot commands", () => {
  it("contains only the public user commands", () => {
    expect(MAIN_BOT_COMMANDS.map(({ command }) => command)).toEqual(["start", "help"]);
  });

  it("fits Telegram profile limits", () => {
    expect(BOT_SHORT_DESCRIPTION.length).toBeLessThanOrEqual(120);
    expect(BOT_DESCRIPTION.length).toBeLessThanOrEqual(512);
    expect(BOT_DESCRIPTION).toContain("Reels");
    expect(BOT_DESCRIPTION).toContain("Stories");
    expect(BOT_DESCRIPTION).toContain("publicly available");
    expect(BOT_DESCRIPTION).toContain("not supported");
  });

  it("clearly limits user instructions to public links", () => {
    expect(WELCOME_TEXT).toContain("public Instagram");
    expect(HELP_TEXT).toContain("public Instagram");
    expect(HELP_TEXT).toContain("Private accounts");
    expect(HELP_TEXT).toContain("cannot be downloaded");
  });
});
