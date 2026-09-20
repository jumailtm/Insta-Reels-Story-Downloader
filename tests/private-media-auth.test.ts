import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstagramDownloader } from "../src/downloader.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function authenticatedDownloader(fetchImpl: typeof fetch) {
  const temporary = await mkdtemp(path.join(tmpdir(), "private-media-test-"));
  temporaryDirectories.push(temporary);
  const cookieFile = path.join(temporary, "instagram-cookies.txt");
  await writeFile(
    cookieFile,
    "# Netscape HTTP Cookie File\n" +
      ".instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tprivate-session\n" +
      ".instagram.com\tTRUE\t/\tTRUE\t0\tcsrftoken\tprivate-csrf\n",
  );
  return {
    destination: path.join(temporary, "downloads"),
    downloader: new InstagramDownloader({ maxBytes: 1024, cookiesFile: cookieFile, fetchImpl }),
  };
}

function mediaResponse(url: string): Response {
  const response = new Response(new Uint8Array([7, 8, 9]), {
    headers: { "content-type": "video/mp4" },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("authenticated private media", () => {
  it("uses cookies for the private Reel API but never forwards them to the CDN", async () => {
    const mediaUrl = "https://scontent.cdninstagram.com/private-reel.mp4";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.includes("/api/v1/media/")) {
        expect(headers.get("Cookie")).toContain("sessionid=private-session");
        expect(headers.get("X-CSRFToken")).toBe("private-csrf");
        return Response.json({ items: [{ pk: "private-reel", video_versions: [{ url: mediaUrl }] }] });
      }
      if (url === mediaUrl) {
        expect(headers.has("Cookie")).toBe(false);
        expect(headers.has("X-CSRFToken")).toBe(false);
        return mediaResponse(mediaUrl);
      }
      return new Response("not found", { status: 404 });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const { downloader, destination } = await authenticatedDownloader(fetchImpl);

    const media = await downloader.download("https://www.instagram.com/reel/PRIVATE/", destination);
    expect(media).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("snapvideo.app"))).toBe(false);
  });

  it("uses cookies for profile and private Story API requests", async () => {
    const mediaUrl = "https://scontent.cdninstagram.com/private-story.mp4";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.includes("/users/web_profile_info/")) {
        expect(headers.get("Cookie")).toContain("sessionid=private-session");
        return Response.json({ data: { user: { id: "42" } } });
      }
      if (url.includes("/feed/reels_media/")) {
        expect(headers.get("Cookie")).toContain("sessionid=private-session");
        return Response.json({
          reels: { "42": { items: [{ pk: "123", video_versions: [{ url: mediaUrl }] }] } },
        });
      }
      if (url === mediaUrl) {
        expect(headers.has("Cookie")).toBe(false);
        return mediaResponse(mediaUrl);
      }
      return new Response("not found", { status: 404 });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const { downloader, destination } = await authenticatedDownloader(fetchImpl);

    const media = await downloader.download(
      "https://www.instagram.com/stories/private_account/123/",
      destination,
    );
    expect(media).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("snapvideo.app"))).toBe(false);
  });
});
