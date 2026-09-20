import { mkdtemp, readFile, rm } from "node:fs/promises";
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

describe("public Story fallback", () => {
  it("selects the video, strips tracking parameters, and sends no credentials", async () => {
    const videoPayload = Buffer.from(
      JSON.stringify({
        filename: "public-story.mp4",
        url: "https://scontent.cdninstagram.com/public-story.mp4",
      }),
    ).toString("base64url");
    const photoPayload = Buffer.from(
      JSON.stringify({
        filename: "public-story.jpg",
        url: "https://scontent.cdninstagram.com/public-story.jpg",
      }),
    ).toString("base64url");
    const videoUrl = `https://dl.snapcdn.app/get?token=x.${videoPayload}.y`;
    const photoUrl = `https://dl.snapcdn.app/get?token=x.${photoPayload}.y`;
    let providerBody = "";

    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/users/web_profile_info/")) {
        return new Response("rate limited", { status: 429 });
      }
      if (url === "https://snapvideo.app/en") {
        expect(new Headers(init?.headers).has("Cookie")).toBe(false);
        return new Response('k_exp="expiry"; k_token="provider-token";');
      }
      if (url === "https://snapvideo.app/api/ajaxSearch") {
        expect(new Headers(init?.headers).has("Cookie")).toBe(false);
        providerBody = String(init?.body);
        return Response.json({
          status: "ok",
          data:
            `<li class="download-items"><a href="${photoUrl}">Download Thumbnail</a>` +
            `<a href="${videoUrl}">Download Video</a></li>`,
        });
      }
      if (url === videoUrl) {
        const response = new Response(new Uint8Array([0, 1, 2, 3]), {
          headers: { "content-type": "video/mp4" },
        });
        Object.defineProperty(response, "url", { value: videoUrl });
        return response;
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const destination = await mkdtemp(path.join(tmpdir(), "public-story-test-"));
    temporaryDirectories.push(destination);
    const downloader = new InstagramDownloader({ maxBytes: 1024, fetchImpl });
    const media = await downloader.download(
      "https://www.instagram.com/stories/example/123456789/?utm_source=share&igsh=tracking",
      destination,
    );

    expect(media).toHaveLength(1);
    expect(media[0]?.mimeType).toBe("video/mp4");
    expect(await readFile(media[0]!.path)).toEqual(Buffer.from([0, 1, 2, 3]));
    expect(providerBody).toContain(
      encodeURIComponent("https://www.instagram.com/stories/example/123456789/"),
    );
    expect(providerBody).not.toContain("utm_source");
    expect(providerBody).not.toContain("igsh");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
