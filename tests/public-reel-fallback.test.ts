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

describe("public Reel fallback", () => {
  it("downloads the video when Instagram blocks anonymous API access", async () => {
    const payload = Buffer.from(
      JSON.stringify({
        filename: "public-reel.mp4",
        url: "https://scontent.cdninstagram.com/public-reel.mp4",
      }),
    ).toString("base64url");
    const videoUrl = `https://dl.snapcdn.app/get?token=x.${payload}.y`;
    let providerBody = "";

    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/media/")) return new Response("rate limited", { status: 429 });
      if (url.startsWith("https://www.instagram.com/reel/")) {
        return new Response("login required");
      }
      if (url === "https://snapvideo.app/en") {
        return new Response('k_exp="expiry"; k_token="provider-token";');
      }
      if (url === "https://snapvideo.app/api/ajaxSearch") {
        providerBody = String(init?.body);
        return Response.json({
          status: "ok",
          data: `<li class="download-items"><a href="${videoUrl}">Download Video</a></li>`,
        });
      }
      if (url === videoUrl) {
        expect(new Headers(init?.headers).has("Cookie")).toBe(false);
        const response = new Response(new Uint8Array([4, 5, 6]), {
          headers: { "content-type": "video/mp4" },
        });
        Object.defineProperty(response, "url", { value: videoUrl });
        return response;
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const destination = await mkdtemp(path.join(tmpdir(), "public-reel-test-"));
    temporaryDirectories.push(destination);
    const downloader = new InstagramDownloader({ maxBytes: 1024, fetchImpl });
    const media = await downloader.download(
      "https://www.instagram.com/reel/DcLc7LhC7jc/?utm_source=share&igsh=tracking",
      destination,
    );

    expect(media).toHaveLength(1);
    expect(media[0]?.mimeType).toBe("video/mp4");
    expect(await readFile(media[0]!.path)).toEqual(Buffer.from([4, 5, 6]));
    expect(providerBody).toContain(
      encodeURIComponent("https://www.instagram.com/reel/DcLc7LhC7jc/"),
    );
    expect(providerBody).not.toContain("utm_source");
    expect(providerBody).not.toContain("igsh");
  });
});
