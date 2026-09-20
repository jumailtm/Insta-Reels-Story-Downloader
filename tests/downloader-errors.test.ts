import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstagramDownloader } from "../src/downloader.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Instagram download errors", () => {
  it("returns a clean authentication error after a rate limit", async () => {
    const fetchImpl = vi.fn(async () => new Response("login", { status: 429 })) as unknown as typeof fetch;
    const downloader = new InstagramDownloader({ maxBytes: 1024, fetchImpl });
    const temporary = await mkdtemp(path.join(tmpdir(), "instagram-test-"));
    temporaryDirectories.push(temporary);
    let message = "";
    try {
      await downloader.download("https://www.instagram.com/reel/ABC/", temporary);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/requires a logged-in session/);
    expect(message).not.toMatch(/rate-limit|https:\/\//);
  });
});
