import { describe, expect, it } from "vitest";
import { loadSettings } from "../src/config.js";

const required = {
  MAIN_BOT_TOKEN: "1:main",
  WEBHOOK_BASE_URL: "https://example.vercel.app",
  WEBHOOK_SECRET: "test_webhook_secret",
};

describe("loadSettings", () => {
  it("parses the main bot configuration", () => {
    const settings = loadSettings({ ...required, MAX_UPLOAD_MB: "40" });
    expect(settings.maxUploadBytes).toBe(40 * 1024 * 1024);
    expect(settings).not.toHaveProperty("adminBotToken");
  });

  it("rejects an invalid webhook secret", () => {
    expect(() => loadSettings({ ...required, WEBHOOK_SECRET: "spaces are not allowed" })).toThrow(
      /WEBHOOK_SECRET/,
    );
  });

  it("rejects conflicting cookie sources", () => {
    expect(() => loadSettings({ ...required, INSTAGRAM_COOKIES_FILE: "cookies.txt", INSTAGRAM_COOKIES_B64: "dGVzdA==" })).toThrow(/only one/);
  });
});
