# Instagram Reel and Story Telegram Bot

![Instagram Reel and Story Telegram Bot banner](docs/assets/readme-banner.png)

> Download public Instagram Reels and Stories directly through Telegram with secure webhook handling.

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

The Telegram profile describes the bot as a downloader for public Instagram
Reels and Stories.

## Public media only

The bot accepts only Reels and Stories that are publicly available without an
Instagram login. Private accounts, private media, Close Friends Stories, and
other login-protected content are not supported.

The service is implemented entirely in TypeScript on Node.js. It uses
Instagram's web endpoints and public Reel metadata directly; it does not invoke
Python or `yt-dlp`. The bot does not accept or store Instagram usernames,
passwords, cookies, or session credentials.

When Instagram blocks anonymous Reel or Story API access, the bot uses
SnapVideo's public HTTPS endpoint as a credential-free fallback. Only the
normalized public media URL is sent; Telegram tokens, webhook secrets, and URL
tracking parameters are never forwarded. Download URLs are
restricted to the provider and Instagram CDN hosts and remain subject to the
configured size limit.

## Vercel deployment

The Node.js function entry point is `api/index.ts`:

- `GET /api` — health status and idempotent webhook registration
- `POST /api` — the only Telegram webhook endpoint

Push `main` to deploy automatically, or deploy manually:

```powershell
npx.cmd vercel@latest --prod
```

Configure `MAIN_BOT_TOKEN`, `WEBHOOK_BASE_URL`, and `WEBHOOK_SECRET` in the
Vercel project settings for Production. Never commit real values to GitHub or
place them in `.env.example`; local `.env` files and `.vercel/` state are ignored.

Before committing or pushing, run the repository secret scan:

```powershell
npm run check:secrets
```

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
