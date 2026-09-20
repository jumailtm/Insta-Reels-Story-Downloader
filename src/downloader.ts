import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readInstagramCookieHeader } from "./instagram-auth.js";

export class InvalidInstagramUrl extends Error {
  override name = "InvalidInstagramUrl";
}

export class MediaDownloadError extends Error {
  override name = "MediaDownloadError";
}

export interface DownloadedMedia {
  readonly path: string;
  readonly mimeType: string;
}

interface RemoteMedia {
  readonly url: string;
  readonly mimeType: string;
  readonly id: string;
  readonly publicProvider?: boolean;
}

type JsonRecord = Record<string, unknown>;

const INSTAGRAM_APP_ID = "936619743392459";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SHORTCODE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const PUBLIC_MEDIA_PROVIDER = "https://snapvideo.app";
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

export function isInstagramUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    (host !== "instagram.com" && !host.endsWith(".instagram.com"))
  ) {
    return false;
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const isReel = parts.length === 2 && parts[0]?.toLowerCase() === "reel";
  const isStory =
    (parts.length === 2 || parts.length === 3) &&
    parts[0]?.toLowerCase() === "stories" &&
    (parts.length === 2 || /^\d+$/.test(parts[2] ?? ""));
  return isReel || isStory;
}

export function isInstagramStoryUrl(value: string): boolean {
  if (!isInstagramUrl(value)) return false;
  const parts = new URL(value.trim()).pathname.split("/").filter(Boolean);
  return (
    (parts.length === 2 || parts.length === 3) &&
    parts[0]?.toLowerCase() === "stories" &&
    (parts.length === 2 || /^\d+$/.test(parts[2] ?? ""))
  );
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is JsonRecord => item !== null)
    : [];
}

function firstString(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
}

function extensionFor(mimeType: string, url: string): string {
  const byMime: Record<string, string> = {
    "video/mp4": ".mp4",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  if (byMime[mimeType]) return byMime[mimeType];
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.[a-z0-9]{1,5}$/.test(extension)) return extension;
  } catch {
    // The URL is checked separately before download.
  }
  return ".bin";
}

function mimeFromUrl(url: string, fallback = "application/octet-stream"): string {
  let extension = "";
  try {
    extension = path.extname(new URL(url).pathname).toLowerCase();
  } catch {
    return fallback;
  }
  return (
    {
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    }[extension] ?? fallback
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function providerMediaDetails(url: string, label: string): { id: string; mimeType: string } {
  let filename = "public-story";
  let sourceUrl = "";
  try {
    const token = new URL(url).searchParams.get("token");
    const payloadPart = token?.split(".")[1];
    if (payloadPart) {
      const payload = asRecord(JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")));
      filename = firstString(payload?.filename, filename) ?? filename;
      sourceUrl = firstString(payload?.url, "") ?? "";
    }
  } catch {
    // The label still provides a safe type fallback when the token is opaque.
  }
  const typeHint = `${filename} ${sourceUrl} ${label}`.toLowerCase();
  const mimeType = /(?:\.mp4(?:\?|$)|\bvideo\b)/.test(typeHint)
    ? "video/mp4"
    : /(?:\.(?:jpe?g|png|webp)(?:\?|$)|\b(?:photo|image|thumbnail)\b)/.test(typeHint)
      ? mimeFromUrl(sourceUrl, "image/jpeg")
      : "application/octet-stream";
  return { id: cleanIdentifier(path.parse(filename).name, "public-story"), mimeType };
}

function parsePublicInstagramMedia(html: string): RemoteMedia[] {
  const blocks = (html.match(/<li\b[\s\S]*?<\/li>/gi) ?? [])
    .filter((block) => block.includes("download-items"));
  const sources = blocks.length > 0 ? blocks : [html];
  const selected: RemoteMedia[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const candidates: RemoteMedia[] = [];
    const pattern = /<(?:a\b[^>]*href|option\b[^>]*value)=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:a|option)>/gi;
    for (const match of source.matchAll(pattern)) {
      const directUrl = decodeHtml(match[1] ?? "");
      const label = decodeHtml((match[2] ?? "").replace(/<[^>]+>/g, " "));
      try {
        const parsed = new URL(directUrl);
        const host = parsed.hostname.toLowerCase();
        if (
          parsed.protocol !== "https:" ||
          (host !== "snapcdn.app" && !host.endsWith(".snapcdn.app"))
        ) {
          continue;
        }
      } catch {
        continue;
      }
      const details = providerMediaDetails(directUrl, label);
      candidates.push({ url: directUrl, ...details, publicProvider: true });
    }
    const videos = candidates.filter(({ mimeType }) => mimeType.startsWith("video/"));
    const images = candidates.filter(({ mimeType }) => mimeType.startsWith("image/"));
    const mainMedia = videos.length > 0 ? videos : images.slice(0, 1);
    for (const media of mainMedia) {
      if (!seen.has(media.url)) {
        seen.add(media.url);
        selected.push(media);
      }
    }
  }
  return selected;
}

function shortcodeToMediaId(shortcode: string): string {
  let value = 0n;
  for (const character of shortcode) {
    const digit = SHORTCODE_ALPHABET.indexOf(character);
    if (digit < 0) throw new InvalidInstagramUrl("The Instagram Reel shortcode is invalid");
    value = value * 64n + BigInt(digit);
  }
  return value.toString();
}

function cleanIdentifier(value: unknown, fallback: string): string {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : fallback;
  return text.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || fallback;
}

function collectApiMedia(node: JsonRecord, fallbackId: string): RemoteMedia[] {
  const carousel = asRecords(node.carousel_media);
  if (carousel.length > 0) {
    return carousel.flatMap((item, index) => collectApiMedia(item, `${fallbackId}-${index + 1}`));
  }

  const graphChildren = asRecord(node.edge_sidecar_to_children)?.edges;
  if (Array.isArray(graphChildren)) {
    return graphChildren.flatMap((edge, index) => {
      const child = asRecord(asRecord(edge)?.node);
      return child ? collectApiMedia(child, `${fallbackId}-${index + 1}`) : [];
    });
  }

  const id = cleanIdentifier(node.pk ?? node.id ?? node.shortcode, fallbackId);
  const videoVersions = asRecords(node.video_versions);
  const videoUrl = firstString(videoVersions[0]?.url, node.video_url);
  if (videoUrl) return [{ url: videoUrl, mimeType: "video/mp4", id }];

  const candidates = asRecords(asRecord(node.image_versions2)?.candidates);
  const imageUrl = firstString(candidates[0]?.url, node.display_url, node.thumbnail_src);
  return imageUrl ? [{ url: imageUrl, mimeType: mimeFromUrl(imageUrl, "image/jpeg"), id }] : [];
}

class InstagramRequestError extends Error {
  constructor(message: string, readonly authenticationRelated: boolean) {
    super(message);
  }
}

export interface InstagramDownloaderOptions {
  readonly maxBytes: number;
  readonly cookiesFile?: string | null;
  readonly fetchImpl?: typeof fetch;
}

export class InstagramDownloader {
  readonly maxBytes: number;
  readonly cookiesFile: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly cookieHeader: string | null;

  constructor(options: InstagramDownloaderOptions) {
    this.maxBytes = options.maxBytes;
    this.cookiesFile = options.cookiesFile ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cookieHeader = readInstagramCookieHeader(this.cookiesFile);
  }

  async download(url: string, destination: string): Promise<DownloadedMedia[]> {
    if (!isInstagramUrl(url)) {
      throw new InvalidInstagramUrl("Only Instagram Reel and Story links are accepted");
    }
    await mkdir(destination, { recursive: true });
    const remoteMedia = await this.resolveMedia(url.trim());
    if (remoteMedia.length === 0) {
      throw new MediaDownloadError(
        "Instagram did not return downloadable media. The post may be private or unavailable.",
      );
    }

    const downloaded: DownloadedMedia[] = [];
    for (const [index, media] of remoteMedia.entries()) {
      downloaded.push(await this.downloadFile(media, index, destination));
    }
    return downloaded;
  }

  private instagramHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      "User-Agent": USER_AGENT,
      "X-IG-App-ID": INSTAGRAM_APP_ID,
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://www.instagram.com/",
    };
    if (this.cookieHeader) {
      headers.Cookie = this.cookieHeader;
      const csrf = /(?:^|;\s*)csrftoken=([^;]+)/.exec(this.cookieHeader)?.[1];
      if (csrf) headers["X-CSRFToken"] = csrf;
    }
    return headers;
  }

  private async instagramFetch(url: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        headers: this.instagramHeaders(),
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new InstagramRequestError(
        `Instagram request failed: ${error instanceof Error ? error.message : "network error"}`,
        false,
      );
    }
  }

  private async instagramJson(url: string): Promise<JsonRecord> {
    const response = await this.instagramFetch(url);
    if (!response.ok) {
      throw new InstagramRequestError(
        `Instagram returned HTTP ${response.status}`,
        [401, 403, 429].includes(response.status),
      );
    }
    try {
      const result = asRecord(await response.json());
      if (!result) throw new Error("not an object");
      return result;
    } catch {
      throw new InstagramRequestError("Instagram returned an invalid response", true);
    }
  }

  private async resolveMedia(url: string): Promise<RemoteMedia[]> {
    try {
      return isInstagramStoryUrl(url)
        ? await this.resolveStory(url)
        : await this.resolveReel(url);
    } catch (error) {
      if (error instanceof InvalidInstagramUrl || error instanceof MediaDownloadError) throw error;
      if (!this.cookiesFile && error instanceof InstagramRequestError) {
        try {
          const publicMedia = await this.resolvePublicMedia(url);
          if (publicMedia.length > 0) return publicMedia;
        } catch {
          // Preserve the clean Instagram authentication/unavailable error below.
        }
      }
      if (error instanceof InstagramRequestError) {
        if (error.authenticationRelated) {
          throw new MediaDownloadError(
            this.cookiesFile
              ? "Instagram authentication failed. The bot's session may have expired, or its Instagram account is not allowed to view this media."
              : "Instagram requires a logged-in session for this Reel or Story. The bot owner must configure Instagram cookies.",
          );
        }
        throw new MediaDownloadError("Instagram could not provide downloadable media for this link.");
      }
      throw new MediaDownloadError("Instagram could not provide downloadable media for this link.");
    }
  }

  private async resolveReel(url: string): Promise<RemoteMedia[]> {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const shortcode = parts[1];
    if (!shortcode) throw new InvalidInstagramUrl("The Instagram Reel URL is invalid");
    let apiError: InstagramRequestError | null = null;
    try {
      const mediaId = shortcodeToMediaId(shortcode);
      const data = await this.instagramJson(
        `https://www.instagram.com/api/v1/media/${encodeURIComponent(mediaId)}/info/`,
      );
      const items = asRecords(data.items);
      const media = items.flatMap((item, index) => collectApiMedia(item, `${shortcode}-${index + 1}`));
      if (media.length > 0) return media;
    } catch (error) {
      if (error instanceof InstagramRequestError) apiError = error;
      else throw error;
    }

    const response = await this.instagramFetch(url);
    if (response.ok) {
      const html = await response.text();
      const media = this.extractOpenGraphMedia(html, shortcode);
      if (media.length > 0) return media;
    }
    throw apiError ?? new InstagramRequestError("No Reel media was returned", response.status >= 400);
  }

  private extractOpenGraphMedia(html: string, id: string): RemoteMedia[] {
    const tags = html.match(/<meta\s+[^>]*>/gi) ?? [];
    const media: RemoteMedia[] = [];
    for (const tag of tags) {
      const property = /(?:property|name)=["'](og:(?:video|image)(?::secure_url)?)["']/i.exec(tag)?.[1];
      const content = /content=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!property || !content) continue;
      const directUrl = decodeHtml(content);
      if (property.startsWith("og:video")) {
        media.unshift({ url: directUrl, mimeType: "video/mp4", id });
      } else if (!media.some((item) => item.mimeType.startsWith("video/"))) {
        media.push({ url: directUrl, mimeType: "image/jpeg", id });
      }
    }
    return media.slice(0, 1);
  }

  private async resolveStory(url: string): Promise<RemoteMedia[]> {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const username = parts[1];
    const requestedStoryId = parts[2] ?? null;
    if (!username) throw new InvalidInstagramUrl("The Instagram Story URL is invalid");

    const profile = await this.instagramJson(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    );
    const user = asRecord(asRecord(profile.data)?.user);
    const userId = firstString(user?.id);
    if (!userId) throw new InstagramRequestError("Instagram profile was not found", false);

    const feed = await this.instagramJson(
      `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(userId)}`,
    );
    const reel = asRecord(asRecord(feed.reels)?.[userId]);
    let items = asRecords(reel?.items);
    if (requestedStoryId) {
      items = items.filter((item) => String(item.pk ?? item.id ?? "") === requestedStoryId);
    }
    return items.flatMap((item, index) => collectApiMedia(item, `story-${index + 1}`));
  }

  private async resolvePublicMedia(url: string): Promise<RemoteMedia[]> {
    const normalized = new URL(url);
    normalized.search = "";
    normalized.hash = "";
    const headers = {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    };
    const page = await this.fetchImpl(`${PUBLIC_MEDIA_PROVIDER}/en`, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!page.ok) throw new Error("Public Story provider is unavailable");
    const pageHtml = await page.text();
    if (pageHtml.length > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Provider response is too large");
    const expiration = /k_exp=["']([^"']+)["']/.exec(pageHtml)?.[1];
    const providerToken = /k_token=["']([^"']+)["']/.exec(pageHtml)?.[1];
    if (!expiration || !providerToken) throw new Error("Provider token is unavailable");

    const body = new URLSearchParams({
      k_exp: expiration,
      k_token: providerToken,
      q: normalized.toString(),
      t: "media",
      lang: "en",
      v: "v2",
      html: "",
    });
    const response = await this.fetchImpl(`${PUBLIC_MEDIA_PROVIDER}/api/ajaxSearch`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: PUBLIC_MEDIA_PROVIDER,
        Referer: `${PUBLIC_MEDIA_PROVIDER}/en`,
        "X-Requested-With": "XMLHttpRequest",
      },
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error("Public Story provider rejected the request");
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Provider response is too large");
    const result = asRecord(await response.json());
    const responseHtml = typeof result?.data === "string" ? result.data : "";
    if (result?.status !== "ok" || responseHtml.length > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new Error("Public Story provider returned no media");
    }
    return parsePublicInstagramMedia(responseHtml);
  }

  private async downloadFile(
    media: RemoteMedia,
    index: number,
    destination: string,
  ): Promise<DownloadedMedia> {
    let parsed: URL;
    try {
      parsed = new URL(media.url);
    } catch {
      throw new MediaDownloadError("Instagram returned an invalid media URL.");
    }
    if (parsed.protocol !== "https:") {
      throw new MediaDownloadError("Instagram returned an unsafe media URL.");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(parsed, {
        // Media URLs are signed. Never forward Instagram session cookies to
        // CDN or fallback-provider hosts.
        headers: {
          "User-Agent": USER_AGENT,
          Referer: media.publicProvider
            ? `${PUBLIC_MEDIA_PROVIDER}/`
            : "https://www.instagram.com/",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new MediaDownloadError("Instagram could not provide downloadable media for this link.");
    }
    if (!response.ok || !response.body) {
      throw new MediaDownloadError("Instagram could not provide downloadable media for this link.");
    }
    if (media.publicProvider) {
      const finalHost = new URL(response.url).hostname.toLowerCase();
      const allowedFinalHost =
        finalHost === "snapcdn.app" ||
        finalHost.endsWith(".snapcdn.app") ||
        finalHost === "cdninstagram.com" ||
        finalHost.endsWith(".cdninstagram.com") ||
        finalHost === "fbcdn.net" ||
        finalHost.endsWith(".fbcdn.net");
      if (!allowedFinalHost) {
        await response.body.cancel();
        throw new MediaDownloadError("The public Story provider returned an unsafe media URL.");
      }
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      await response.body.cancel();
      throw new MediaDownloadError("The downloaded media is too large for this bot to upload.");
    }

    const responseMime = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
    const mimeType = responseMime && responseMime !== "application/octet-stream"
      ? responseMime
      : media.mimeType;
    const filename = `${String(index + 1).padStart(3, "0")}-${cleanIdentifier(media.id, "media")}${extensionFor(mimeType, media.url)}`;
    const outputPath = path.join(destination, filename);
    let received = 0;
    const limiter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        received += chunk.length;
        if (received > this.maxBytes) {
          callback(new MediaDownloadError("The downloaded media is too large for this bot to upload."));
        } else {
          callback(null, chunk);
        }
      },
    });
    try {
      // Node and TypeScript's DOM library currently model BYOB streams with
      // slightly different generic constraints. Fetch bodies are async
      // iterables at runtime, which avoids that incompatible type boundary.
      const source = Readable.from(response.body as unknown as AsyncIterable<Uint8Array>);
      await pipeline(source, limiter, createWriteStream(outputPath, { flags: "wx" }));
      const details = await stat(outputPath);
      if (details.size === 0) throw new Error("empty media");
    } catch (error) {
      await rm(outputPath, { force: true });
      if (error instanceof MediaDownloadError) throw error;
      throw new MediaDownloadError("Instagram could not provide downloadable media for this link.");
    }
    return { path: outputPath, mimeType };
  }
}
