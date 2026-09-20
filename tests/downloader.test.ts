import { describe, expect, it } from "vitest";
import { isInstagramStoryUrl, isInstagramUrl } from "../src/downloader.js";

describe("Instagram URL validation", () => {
  it("accepts Reel and Story URLs", () => {
    expect(isInstagramUrl("https://www.instagram.com/reel/ABC123/")).toBe(true);
    expect(isInstagramUrl("https://www.instagram.com/stories/example/123456789/")).toBe(true);
  });

  it("recognizes Story URLs", () => {
    expect(isInstagramStoryUrl("https://www.instagram.com/stories/example/123456789/")).toBe(true);
    expect(isInstagramStoryUrl("https://instagram.com/stories/example/")).toBe(true);
    expect(isInstagramStoryUrl("https://instagram.com/reel/ABC123/")).toBe(false);
    expect(isInstagramStoryUrl("https://instagram.com/stories/example/not-a-number/")).toBe(false);
  });

  it("rejects lookalikes and non-media URLs", () => {
    expect(isInstagramUrl("https://instagram.com.example/reel/ABC123/")).toBe(false);
    expect(isInstagramUrl("https://example.com/instagram.com/reel/ABC123/")).toBe(false);
    expect(isInstagramUrl("https://instagram.com/p/ABC123/?igsh=test")).toBe(false);
    expect(isInstagramUrl("https://instagram.com/example/")).toBe(false);
    expect(isInstagramUrl("not a url")).toBe(false);
  });
});
