# System architecture (SkyMP Heavy RP)

*[Português](ARCHITECTURE.md) · **English** · [Русский](ARCHITECTURE.ru.md) · [Español](ARCHITECTURE.es.md)*

The SkyMP Heavy RP server runs on a distributed architecture, separating critical services to guarantee security, stability and strict adherence to the rule of **Server Authority**.

## 1. Server topology

The infrastructure splits into the following modules:

### 1.1 Database (MariaDB/MySQL)
**MariaDB** is the absolute source of truth. Every service connects to it.
- **Main tables:** `accounts`, `characters`, `character_inventory`, `audit_logs`, `whitelist_applications`, `staff_roles`, `factions`, `holds`, `properties`, `market_stalls`, `crafting_recipes`, `crafting_ingredients`. The full schema lives in `skymp/packages/database/schema.sql` plus migrations `v2`–`v10`, applied **in order** (v6 = `launch_tickets`, v7 = indexes for the hot queries, v8 = `game_sessions`, v9 = `characters.gold` for databases predating the column, v10 = the four Soul Affinity tables: `character_soul`, `character_signs`, `character_marks`, `character_paths`).
- Some tables exist in the schema but aren't read by any active code (`store_purchases`, `trade_routes`, `magic_licenses`, `magic_violations`, `character_diseases`, `staff_permissions`) — they belong to PARKED modules (see 1.4).
- **Strict rule:** no game state change (money, positions, items) happens without being written to or read from MariaDB. Node.js does not trust loose in-memory data over long stretches without persistence.

### 1.2 Web app and API (`apps/web`)
Built with **Express.js / Node.js**.
- Serves the web panel (whitelist, staff, out-of-game profiles).
- Serves the **launcher** the Discord OAuth exchange (`POST /api/launcher/oauth/exchange`, which also issues the launch ticket) and receives crash reports. The mods manifest does **not** come from here — it comes from `apps/game-api` and GitHub Releases (see 1.3.1 and `LAUNCHER_DISTRIBUTION.md`).
- Authentication is mandatory, via `passport-discord`.
- Not to be confused with the **in-game player panel** (see 1.4.2), which runs inside SkyMP's own HUD, not in a browser.
- **Character application** (`/api/apply`, `apply.html`): besides name and biography, it collects `motivations`/`weaknesses`/`social_ties` (the Heavy RP whitelist rubric — see `SKYMP_RP_DEVELOPMENT_PLAN.md` §8.1). A keyword heuristic (`detectsStrongConcept` in `server.js`) flags `characters.needs_extra_review` for strong concepts (nobility, vampirism, lycanthropy, Daedra, faction leadership) — it isn't an automatic gate, just a signal for staff to look harder; staff can attach `extra_review_notes` through the panel (`PATCH /api/whitelist/:id`). `skymp/gamemode/whitelist.js` reads `characters` with `ORDER BY id DESC LIMIT 1` when releasing spawn.

### 1.2.1 Master API (SkyMP's contract, served by `apps/web`)
`GET /api/servers/:masterKey/sessions/:session` → `{ user: { id, discordId } }`

We did not invent this endpoint: it's what the SkyMP server calls when `offlineMode: false` (see `skymp5-server/ts/systems/login.ts` upstream). The `user.id` we answer with **becomes the gamemode's `profileId`**.

This is the piece that takes identity out of the client's hands. With `offlineMode: true`, the client declares its own `profileId` in `skymp_config.json` and the server believes it — anyone edits the file and becomes someone else. With `offlineMode: false`, the `profileId` comes from here, from the same service that authenticated Discord and approved the whitelist.

SkyMP's default `master` is `https://gateway.skymp.net`; pointing it at our panel is one string in `server-settings.json`. `masterKey` must match on both sides (`MASTER_KEY` in the panel's `.env`).

Sessions live in `game_sessions`, stored as a SHA-256 hash, with `expires_at`, `revoked_at` (immediate ban without waiting for TTL) and `resolve_count` (a high count suggests a session shared across machines).

### 1.3 Discord bot (`apps/bot-discord`)
Built with **discord.js**.
- Bridges the user's Discord account to their in-game `profileId` (`POST /api/sync-role`, called by the web panel on whitelist approval/rejection).
- **Temporary voice channels** (`voiceChannels.js`, commands `/voz-criar <name>` and `/voz-fechar`, staff-only): a practical voice alternative while native in-game VOIP (`/voz`, see 1.4.4) depends on a client patch that hasn't been applied (`docs/technical/VOICE_CLIENT_PATCH.md`). A channel is deleted automatically ~30s after going empty. Commands are registered at bot boot (`deploy-commands.js` runs on the `ready` event); a failure there doesn't take the bot down, but it shouts in the log. `npm run deploy-commands` still exists for manual runs.
- **Moderation log** (`moderationLog.js`, internal endpoint `POST /api/moderation-log`): posts an embed to a configurable channel (`MODERATION_LOG_CHANNEL_ID`) on every moderation action. It was the original intent recorded here and went years without an implementation; it landed on 2026-08-07.

  **The channel is not the record - it is a notification.** The record is still `audit_logs`, written by the gamemode and by the panel in the same flow as the action, before anything leaves for Discord. That distinction decides the failure behaviour: if Discord is down, the moderation action happens anyway, nothing is undone and nothing gets slower. The endpoint answers **202 before** talking to Discord, and no producer awaits the send.

  | Event | Producer | Source |
  |---|---|---|
  | `kick` | `admin-service.kickPlayer` (`/kick`) | `gamemode` |
  | `permakill` | `admin-service.retireCharacter` (`/permakill`) | `gamemode` |
  | `whitelist_approve` / `whitelist_reject` / `whitelist_reset` | `apps/web` `PATCH /api/whitelist/:id` | `painel` |
  | `ban` | **none** - see below | - |

  **`ban` is declared and has no producer.** `ban` is a permission granted by the `admin` and `owner` roles in `admin-service.js` that **no command consumes**: there is no `/ban` in the gamemode nor in the panel. The event type stays declared (with a test locking its shape) so that the day the command exists it costs one line - but the log does not invent an action the server does not have.

  **Why push and not polling `audit_logs`.** The bot has `mysql2` in `dependencies` without using it, so reading the table was possible. Discarded: it would hand database credentials to a third process to read what it does not write, in exchange for polling latency. The push leaves from where the action happens, and the only secret crossing is the `INTERNAL_API_SECRET` the panel already shares with the bot. The gamemode uses core `http.request` instead of `fetch` - the Node version embedded in SkyMP is not under our control, and global `fetch` only exists from Node 18 on.

  **An empty channel disables the send.** Without `MODERATION_LOG_CHANNEL_ID` the endpoint still answers 202 and posts nothing; without `BOT_INTERNAL_URL`/`INTERNAL_API_SECRET` in the gamemode `.env`, the gamemode does not even try. A server that does not want the channel pays nothing and sees no error. The channel must be staff-private: the embeds carry kick reasons and whitelist review notes.

  Tested with `discord.js` mocked (21 tests), in the same pattern as the 19 that already existed. Not covered: posting to a real channel, which needs a real bot and guild.

### 1.3.1 Game API (`apps/game-api`)
Express, port `GAME_API_PORT` (7758) — the port the launcher always called and for which no server existed. Details in `docs/technical/LAUNCHER_DISTRIBUTION.md`.
- **`GET /mods.json`**: modpack parity manifest (`{mods, loadOrder}`), generated offline by `scripts/generate-mods-manifest.js` from a reference `Data/` folder. A missing or corrupt manifest answers **503**, never an empty list — an empty list would pass the launcher's verification and let any modpack in.
- **Queue** (`POST /api/queue/join`, `GET /api/queue/status`): fixed capacity, FIFO, with reservation expiry so that someone who closes the launcher after being admitted doesn't hold the slot forever. Authenticated by a single-use ticket issued by the panel (`launch_tickets`, migration v6) — `discordId` is public and is not proof of identity.
- **Game session**: on admitting someone, it writes a row in `game_sessions` (migration v8) and returns the token to the launcher, which writes it as `session` in `skymp_config.json`. That token is what the SkyMP server resolves against the master API (see 1.2.1) — that's how identity stops being a client declaration.
- **`POST /internal/session/resolve` / `/release`** (`X-Internal-Secret`): slot release on disconnect. `resolve` became redundant once the native session path existed — kept only while in-game testing hasn't confirmed the master API flow.

### 1.4 Native SkyMP server (gamemode)
Located in `skymp/gamemode/`.
- Runs on Node.js using SkyMP's internal libraries (`mp.events`, `mp.players`).
- Handles the player lifecycle: connection, disconnection, spawn, combat, chat commands and real-time item persistence.
- Delegates business rules to the services active today (`governance-service.js`, `market-stalls-service.js`, `death-service.js`, `player-panel-service.js`, `voip-service.js`, `soul-service.js`). Six other services exist on disk (`economy-regional.js`, `crafting-service.js`, `jobs-service.js`, `housing-service.js`, `horse-service.js`, `trade-service.js`) but are **PARKED** — never registered in `core/module-registry.js`, therefore never running in production (see the comment in `phase0-basic.js`). Five others (`economy-service`, `justice-service`, `faction-service`, `survival-service`, `disguise-service`) were **deleted** for duplicating active systems or being unsafe — see `docs/technical/PARKED_SERVICES_DECISION.md`.
- Modules are registered and toggled through `core/module-registry.js` (`ENABLE_*` flags in `.env`), which also handles inter-module dependencies and automatic command registration in `core/command-registry.js`.
- **Gameplay configuration** comes from `skymp/config/server-options.<env>.json`, loaded and validated by `core/server-options.js`. Only the options listed in that file's `SPEC` take effect — the loader warns at boot if it finds an option not yet implemented, and **aborts the boot** if a value has the wrong type or is out of range. See `docs/technical/SERVER_OPTIONS_SCHEMA.en.md`.
- **Soul Affinity domain** in `core/soul.js` — generator with a fixed budget, bands, a seed derived from the approved application, and resolution into four outcomes. It is a **pure function**: no database, no `mp`, no side effects. That is exactly why it exists ahead of the service — it is provable outside the server, and it is where being wrong costs the most later. Design in [`docs/design/SOUL_AFFINITY.md`](design/SOUL_AFFINITY.md) (Portuguese); the **service** that talks to the world (signs, marks, tree) is still blocked by in-game testing.
- **`mp` API typings**: `skymp/gamemode/types/mp.d.ts` (SkyMP publishes no typings). `npm run typecheck` is informational — the gamemode stays plain JS loaded directly by the server, with no build step.

#### 1.4.1 UI bridge (CEF)
Communication between the gamemode and the CEF UI (`skymp/ui/`) uses two SkyMP properties registered in `phase0-basic.js`:
- **`browserModal`**: channel for one-off modals (e.g. the governance interaction menu). `updateOwner` runs `ctx.sp.browser.executeJavaScript('window.handleServerModal(...)')` on the client.
- **`panelData`**: the player panel's dedicated channel, shaped `{ channel, data }` — the client dispatches to `window.handlePanelData(...)` and each tab (`status`, `governance`, `economy`, `social`) renders its own block.

In the UI→server direction, `mp.onUiEvent` dispatches every event through `core/ui-event-router.js`, which routes by the prefix of `uiEvent.type` (e.g. `governance:*` → `governance-service.js`, `panel:*` → `player-panel-service.js`). New modules that need UI just call `uiEventRouter.register('<prefix>', handler)` in their `initialize()` — there's no need to edit `phase0-basic.js` for each new event type.

#### 1.4.2 Player panel (in-game)
`player-panel-service.js` — module `player-panel` (`ENABLE_PLAYER_PANEL_SERVICE`), opened by the `/painel` command. It duplicates no business logic: it only aggregates reads from existing services.
- **Status**: health/magicka/stamina read via `mp.callPapyrusFunction('method', 'Actor', 'getActorValue', ...)` (the same pattern as `death-service.js`), gold via `core/transaction-service.js`, RP state via `core/character-state.js`. Updated by 2s polling while the panel is open, resending only when a value changes.
- **Governance**: `governance-service.getMyGovernanceSummary()`.
- **Economy**: `market-stalls-service.getMyEconomySummary()`.
- **Social**: the character's own `character_known_identities` list.
- UI in `skymp/ui/player-panel.css` / `player-panel.js`, with a visual identity mirroring [Prisma UI](https://prismaui.dev) (black glass card, violet glow, status chip, pill navigation with Elder Futhark runes as each tab's icon).
- **Proactive refresh**: `core/panel-refresh-bus.js` is a decoupled `EventEmitter` — `governance-service.js` calls `panelRefreshBus.requestRefresh(actorId, 'governance'|'status')` after a fine, warrant or arrest, and `player-panel-service.js` (the single subscriber, registered in `initPlayerPanelService`) resends the matching section **only if that player's panel is already open**. It exists so `governance-service.js` doesn't have to depend on `player-panel-service.js` (which already depends on it), without forcing the panel to pop open on the player's screen.
- **Direct action in the Social tab**: each known person has a "Nickname" button that opens an inline mini-form (`skymp/ui/player-panel.js`, `socialRow`/`bindSocialRenameHandlers`) and sends `panel:social:rename` with `{ targetCharacterId, alias }`. `player-panel-service.renameKnownPerson` calls `identity-service.upsertKnownIdentity` directly by characterId — it works even with the target disconnected, since `character_known_identities` doesn't depend on an active actorId.

#### 1.4.3 Death and consequence (`death-service.js`)
Module `death` (`ENABLE_DEATH_SERVICE`), phase `lab`. It exists so that "dying" carries mechanical and social weight rather than being a non-event — a core Heavy RP principle from `SKYMP_RP_DEVELOPMENT_PLAN.md` (§8.1, "Death and Consequences").
- Death → `core/character-state.js` becomes `DOWNED`, which already blocks gameplay/combat/speech through `core/action-policy.js` with no extra work. The primary trigger is the native hook **`mp.onDeath(actorId, killerId)`**, which fires on the frame of death; the 2s polling remains as a safety net while the hook isn't confirmed in a real session (`handlePlayerDowned` is idempotent per character, so both paths together duplicate nothing).
- **Attribution**: `mp.onDeath` delivers `killerId` — who killed, `0` when there is no author. Written to `audit_logs` as `death:killer` and carried until bleed-out, which happens minutes later. That is attribution, unlike `logDeathContext`'s proximity, which is circumstantial: in a five-person brawl, five names appear and staff decide by eye.
- **Rescue**: `/socorrer <actorId>` (any player, within `RESCUE_RANGE`) cancels the bleeding and stabilizes the target back to `NORMAL` with partial health (`STABILIZE_HEALTH`). Range validated by `core/range-utils.js` (extracted from `governance-service.js`, used by both).
- **Bleed-out**: if nobody rescues within `BLEED_OUT_MS` (4 min), the character becomes `DEAD`, a gold penalty is applied via `core/transaction-service.removeGold` (atomic — never leaves a negative balance), and only then does respawn happen at the usual safe point.
- **Anti-RDM evidence**: at bleed-out, `logDeathContext` writes to `audit_logs` (`action='death:context'`) a snapshot of who was nearby (the same proximity radius as `say` chat) — it's circumstantial, not attribution. Attribution of who killed comes from `mp.onDeath`'s `killerId` (see above); the proximity snapshot stays useful because it shows **who was on the scene**, which is the question staff ask in a group RDM report.
- Every transition (`DOWNED`/rescued/penalized/respawned) calls `panelRefreshBus.requestRefresh(actorId, 'status')`, reflecting in real time in `/painel`.
- **Minimum RP layer for combat**: there is no reliable native hook for "who attacked whom" in this base, so the scope is evidence, not enforcement. `/iniciar <actorId> <reason>` writes an explicit marker of an IC conflict opening to `audit_logs` (`combat:initiate`). In parallel, the same HP polling that detects `DOWNED` also runs `checkDamageSpike` every tick — a health drop `>= DAMAGE_SPIKE_THRESHOLD` (a heuristic, 25 points) in a single 2s tick fires `logDeathContext(..., 'damage_spike')`, creating a proximity trail even when nobody uses `/iniciar`. `core/range-utils.js` gained `nearbyActors()` so the neighbor-scan logic isn't duplicated between death context and damage context.

**Permanent death (soft delete):** `admin-service.retireCharacter(actorId, targetActorId, reason)`, command `/permakill` (permission `retire_character`, tiers `admin`/`owner` only — never moderator). It never does `DELETE` — only `UPDATE characters SET status='retired'`, with a mandatory reason and an audit log. `whitelist.js` only allows spawn with `status='approved'`, so a `retired` character never enters play again without any other change being needed.

#### 1.4.4 Proximity voice (`voip-service.js`)
Module `voip` (`ENABLE_VOIP_SERVICE`), phase `lab`. WebRTC signaling (offer/answer/ICE) over its own WebSocket (port `VOIP_PORT`, default 7778) — the audio itself is P2P between clients after the handshake; the server only exchanges signaling and computes volume by distance every 2s. Ranges come from `core/proximity-ranges.js`, the single source for chat **and** voice — the two tables used to diverge (voice whispered at 200, chat at 450), so the same gesture of stepping close to speak quietly worked or didn't depending on the channel.

**Before this revision the feature existed only on paper** — nothing in `phase0-basic.js` called `startVoipServer()`, and the client's `mp.events.add('voip:connect', ...)` listener never fired because no server code does a `mp.trigger`/emit of that event anywhere in the gamemode. It wasn't a visibly broken indicator (the status chip is `display:none` until `setStatus()` runs, and that never happened) — the feature was simply absent, silently.

- **Opt-in via `/voz`** (not forced — and as of 2026-08-07 **native voice is not a launch prerequisite**: the decision is closed in `SKYMP_RP_DEVELOPMENT_PLAN.md` §13, which classifies this module as optional/post-Alpha and points to the Discord voice channels (1.3) as the real solution for Alpha and the closed Beta). The command calls `requestVoiceConnection`, which issues a single-use ticket (`issueTicket`, 30s TTL) and pushes `{actorId, ticket, host, port}` to the client via the `voipTicket` property (the same proven pattern as `browserModal`/`panelData`).
- **Ticket authentication**: the WebSocket handshake (`{type:'auth', actorId, ticket}`) requires the ticket to match what was issued for that `actorId` — without it, any process connecting to `ws://127.0.0.1:7778` could claim another player's `actorId` and hijack their voice slot. The ticket is consumed on first use (replay fails).
- **Dynamic host**: since `skymp/ui/index.html` is a static file with no templating, it can't know the server's public IP on its own — so the server sends `host`/`port` in the ticket payload itself (`VOIP_PUBLIC_HOST`/`VOIP_PORT` in `.env`), instead of the client hardcoding `ws://127.0.0.1:7778` (which only worked with player and server on the same machine).
- `VOIP_BIND_HOST` (default `127.0.0.1`) controls which interfaces the `WebSocketServer` listens on — not to be confused with `VOIP_PUBLIC_HOST`, which is what the client receives in order to connect.
- **The failure path is part of the design, not an afterthought.** On the official client `getUserMedia` returns `NotAllowedError` (see `docs/technical/VOICE_CLIENT_PATCH.md`), and that is what players will hit until the §13 decision is revisited — so it is the common path, not the exception. `skymp/ui/index.html` closes signaling and shows the reason in two places: the status chip (state) and the `chat-log` (the why, pointing to `/voz-criar` on Discord). `onclose` must not overwrite a terminal reason already on screen — on its own it would say "VOZ DESCONECTADA", which reads as server instability and sends the player to file the wrong ticket.

### 1.5 Client launcher (`apps/launcher`)
Built with **Electron / React**. Full details in `docs/technical/LAUNCHER_DISTRIBUTION.md`.
- **Updates** to client and modpack come from **GitHub Releases** (`VITE_GITHUB_DIST_REPO`), with mandatory SHA-256 — a manifest without a hash aborts the install rather than installing unverified. It does not come from `apps/web`: the `GET /api/launcher/manifest` that lived there was a stub with a fake hash that nobody consumed, and it was removed.
- **Connection-time parity** (`verify-mods` + `analyze-plugins`) compares the hash of every file in `Data/` and validates masters/load order against `http://<SERVER_IP>:<VITE_API_PORT>/mods.json`. That endpoint is served by `apps/game-api` (see 1.3.1) — when this document said it didn't exist, that was true: the launcher called a port with no service and the step always failed as "server offline". The service came into existence on 2026-08-05. **It has not been exercised against a packaged launcher**, only by automated tests.
- **Login**: the launcher only captures Discord's `code`; the token exchange is done by the web panel (`POST /api/launcher/oauth/exchange`), because any secret embedded in an app distributed to players can be extracted from the installer.
- Configuration comes from `VITE_*` variables inlined at **build time** by `vite.config.ts`'s `define` — there is no `.env` on the packaged app's side.

## 2. Decision flow (the golden rule)

On our server, authority is never delegated to the client.

**Example flow (fishing or smithing):**
1. The player (client) presses a button to interact.
2. The gamemode (server) receives the request, checks in the database whether they have the rod/resource and the required skill.
3. The server changes the database, saves the new item.
4. The server fires `mp.callPapyrusFunction` only so the client plays the animation and gets the visual success notice.
*(If a local mod tries to skip step 2, it fails silently, protecting the economy.)*

The technical detail of this rule — what a mod can and cannot touch, why mod Papyrus scripts produce no state, and the FormID contract that forces load order parity — is in [`MODS_AND_GAMEMODE_CONTRACT.en.md`](technical/MODS_AND_GAMEMODE_CONTRACT.en.md).
