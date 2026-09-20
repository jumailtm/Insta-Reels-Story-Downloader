import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

interface Finding {
  readonly file: string;
  readonly reason: string;
}

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const files = execFileSync(
  "git",
  ["-c", `safe.directory=${repositoryRoot.replaceAll("\\", "/")}`, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: repositoryRoot, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const forbiddenNames = [
  /(^|\/)\.env(?:\..+)?$/i,
  /(^|\/)(?:\.npmrc|\.netrc|\.envrc)$/i,
  /(^|\/)(?:credentials?|secrets?)(?:\.[^/]+)?$/i,
  /(^|\/).*(?:service-account|auth).*(?:\.json|\.txt)$/i,
  /(^|\/).*cookies?.*\.txt$/i,
  /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/i,
  /\.(?:pem|key|p12|pfx|keystore|jks|kdbx|session|db|sqlite|sqlite3)$/i,
];
const allowedNames = new Set([".env.example"]);
const contentPatterns: Array<readonly [string, RegExp]> = [
  ["Telegram bot token", /\b\d{6,15}:[A-Za-z0-9_-]{30,}\b/],
  ["GitHub access token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ["OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["Stripe live secret", /\bsk_live_[0-9A-Za-z]{16,}\b/],
  ["SendGrid API key", /\bSG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}\b/],
  ["JSON Web Token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["credential-bearing URL", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/:@]+:[^\s/@]+@/i],
  ["private key", new RegExp(["-----BEGIN ", "(?:RSA |EC |OPENSSH )?", "PRIVATE KEY-----"].join(""))],
];
const findings: Finding[] = [];

for (const file of files) {
  const normalized = file.replaceAll("\\", "/");
  if (!allowedNames.has(normalized) && forbiddenNames.some((pattern) => pattern.test(normalized))) {
    findings.push({ file: normalized, reason: "sensitive filename" });
    continue;
  }

  let content: string;
  try {
    const data = readFileSync(path.join(repositoryRoot, file));
    if (data.includes(0) || data.length > 2 * 1024 * 1024) continue;
    content = data.toString("utf8");
  } catch {
    continue;
  }
  for (const [reason, pattern] of contentPatterns) {
    if (pattern.test(content)) findings.push({ file: normalized, reason });
  }
}

if (findings.length > 0) {
  console.error("Potential secrets detected. No values are shown:");
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.reason}`);
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed for ${files.length} repository files.`);
}
