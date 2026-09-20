import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings } from "../src/config.js";
import { materializeInstagramCookies } from "../src/instagram-auth.js";

const required = {
  MAIN_BOT_TOKEN: "1:main",
  WEBHOOK_BASE_URL: "https://example.vercel.app",
  WEBHOOK_SECRET: "test_webhook_secret",
};
const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function settingsWithCookieData(data: Buffer) {
  return loadSettings({ ...required, INSTAGRAM_COOKIES_B64: data.toString("base64") });
}

describe("Instagram authentication", () => {
  it("materializes an Instagram-only cookie file", async () => {
    const data = Buffer.from(
      "# Netscape HTTP Cookie File\n#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tsecret\n",
    );
    const temporary = await mkdtemp(path.join(tmpdir(), "instagram-auth-test-"));
    temporaryDirectories.push(temporary);
    const updated = materializeInstagramCookies(settingsWithCookieData(data), temporary);
    expect(updated.instagramCookiesFile).not.toBeNull();
    expect(await readFile(updated.instagramCookiesFile!)).toEqual(data);
  });

  it("rejects cookie exports containing other sites", async () => {
    const data = Buffer.from(
      "# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t0\tsessionid\tsecret\n",
    );
    const temporary = await mkdtemp(path.join(tmpdir(), "instagram-auth-test-"));
    temporaryDirectories.push(temporary);
    expect(() => materializeInstagramCookies(settingsWithCookieData(data), temporary)).toThrow(
      /only Instagram cookies/,
    );
  });
});
