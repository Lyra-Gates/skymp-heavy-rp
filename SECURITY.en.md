# Security Policy

*[Português](SECURITY.md) · **English***

This project handles Discord authentication, session tickets, persistent economy and staff permissions. A flaw in any of those affects real players on any server using this base.

## Reporting a vulnerability

**Do not open a public issue.** A public security issue is a map for whoever wants to exploit the flaw before a fix exists — and since this is a public base, that reaches servers beyond your own.

Use one of these:

- **[GitHub Security Advisory](https://github.com/vinicius3232/skymp-heavy-rp/security/advisories/new)** — preferred; allows private discussion and coordinated disclosure.
- Direct contact with the maintainer through the project Discord.

It helps to include: where it is (service and file), what an attacker can do with it, and how to reproduce. Proof of concept is welcome, but **don't test against someone else's server** — only your own.

## What to expect

There's no SLA — this is volunteer-maintained. The commitment is: a reply as soon as possible, a fix prioritized above any feature, and credit to you in the commit and changelog unless you prefer anonymity.

When the fix ships, it's published with an impact description. Servers running this base need to know what to update and why.

## In scope

- Bypassing whitelist, joining without approval, or impersonating another player
- Escalating staff privilege, or running a staff command without permission
- Duplicating gold or items, or any way around `core/transaction-service`
- Reading or altering another player's data (character sheet, inventory, private messages)
- Leaking a server secret through the launcher, the panel, or the in-game UI
- SQL injection, XSS in the panel or in-game UI
- Bypassing modpack parity verification
- Crashing the server with a malformed request

## Out of scope

- **SkyMP's own vulnerabilities** — report at [skyrim-multiplayer/skymp](https://github.com/skyrim-multiplayer/skymp). If it affects how we use it, tell us too.
- **Client cheats** (aimbot, speedhack, ESP). The client is untrusted by design; our defense is the server not believing it. If you found a way to make the **server** accept something the client invented, that **is** in scope.
- Issues requiring physical access to the server machine or already-compromised credentials.
- Volumetric denial of service — that's an infrastructure layer concern.

## Known limitations

Transparency beats pretending full coverage. These are known and documented:

- **Nothing has been validated in a real game session.** The entire gamemode is verified only against a mocked `mp`. See the [QA report](docs/technical/QA_REPORT_2026-08.md).
- **`offlineMode: true` disables authentication.** In that mode the client declares its own `profileId` and the server believes it. It's a lab mode; the examples ship with `offlineMode: false`. Anyone running a public server in `offlineMode` has no authentication at all.
- **Client events are hints, not proof.** `mp.makeEventSource` runs on the client. The server must validate anything coming from there.

If you find something the documentation already acknowledges, it's still worth reporting if the impact is larger than described.

## If you operate a server on this base

- Never commit `.env`. The `.gitignore` covers it, and CI verifies.
- Generate random, distinct `SESSION_SECRET`, `INTERNAL_API_SECRET` and `MASTER_KEY` per environment.
- Keep `GAME_API_BIND_HOST` and internal ports behind a firewall. Only the game server and the game API need to be reachable from outside.
- Use `offlineMode: false` in production. Always.
- Watch `audit_logs` — it exists so staff abuse is detectable.
