import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateInstagramCookieData } from "../src/instagram-auth.js";

const cookieFile = path.resolve(process.argv[2] ?? "instagram-cookies.txt");
const data = readFileSync(cookieFile);
validateInstagramCookieData(data);
const encoded = data.toString("base64");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const environment = spawnSync(
  npx,
  ["--yes", "vercel@latest", "env", "add", "INSTAGRAM_COOKIES_B64", "production", "--sensitive", "--force", "--yes"],
  { input: encoded, stdio: ["pipe", "inherit", "inherit"] },
);
if (environment.error) throw environment.error;
if (environment.status !== 0) throw new Error("Vercel rejected the environment variable");

const deployment = spawnSync(npx, ["--yes", "vercel@latest", "--prod", "--yes"], {
  stdio: "inherit",
});
if (deployment.error) throw deployment.error;
if (deployment.status !== 0) throw new Error("Vercel deployment failed");
console.log("Instagram authentication configured and production redeployed.");
