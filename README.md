# Instagram Reel and Story Telegram Bot

![Instagram Reel and Story Telegram Bot banner](docs/assets/readme-banner.png)

> Download Instagram Reels and Stories directly through Telegram, with secure webhook handling and optional authenticated access for private media.

This service runs one Telegram bot through one webhook:

```text
Telegram → POST /api → Reel/Story downloader → Telegram media response
```

There is no input-limit system, verification flow, request counter, user
database, admin account, admin notification, admin approval, or admin webhook.

## Supported links

```text
https://www.instagram.com/reel/ABC123/
https://www.instagram.com/stories/username/1234567890/
```

Other Instagram URLs are rejected. The Telegram command menu contains only:

- `/start` — start the downloader
- `/help` — show Reel and Story instructions

The Telegram profile describes the bot as a direct Instagram Reel and Story
downloader and explains that private media requires viewing permission.

## Public and private media

Public Reels and Stories are downloaded when Instagram makes them available to
the downloader. Instagram may require authentication even for some public
Stories.

The service is implemented entirely in TypeScript on Node.js. It uses
Instagram's web endpoints and public Reel metadata directly; it does not invoke
Python or `yt-dlp`. Instagram can still rate-limit hosting-provider IP addresses,
in which case operator-owned session cookies are required.

When Instagram blocks anonymous Reel or Story API access, the bot uses
SnapVideo's public HTTPS endpoint as a credential-free fallback. Only the
normalized public media URL is sent; Telegram tokens, webhook secrets, Instagram
cookies, and URL tracking parameters are never forwarded. Download URLs are
restricted to the provider and Instagram CDN hosts and remain subject to the
configured size limit.


Private media can be downloaded only when the bot operator's Instagram account
is already permitted to view it. The bot never asks Telegram users for an
Instagram username or password and cannot bypass Instagram privacy controls.

For local or Docker use, provide a fresh Netscape-format file containing only
`instagram.com` cookies:

```dotenv
INSTAGRAM_COOKIES_FILE=instagram-cookies.txt
```

For Vercel, Base64-encode the Instagram-only cookie file and store the result as
a sensitive Production environment variable named `INSTAGRAM_COOKIES_B64`:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("instagram-cookies.txt"))
```

Or place the file at `D:\Software\bot\instagram-cookies.txt` and run the included
TypeScript setup helper. It validates the file, stores it as a sensitive Vercel
variable without printing it, and redeploys production:

```powershell
npm run configure:auth -- instagram-cookies.txt
```

Do not set both cookie variables. Never commit cookies, paste them into chat, or
collect another user's password. Instagram sessions expire and must then be
replaced.

## Vercel deployment

The Node.js function entry point is `api/index.ts`:

- `GET /api` — health status and idempotent webhook registration
- `POST /api` — the only Telegram webhook endpoint

Push `main` to deploy automatically, or deploy manually:

```powershell
npx.cmd vercel@latest --prod
```

Configure `MAIN_BOT_TOKEN`, `WEBHOOK_BASE_URL`, and `WEBHOOK_SECRET` in the
Vercel project settings for Production. Configure `INSTAGRAM_COOKIES_B64` there
only when authenticated Instagram access is needed. Never commit real values to
GitHub or place them in `.env.example`; local `.env` files and `.vercel/` state
are ignored.

Before committing or pushing, run the repository secret scan:

```powershell
npm run check:secrets
```

The health response includes `instagram_auth_configured` without exposing the
session. It must be `true` for authenticated private-media access.

## Local development

```powershell
npm install
npm run dev
```

## Tests

```powershell
npm test
npm run check
npm run build
```
