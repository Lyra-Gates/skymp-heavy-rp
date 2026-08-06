# RP Server Options schema

*[Português](SERVER_OPTIONS_SCHEMA.md) · **English** · [Русский](SERVER_OPTIONS_SCHEMA.ru.md) · [Español](SERVER_OPTIONS_SCHEMA.es.md)*

> **Status: partially implemented.**
> The file is now loaded and validated by `skymp/gamemode/core/server-options.js`. But **only the options listed under "What is wired today" actually do anything** — the rest is still a design contract.
>
> The loader warns at boot when it finds an option in the file that doesn't do anything yet, and **aborts the boot** if a value has the wrong type or falls outside its range. Failing loudly is deliberate: a mistyped gameplay option that "almost works" is worse than a server that won't start.

> **Where this schema came from:** the original options (`isVanillaSpawn`, `SpawnTimeToRespawn`, `spawnTimeToRespawnNPC` and friends) are the Red House server's — see `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1 (Portuguese). They were copied as design intent and never wired to our code, which explains a schema describing behavior that never existed here. The table below separates what is real from what is still intent.

## 0. What is wired today

| Option | Where it acts |
|---|---|
| `chat.whisperRange` | `core/proximity-ranges.js` — chat **and** voice |
| `chat.localRange` | same. `emote` and `ooc` are derived from it (×5/4 and ×5/3) |
| `chat.shoutRange` | same |
| `chat.oocEnabled` | `rp-chat-service.js` — disables `/ooc` and `/b` in-game |
| `chat.oocRateLimitSeconds` | `rp-chat-service.js` — anti-flood window |
| `rp.permadeathEnabled` | `death-service.js` — bleed-out retires the character instead of respawning |
| `spawn.playerRespawnSeconds` | `death-service.js` — pause between dying and respawning |
| `economy.startingGold` | `whitelist.js` — granted once per character, on first spawn |

Every other option documented below sits in `DECLARED_BUT_UNWIRED` in the loader. When you implement one, move it to `SPEC` and update this table — a test prevents the example file from gaining a new key without someone classifying it.

**About `rp.permadeathEnabled`:** turning this on changes the meaning of every combat scene on the server. A character who bleeds out becomes `status='retired'` (never `DELETE`, the same path as `/permakill`), is notified and disconnected. It's an operations decision, not a configuration detail.

## 1. Purpose

Define a `server-options` of our own for the Heavy RP server, with validation, per-environment profiles and protection against dangerous configurations.

This file does not replace `server-settings.json`. It governs gameplay, RP, staff, chat, spawn and operations rules.

## 2. Principles

- Every option must have a defined type.
- Production must block dangerous options.
- Changes must be auditable.
- Defaults must favor safety.
- Local may be permissive, staging controlled, production restricted.

## 3. Example structure

```json
{
  "environment": "staging",
  "rp": {
    "heavyRpEnabled": true,
    "requireApprovedCharacterForSpawn": true,
    "allowRaceMenuBeforeApproval": false,
    "defaultStartPointPolicy": "approved_character",
    "permadeathEnabled": false
  },
  "chat": {
    "localRange": 1400,
    "whisperRange": 350,
    "shoutRange": 3000,
    "oocEnabled": true,
    "oocRateLimitSeconds": 10,
    "logAllChannels": true
  },
  "staff": {
    "passwordAdminLoginEnabled": false,
    "requireRolePermission": true,
    "requireCommandReason": true,
    "auditAllCommands": true,
    "allowDestructiveCommandsInProduction": false
  },
  "spawn": {
    "vanillaSpawnMode": "selective",
    "playerRespawnSeconds": 300,
    "npcRespawnSeconds": 3600,
    "disableRespawnActorIds": []
  },
  "economy": {
    "serverAuthoritativeCurrency": true,
    "startingGold": 0,
    "logAllTransactions": true
  },
  "debug": {
    "enablePapyrusDebug": false,
    "enableHotReload": false,
    "enableDevTools": false
  }
}
```

## 4. Per-environment profiles

### Local

- May enable debug.
- May enable hot reload.
- May use test commands.
- May use `databaseDriver=file`.
- Must not be exposed publicly.

### Staging

- Limited debug.
- Hot reload only during a technical window.
- Destructive commands allowed only for dev/admin.
- Audit log mandatory.
- Whitelist may use a testers group.

### Production

- `passwordAdminLoginEnabled=false`.
- `requireRolePermission=true`.
- `requireCommandReason=true`.
- `auditAllCommands=true`.
- `allowDestructiveCommandsInProduction=false`, except for an exception list signed off by the owner/lead dev.
- `enableHotReload=false`.
- `enableDevTools=false`.
- `requireApprovedCharacterForSpawn=true`.

## 5. Mandatory validations

Fail the boot in production if:

- Environment is `production` and `passwordAdminLoginEnabled=true`.
- Environment is `production` and `enableHotReload=true`.
- Environment is `production` and `enableDevTools=true`.
- Environment is `production` and `requireApprovedCharacterForSpawn=false`.
- Environment is `production` and `auditAllCommands=false`.
- Environment is `production` and `requireCommandReason=false`.
- `localRange`, `whisperRange` or `shoutRange` are less than or equal to zero.
- `startingGold` is negative.
- `playerRespawnSeconds` is lower than the defined death rule.

## 6. Open decisions

- Final chat range values after in-game testing.
- Whether global OOC stays enabled in production or gets a longer cooldown.
- Whether vanilla spawn will be off, selective or reduced.
- Whether permadeath exists at launch.
- Whether destructive commands may be used during an event with prior authorization.
