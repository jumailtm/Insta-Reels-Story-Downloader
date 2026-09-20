import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Settings } from "./config.js";

export const MAX_COOKIE_FILE_BYTES = 256 * 1024;
const COOKIE_HEADERS = new Set(["# HTTP Cookie File", "# Netscape HTTP Cookie File"]);

export interface NetscapeCookie {
  readonly domain: string;
  readonly name: string;
  readonly value: string;
}

export function validateInstagramCookieData(data: Buffer): NetscapeCookie[] {
  if (data.length === 0 || data.length > MAX_COOKIE_FILE_BYTES) {
    throw new Error("Instagram cookies must be between 1 byte and 256 KiB");
  }
  if (!data.every((byte) => byte <= 0x7f)) {
    throw new Error("Instagram cookie file must contain ASCII text");
  }

  const lines = data.toString("ascii").split(/\r?\n/);
  if (!COOKIE_HEADERS.has(lines[0]?.trim() ?? "")) {
    throw new Error("Instagram cookies must use Netscape cookie-file format");
  }

  const cookies: NetscapeCookie[] = [];
  for (const rawLine of lines.slice(1)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#HttpOnly_")) {
      line = line.slice("#HttpOnly_".length);
    } else if (line.startsWith("#")) {
      continue;
    }
    const fields = line.split("\t");
    if (fields.length !== 7) {
      throw new Error("Instagram cookie file contains an invalid cookie row");
    }
    const domain = (fields[0] ?? "").replace(/^\.+/, "").toLowerCase();
    if (domain !== "instagram.com" && !domain.endsWith(".instagram.com")) {
      throw new Error("INSTAGRAM_COOKIES_B64 must contain only Instagram cookies");
    }
    const name = fields[5] ?? "";
    const value = fields[6] ?? "";
    if (!name) {
      throw new Error("Instagram cookie file contains an invalid cookie row");
    }
    cookies.push({ domain, name, value });
  }
  if (cookies.length === 0) {
    throw new Error("Instagram cookie file contains no Instagram cookies");
  }
  return cookies;
}

function decodeBase64Strict(value: string): Buffer {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error("INSTAGRAM_COOKIES_B64 is not valid Base64");
  }
  return Buffer.from(value, "base64");
}

export function materializeInstagramCookies(
  settings: Settings,
  runtimeDir: string,
): Settings {
  if (settings.instagramCookiesFile) {
    let data: Buffer;
    try {
      data = readFileSync(settings.instagramCookiesFile);
    } catch {
      throw new Error("INSTAGRAM_COOKIES_FILE could not be read");
    }
    validateInstagramCookieData(data);
    return settings;
  }
  if (!settings.instagramCookiesB64) return settings;

  const data = decodeBase64Strict(settings.instagramCookiesB64);
  validateInstagramCookieData(data);
  mkdirSync(runtimeDir, { recursive: true });
  const cookiePath = path.join(runtimeDir, ".instagram-cookies.txt");
  writeFileSync(cookiePath, Buffer.from(data.toString("binary").replace(/\r\n/g, "\n"), "binary"));
  try {
    chmodSync(cookiePath, 0o600);
  } catch {
    // Some filesystems do not expose POSIX permissions.
  }
  return Object.freeze({
    ...settings,
    instagramCookiesFile: cookiePath,
    instagramCookiesB64: null,
  });
}

export function readInstagramCookieHeader(cookieFile: string | null): string | null {
  if (!cookieFile) return null;
  const cookies = validateInstagramCookieData(readFileSync(cookieFile));
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}
