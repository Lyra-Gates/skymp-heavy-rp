# Phase 0 — setup from scratch (guide + known issues)

*[Português](FASE_0_SETUP_DO_ZERO.md) · **English***

There's no README at the repo root. This document is the full onboarding
walkthrough, written on 2026-08-21 after live-supporting an external fork
booting the project for the first time — every item in the known-issues
section came from a real error, not a guess.

Human devs: follow the checklist. Agents: the same steps apply whenever
someone asks to "boot the server" or "set up the project" for the first time
— see also `.agents/skills/run-server/SKILL.md`.

## 0. Prerequisites
- Node.js installed
- MariaDB/MySQL running
- Skyrim SE/AE + SKSE, to test the client afterward

## 1. Dependencies
This is not a single-workspace monorepo — each app has its own
`package.json`, so `npm ci` needs to run in each one:
```
cd apps\web        ; npm ci
cd apps\game-api    ; npm ci
cd apps\bot-discord ; npm ci
cd apps\launcher    ; npm ci
cd skymp\gamemode   ; npm ci
```

## 2. Database
1. Create a schema in MariaDB (e.g. `skymp_rp`).
2. Run `skymp\packages\database\schema.sql` first.
3. Run every `migration-v*.sql` file in the same folder, **in numeric
   order**: `schema.sql` alone is not the full schema, the migrations build
   on top of it.
4. Verify with `npm run check:schema` (inside `skymp\gamemode`) — it
   compares the live database against what the migrations expect.

## 3. `.env` files — copy every `.env.example` to `.env`
```
apps\web\.env.example         -> apps\web\.env
apps\game-api\.env.example    -> apps\game-api\.env
apps\bot-discord\.env.example -> apps\bot-discord\.env
apps\launcher\.env.example    -> apps\launcher\.env
skymp\gamemode\.env.example   -> skymp\gamemode\.env
```
- `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASS`/`DB_NAME` must be identical in
  `apps\web\.env` and `apps\game-api\.env`, and match the schema from step 2.
- Generate every secret (`SESSION_SECRET`, `INTERNAL_API_SECRET`,
  `MASTER_KEY`, `SOUL_SECRET` if you're using it) with:
  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  One value per secret, never reuse.
- `INTERNAL_API_SECRET` must be the **same value** across `apps\web`,
  `apps\game-api`, and `apps\bot-discord`.

## 4. Gamemode JSON config (not `.env`)
From the repo root:
```
.\scripts\phase0\Initialize-LocalConfig.ps1
```
Creates `skymp\config\server-settings.local.json` and
`skymp\config\server-options.local.json` from the `.example` files (only if
they don't already exist).

Also create `skymp\config\database.local.json` (copy from
`database.local.example.json`). **Careful**: this filename is hardcoded in
the code (`skymp\gamemode\database.js` literally reads
`database.local.json`, regardless of environment) — don't rename it to
`.production.json` expecting it to be picked up automatically, even on a
real public server.

In `server-settings.local.json`, `masterKey` must be a random value
**identical** to `MASTER_KEY` in `apps\web\.env`.

## 5. Skyrim assets
The server needs the game's masters in `skymp\data\`. Don't copy them by
hand — use the script, which confirms the size of every file it copies:
```
.\scripts\phase0\Prepare-SkyMPDataDir.ps1 -SkyrimDataPath "D:\...\Skyrim Special Edition\Data" -CopyMasters
```
Copies `Skyrim.esm`, `Update.esm`, `Dawnguard.esm`, `HearthFires.esm`,
`Dragonborn.esm`. See the troubleshooting section if any of these come out
corrupted.

## 6. SkyMP server binary
This repo doesn't build the native server — download the `server-dist`
artifact from the **"PR Windows Flatrim (AE/SE)"** workflow of
`skyrim-multiplayer/skymp` (or from a release) and extract it into:
```
skymp\artifacts\server-dist
```
Then, from the repo root:
```
.\scripts\phase0\Install-SkyMPServerArtifact.ps1
```
Should finish with `Installed server artifact into ...`.

## 7. Discord
- Developer Portal → **Bot** tab: token goes into `DISCORD_BOT_TOKEN` (no
  quotes, no stray whitespace/newline).
- Same tab: enable **"Server Members Intent"** under Privileged Gateway
  Intents — the bot requests `GuildMembers`, and without this toggle login
  fails (and the code only shows a generic message, not the real reason).
- "Application ID" = "Client ID" (same value) → `DISCORD_CLIENT_ID`
  (apps\web, apps\bot-discord) and `VITE_DISCORD_CLIENT_ID` (apps\launcher).

## 8. Tunnel / public domain
In `apps\web\.env`:
- `PANEL_PUBLIC_URL=https://yourdomain.com,https://www.yourdomain.com` (no
  trailing slash on either domain)
- `TRUST_PROXY=true` (mandatory behind any proxy/tunnel — without it the
  rate limiter sees the tunnel's IP for every player and stops protecting
  anything)
- `NODE_ENV=production` when it's ready to go live (enables the `secure`
  cookie)

Only the web panel needs to go through the tunnel. The Skyrim client
connects to the game server (port 7777) directly by IP, not through
Cloudflare.

## 9. Mods manifest
```
cd apps\game-api
node scripts\generate-mods-manifest.js "<server's Data folder>" --plugins-txt "<plugins.txt>"
```
Without this, `/mods.json` returns 503 and no player passes the parity
check.

## 10. Boot everything
From the repo root:
```
.\scripts\phase0\Start-AllServices.ps1
```
Success signals in the SkyMP server log:
- `Using data dir`
- `[phase0] SkyMP Heavy RP gamemode loaded`
- `Server resources folder is listening on 3000`
- port `7777` (UDP) listening

## 11. Launcher
`apps\launcher\.env`:
- `VITE_SERVER_IP`/`VITE_SERVER_PORT` must match `port` in
  `server-settings.local.json` (7777 by default).
- `VITE_PANEL_URL` = the panel's URL (through the tunnel, or
  `http://127.0.0.1:3001` to test locally first).

---

## Known issues and fixes

### "Missing local settings" even though the file exists
This was a real bug in `Install-SkyMPServerArtifact.ps1`: the script
resolved relative paths against the working directory (`Resolve-Path "."`)
instead of the script's own location, so running it from inside
`scripts\phase0` (or via "Run with PowerShell" in Explorer) pointed at the
wrong place.
**Fixed on 2026-08-21** — the script now anchors to `$PSScriptRoot`, same as
`Initialize-LocalConfig.ps1`, and works from any directory.

### `Error: <File>.esm doesn't have TES4 record`
The file in `skymp\data\` is corrupted or isn't the real plugin — every
valid ESM/ESP starts with a `TES4` record. The most common causes on
Windows:
- **Cloud-sync placeholder**: if your Skyrim install lives under
  OneDrive/Dropbox with "Files On-Demand" enabled, Explorer shows the file
  but it can be a 0-byte stub until opened — dragging it copies the stub.
  Fix: use `Prepare-SkyMPDataDir.ps1 -CopyMasters`, which prints the size of
  every file it copies — check it against the real size (HearthFires is
  roughly 3.8–3.9 MB).
- **Mod Organizer 2**: dragging from MO2's virtual view instead of the real
  `Skyrim Special Edition\Data` folder can copy a broken junction/shortcut.
  Point `-SkyrimDataPath` at the real game folder, not MO2's mods folder.

### `database.js` always reads `database.local.json`
Not a bug, it's intentional in the current code, but counterintuitive: even
in production the gamemode's MariaDB credentials file must be named exactly
`database.local.json` — the name is hardcoded in
`skymp\gamemode\database.js`. `database.staging.json`/`database.production.json`
exist as a `.gitignore` convention but aren't read by any code today.

### `server-settings.json` doesn't follow `NODE_ENV`, but `server-options.json` does
Two separate config systems, different behavior:
- `server-options.<NODE_ENV>.json` (gameplay rules) genuinely honors
  `NODE_ENV` from `skymp\gamemode\.env`.
- `server-settings.json` (port, master URL, load order) has no automated
  staging/production pipeline in this repo — `Install-SkyMPServerArtifact.ps1`
  always copies `server-settings.local.json`. The `.staging.example.json`
  files exist as templates to adapt by hand, not something the boot process
  picks automatically.

### Discord bot fails to log in without saying why
`apps\bot-discord\index.js` catches the login error but never logs
`err.message` — it only shows a generic hint about the token. Most common
cause: "Server Members Intent" not enabled in the Developer Portal (the bot
requests `GuildMembers`, which is privileged). Other causes: stray
quotes/whitespace in `.env`, or the Client Secret pasted in by mistake
instead of the token.

### Rate limiter "works" but protects nobody behind the tunnel
Without `TRUST_PROXY=true`, Express sees the Cloudflare Tunnel's IP instead
of the player's — the rate limit keeps responding normally, it just counts
the entire world as a single visitor.
