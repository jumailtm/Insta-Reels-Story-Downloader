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

describe("InstagramDownloader", () => {
  it("resolves and downloads Reel media without a Python subprocess", async () => {
    const content = new Uint8Array([0, 1, 2, 3]);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/v1/media/")) {
        return Response.json({
          items: [{ pk: "123", video_versions: [{ url: "https://cdn.example/video.mp4" }] }],
        });
      }
      if (url === "https://cdn.example/video.mp4") {
        return new Response(content, {
          headers: { "content-length": String(content.length), "content-type": "video/mp4" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const destination = await mkdtemp(path.join(tmpdir(), "instagram-download-test-"));
    temporaryDirectories.push(destination);

    const downloader = new InstagramDownloader({ maxBytes: 1024, fetchImpl });
    const media = await downloader.download(
      "https://www.instagram.com/reel/ABC123/",
      destination,
    );

    expect(media).toHaveLength(1);
    expect(media[0]?.mimeType).toBe("video/mp4");
    expect(await readFile(media[0]!.path)).toEqual(Buffer.from(content));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a declared media size above the upload limit", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/v1/media/")) {
        return Response.json({
          items: [{ pk: "123", video_versions: [{ url: "https://cdn.example/large.mp4" }] }],
        });
      }
      return new Response(new Uint8Array([0]), {
        headers: { "content-length": "2048", "content-type": "video/mp4" },
      });
    }) as unknown as typeof fetch;
    const destination = await mkdtemp(path.join(tmpdir(), "instagram-download-test-"));
    temporaryDirectories.push(destination);

    const downloader = new InstagramDownloader({ maxBytes: 1024, fetchImpl });
    await expect(
      downloader.download("https://www.instagram.com/reel/ABC123/", destination),
    ).rejects.toThrow(/too large/);
  });
});
