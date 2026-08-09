# SkyMP upstream: what exists and what we can use

*[Português](SKYMP_UPSTREAM_REFERENCE.md) · **English** · [Русский](SKYMP_UPSTREAM_REFERENCE.ru.md) · [Español](SKYMP_UPSTREAM_REFERENCE.es.md)*

Survey done on 2026-08-05 straight from the official repository (`github.com/skyrim-multiplayer/skymp`, C++, 313 stars, last push 2026-07-25).

The goal is that nobody here reinvents what SkyMP already delivers — and that nobody tries to use what it doesn't.

---

## 1. Where the official documentation lives

It isn't the GitHub wiki and it isn't the `README`: it's the repository's **`docs/`** folder. The files that matter:

| File | About |
|---|---|
| `docs_serverside_scripting_reference.md` | The gamemode's `mp` API |
| `docs_events_system.md` | `mp.makeEventSource` — client→server events |
| `docs_properties_system.md` | Properties and synchronization |
| `docs_clientside_scripting_reference.md` | The `ctx` object inside client snippets |
| `docs_onhit_and_damage.md` | The OnHit packet and the damage formula |
| `docs_server_ports_usage.md` | Ports and debug tools |
| `docs_database_drivers.md` | `file`, `mongodb`, `zip` |
| `docs_server_configuration_reference.md` | `server-settings.json` |

To read them without cloning (`raw.githubusercontent.com` returns 404 through fetch tools):

```bash
gh api repos/skyrim-multiplayer/skymp/contents/docs/docs_events_system.md --jq '.content' | base64 -d
```

---

## 2. The discovery that changes our code the most: `mp.makeEventSource`

Today **three of our services poll every 2 seconds** — `death-service.js` (detects HP≤0 and damage spikes), `player-panel-service.js` (panel vitals) and `voip-service.js` (volume by distance). That was written assuming there was no alternative.

There is. `mp.makeEventSource(name, functionBody)` injects a JS snippet into the client that runs in the game loop and calls `ctx.sendEvent()` whenever it wants; the server receives it via `mp._eventName = (pcFormId) => {}`.

```js
// A custom name MUST start with an underscore.
mp.makeEventSource("_onLocalDeath", `
  ctx.sp.on("update", () => {
    const pl = ctx.sp.Game.getPlayer();
    const isDead = pl.getActorValuePercentage("health") === 0;
    if (ctx.state.wasDead !== isDead) {
      if (isDead) ctx.sendEvent();
      ctx.state.wasDead = isDead;
    }
  });
`);
mp._onLocalDeath = (pcFormId) => { /* ... */ };
```

That example is literally the one from the official documentation — and it's exactly our `death-service` case.

**What this would solve:**
- Death detected on the frame it happens, instead of up to 2s later. In an RP scene, a 2s delay entering `DOWNED` is the difference between the scene working and not working.
- The end of `checkDamageSpike` as a heuristic: instead of inferring damage from an HP drop between ticks, the client reports the event.
- Server CPU cost stops growing linearly with the number of connected players.

**The honest caveat:** the snippet runs on the client, which is untrusted territory (see `MODS_AND_GAMEMODE_CONTRACT.en.md`). An event from there is a *hint*, not proof — the server still has to validate. For death that's acceptable (worst case, someone fakes their own death). For granting items or gold, it isn't.

---

## 2.5 The missing source: upstream's `misc/tests/`

The documentation in `docs/` describes five `mp` methods. The real API is much larger, and the place where it appears **executing** is the upstream repository's `misc/tests/` folder — nine integration tests that run against a real server.

That makes them more reliable than any documentation: they are code that has to pass.

```bash
gh api repos/skyrim-multiplayer/skymp/contents/misc/tests --jq '.[].name'
```

### What they settled for us

**1. The Papyrus `self` format — settled.** All nine tests use `{ type: 'form', desc: mp.getDescFromId(id) }`, never the raw FormID, including for *arguments* that are references:

```js
mp.callPapyrusFunction("method", "ObjectReference", "RemoveAllItems",
    { type: "form", desc: mp.getDescFromId(actorId1) },
    [{ type: "form", desc: mp.getDescFromId(actorId2) }, false, false]);
```

This project had 22 calls passing the raw FormID. All were converted — see `core/papyrus.js` (`actorRef`/`baseRef`).

The `form` vs `espm` distinction also shows up: the actor is `form`, the Gold001 added to their inventory is `espm`.

**2. `mp.onDeath` exists and brings the killer.**

```js
mp.onDeath = (actorId, killerId) => { /* killerId is 0 when there's no author */ };
mp.onRespawn = (actorId) => {};
```

Our `death-service.js` polls every 2s reading `getActorValue('Health')`, and this project's combat documentation once recorded that "there is no reliable hook for who attacked whom". For the moment of death — which is what matters for anti-RDM — **there is**. That makes proximity-based `logDeathContext` an unnecessary approximation for attribution.

**3. Other hooks and calls confirmed by test:**

| | |
|---|---|
| `mp.onActivate = (target, caster) => {}` | Someone used an object/actor |
| `mp["onPapyrusEvent:OnItemAdded"] = fn` | An arbitrary Papyrus event, by name |
| `mp.createActor(profileId, pos, angleZ, cellOrWorld)` | Create an actor from the server |
| `mp.set(id, "isDead", true)` | Kill directly, without Papyrus |
| `mp.set(id, "inventory", {entries:[{baseId,count}]})` | **Write the entire inventory in one go** |
| `mp.get(id, "inventory").entries` | Read the inventory |
| `mp.set(id, "spawnDelay", 0)` | Control the respawn delay |
| `mp.get(id, "spawnPoint")` | Spawn point of a placed actor |

The `inventory` `get/set` pair is notable: today `inventory-service.js` syncs item by item via `AddItem`. A single `set` would be simpler and atomic on the client side.

---

## 2.6 Identity and login: how SkyMP really resolves `profileId`

Source: `skymp5-server/ts/systems/login.ts` and `skymp5-server/ts/settings.ts`.

This answers the open question of "how does the gamemode know who the player is" — item 1.6 of our `QA_REPORT_2026-08.en.md`.

**There are two modes, and the difference is everything:**

**`offlineMode: true`** — the client sends `gameData.profileId` and the server **believes it**. This is the lab mode. Anyone edits `skymp_config.json` and becomes someone else.

**`offlineMode: false`** (default) — the client sends `gameData.session`, and the server **resolves the session against a master API**:

```
GET  {master}/api/servers/{masterKey}/sessions/{session}
  →  { user: { id: number, discordId: string } }
```

The `profileId` now comes from the master, not from the client. **This is where identity becomes trustworthy.**

The default `master` is `https://gateway.skymp.net`, but it's just a string in `server-settings.json`.

### The path to our item 1.6

We already have everything that endpoint needs: Discord OAuth, whitelist, and the `launch_tickets` table created in migration v6. **`apps/web` can be our master API** — it's a single endpoint:

1. `apps/web` implements `GET /api/servers/:masterKey/sessions/:session`, resolving the ticket to `{ user: { id: accountId, discordId } }`.
2. `server-settings.json` points `master` at our panel and sets `masterKey`.
3. `offlineMode: false`.
4. The launcher already writes `config.session` — it starts writing the ticket the panel issued.

Once that's done, `whitelist.js` stops trusting the client's `profileId` without needing any change in it: the `profileId` that arrives **already is** the validated `accountId`.

This is much simpler than the `/internal/session/resolve` we built in `apps/game-api`, and uses the mechanism SkyMP already has instead of a parallel one.

### `mp.onLoginAttempt`

`login.ts` calls, if it exists:

```js
mp.onLoginAttempt = (profileId) => boolean;  // false refuses the connection
```

This is the correct point for whitelist and bans — the client receives `loginFailedBanned`. Today we do this with connection polling + `mp.kick` after the fact.

### Native `discordAuth` in the server

`server-settings.json` accepts:

```json
{
  "discordAuth": {
    "botToken": "...",
    "guilds": [{
      "guildId": "...",
      "banRoleId": "...",
      "hideIpRoleId": "...",
      "eventLogChannelId": "..."
    }]
  }
}
```

The server then, on its own: requires the player to be in the Discord, refuses anyone with the ban role, hides the IP of anyone with `hideIpRoleId`, and **posts logins to a channel**. Discord roles become available in the gamemode via the `private.discordRoles` property.

We built part of this in `apps/bot-discord`. Worth comparing before investing more in ours.

Note: properties prefixed with `private.` are not visible to the client.

---

## 2.7 Other RP servers on SkyMP

Found by code search: `hijosdelasnieves/hijosdelasnieves-RP` (active 2026-07-29), `reggiedroid/skymp-mop` (2026-08-05), `spike29011/Skymp-spike`.

They are all upstream copies with no published gamemode of their own — their RP code isn't open. They serve as a signal that the project has other serious servers under construction, not as a source of solutions.

`sweettaffy-lib` (official org) holds the SweetTaffy server's **RP rules** in Russian — useful as a reference for rule design, not for code.

---

## 3. Development tools that already exist and we don't use

These three save the most time, and none of them requires writing code:

### Chromium DevTools on port 9000
The embedded browser exposes remote DevTools. Open **`localhost:9000`** in a real Chrome and you get console, inspector and breakpoints for our in-game UI.

Today `skymp/ui/index.html`, `player-panel.js` and `player-panel.css` are debugged **blind**. That changes with one URL.

### UI live reload on port 1234
If a WebPack dev server is running on port 1234 on the same machine, the SkyMP server **proxies UI requests to it**. Meaning: you can iterate UI CSS and JS without restarting the server or reconnecting the client.

### The `file` database driver for testing
`databaseDriver: "file"` keeps the world in a directory, no MongoDB needed. That's already what our `server-settings.local.example.json` uses — worth knowing there's also `zip` (the same thing in a single file, handy for a snapshot before a destructive test) and `mongodb` for production.

---

## 4. Combat: correcting an earlier understanding

A conclusion recorded earlier in this project was that "there is no reliable hook for who attacked whom". That needs nuance:

**The OnHit packet exists** and is rich (`docs_onhit_and_damage.md`):

```c++
uint32_t aggressor;   bool isBashAttack;   bool isHitBlocked;
bool isPowerAttack;   bool isSneakAttack;  uint32_t projectile;
uint32_t source;      uint32_t target;
```

What **doesn't** exist is its exposure to the JS gamemode — issue #1338 asked for it and was closed as won't fix. The data is in C++, not in our layer.

Two ways out, both viable:
1. **`makeEventSource` on the client**, listening to Skyrim Platform's hit event and sending `{aggressor, target}` to the server. Cheap, and better than the proximity we use today — but it's still the client talking.
2. **`IDamageFormula` in C++** — SkyMP exposes an interface precisely so custom servers can redefine the damage formula. That's where the data is genuinely trustworthy, but it requires a C++ build of the server.

**This stopped being theory.** The Red House RP server implemented option 1 and the code is public — see `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1 (Portuguese). There you'll also find the two details that would cost hours of debugging (the local player's `0x14` and the mandatory FormID conversion) and a performance warning that applies to us.

Until one of the two is done, `/iniciar` + `checkDamageSpike` is what we have: proximity evidence, not attribution.

---

## 5. Mind the ports

| Port | Who uses it |
|---|---|
| 7777/UDP | SkyMP, synchronization (default) |
| 3000/HTTPS | Embedded browser UI — **not configurable** |
| 9000 | Embedded Chromium DevTools |
| 1234 | WebPack dev server (UI live reload) |
| 3001 | `apps/web` |
| 3002 | `apps/bot-discord` |
| 7758 | `apps/game-api` |
| 7778 | VOIP (`VOIP_PORT`) |

⚠️ **The UI port is `main port + 1` when the main port is non-default.** Our `apps/launcher/.env.example` carried `VITE_SERVER_PORT=7757`, while `skymp/config/server-settings.*.example.json` carried `"port": 7777`. Two problems with that:

1. The defaults **don't match** — the client would try 7757 while the server listens on 7777.
2. If someone standardized on 7757, the UI would go to **7758 and collide with `apps/game-api`**.

**Resolved on 2026-08-05:** the launcher now uses 7777 (default and in the examples), aligned with `server-settings`. The warning stays in `.env.example`: changing the main port to a non-default value shifts the UI and may collide with `game-api`.

---

## 6. What we looked for and doesn't exist

- **There are no public TypeScript typings for the `mp` API.** Upstream's `skymp5-functions-lib` imports from a `src/` that isn't in the repository — only `index.ts` is public. We wrote ours in `skymp/gamemode/types/mp.d.ts`.
- **No other RP server has published its gamemode.** The three active forks found are upstream copies with no open RP code.
- **`skymp-ui-components`** (the org's UI library) has been dormant since 2020. Not worth adopting.
- **`sweettaffy-lib`** is the SweetTaffy server's set of RP rules (in Russian), not code — but it works as a reference for RP server rule *design*.
- **Releases**: the latest is `sp-v2.6-beta`, from 2022. The project develops on the `main` branch, not by release. Pin to a commit, not a tag.

---

## 7. Suggested adoption, in cost-benefit order

| | Action | Effort | Gain |
|---|---|---|---|
| 1 | ✅ Align ports 7757/7777 in the examples | | Done — it was a guaranteed connection failure |
| 2 | ✅ Write `types/mp.d.ts` | | Done |
| 3 | ✅ Convert the 22 Papyrus calls to the object format | | Done — see 2.5 |
| 4 | Open `localhost:9000` in the next UI test session | Zero | Stop debugging the UI blind |
| 5 | **Replace `death-service` polling with `mp.onDeath`** | Hours | Death on the frame + `killerId` for free. Replaces polling **and** the anti-RDM proximity heuristic |
| 6 | **`apps/web` becomes the session master API** (see 2.6) | A day | Solves item 1.6 using the native mechanism instead of our parallel `/internal/session/resolve` |
| 7 | `mp.onLoginAttempt` instead of connection polling + kick | Hours | Refusal at the handshake, with the correct message for the client |
| 8 | Evaluate native `discordAuth` before investing more in the bot | Hours | Role-based bans, login logs and hidden IPs with no code of ours |
| 9 | Bring up the WebPack dev server on 1234 for the UI flow | A day | UI live reload |

Item 4 is worth doing before the Phase 1 in-game test (`QA_REPORT_2026-08.en.md`), because it affects that very test. Items 5 through 8 change architecture decisions we've already made — worth rereading 2.5 and 2.6 before continuing to build on top of them.

---

## 8. How SkyMP resolves shared state

Surveyed on 2026-08-09 to give a foundation to
[`REVISAO_REALIDADE_COMPARTILHADA.md`](REVISAO_REALIDADE_COMPARTILHADA.md)
(Portuguese only). Up to here this document covered the gamemode *API*; this
section covers the **mechanism underneath** — who decides what each player sees,
and in what format the server represents place and form identity.

### Provenance discipline

- **`[DOC]`** — read in the upstream's primary source
  (`gh api repos/skyrim-multiplayer/skymp/contents/<path>`). It is fact about the
  code on `main`.
- **`[DEEPWIKI]`** — comes from the generated wiki at `deepwiki.com`, **not**
  checked against the code. It is evidence, not a closed verdict: the wiki errs
  by omission (see 8.2).

### 8.1 The core: `WorldState`, grid and neighbours

**[DEEPWIKI]** ([2.5 World State Management](https://deepwiki.com/skyrim-multiplayer/skymp/2.5-world-state-management))
`WorldState` keeps every form in an `unordered_map<uint32_t, shared_ptr<MpForm>>`
(`LookupFormById`, `AddForm`, `DestroyForm`, in
`skymp5-server/cpp/server_guest_lib/WorldState.h`). Spatial partitioning is a
grid (`GridInfo` / `GridImpl<MpObjectReference*>`) queried through
`GetNeighborsByPosition`. FormIDs `< 0xff000000` come from ESPM; `>= 0xff000000`
are server-generated.

**[DEEPWIKI]** ([2.4.1](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.1-mpactor-and-mpobjectreference),
[2.4.2](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.2-actionlistener-and-event-handling))
A "neighbour" is not "whoever is nearby" in a straight line: it is **whoever is
subscribed to that form's updates**. `SendToNeighbours`
(`ActionListener.cpp:39-96`) first validates that the sender owns the actor (or
is the registered *hoster* in `worldState.hosters`) and only then rebroadcasts.
Entering and leaving grids drives subscription/unsubscription —
`PartOne::SetUserActor` (`PartOne.cpp:175-221`) unsubscribes the actor from its
neighbours and removes it from the grid to reset visibility.

**Consequence for us:** the server **already maintains** the answer to "who sees
whom". `mp.getNeighborsByPosition` is exposed to the gamemode **[DOC]** — see 8.3.

### 8.2 The wiki is incomplete: check PropertyBindings in the code

**[DEEPWIKI]** ([5.3](https://deepwiki.com/skyrim-multiplayer/skymp/5.3-properties-system))
lists the standard bindings and **does not mention `locationalData`**. That would
raise a false suspicion about three of our services. The primary source refutes
it:

**[DOC]** `skymp5-server/cpp/addon/property_bindings/PropertyBindingFactory.cpp`
— the real map from `CreateStandardPropertyBindings()`:

```
actorNeighbors  angle       appearance   baseDesc     equipment
inventory       isDead      isDisabled   isOnline     isOpen
locationalData  neighbors   onlinePlayers percentages pos
profileId       spawnPoint  type         worldOrCellDesc  idx
consoleCommandsAllowed  spawnDelay  templateChain  lastAnimEvent
respawnPercentages
```

`neighbors`, `actorNeighbors` and `onlinePlayers` are **built-in** — the
neighbour list comes ready from the server.

### 8.3 The real surface of the `mp` API

**[DOC]** `skymp5-server/cpp/addon/ScampServer.cpp:84-143` — the registered
`InstanceMethod`s. They confirm what we already use (`get`, `set`,
`makeProperty`, `makeEventSource`, `callPapyrusFunction`,
`lookupEspmRecordById`, `getActorsByProfileId`, `kick`, `place`) and reveal three
we don't:

| Method | What it would do for us |
|---|---|
| `getNeighborsByPosition` | Neighbours from the server's grid, instead of our O(n²) |
| `getDescFromId` / `getIdFromDesc` | Converts FormID ↔ `FormDesc` **without guessing the format** (see 8.5) |
| `findFormsByPropertyValue` | Lookup by property value |

### 8.4 `locationalData`: the exact shape, both ways

**[DOC]** `property_bindings/LocationalDataBinding.cpp`.

**Reading** (`mp.get`) returns exactly three fields:

```js
{ cellOrWorldDesc: "1a26f:Skyrim.esm",  // string, FormDesc::ToString()
  pos: [x, y, z],                        // array of 3 numbers
  rot: [x, y, z] }                       // array of 3 numbers — it is called `rot`
```

**Writing** (`mp.set`) requires **all three** fields, under those exact names,
and calls `MpActor::Teleport`. A missing or wrongly-typed field **throws**:
`NapiHelper::ExtractString` throws if the value is not a string,
`ExtractNiPoint3` throws if it is not an array
(`skymp5-server/cpp/addon/NapiHelper.h:96,218`). And it only works for actors:
*"mp.set can only change 'locationalData' for actors, not for refrs"*.

### 8.5 `FormDesc`: place and base are **strings**, not hexadecimal

**[DOC]** `skymp5-server/cpp/server_guest_lib/FormDesc.cpp`. `ToString()` uses
the format `"%0x%c%s"` → `shortFormId` in hex **with no `0x` prefix**, a `:`
delimiter, then the file name:

```
"1a26f:Skyrim.esm"        ← canonical form
"162e2"                    ← no file: becomes 0xff000000 + id in ToFormId()
```

`FromString` without a delimiter **does not fail** — it falls into the no-file
branch and resolves into the server-generated FormID range. **That is why a
hand-written `"0x162e2"` raises no error: it silently points somewhere else.**

`baseDesc` uses the same representation: **[DOC]** `BaseDescBinding.cpp` returns
`FormDesc::FromFormId(refr.GetBaseId(), espmFiles).ToString()`.

### 8.6 `mp.onDeath`: it exists, and it **respawns on its own** unless you block it

**[DOC]** `server_guest_lib/gamemode_events/DeathEvent.cpp`:

- The hook is literally named `"onDeath"`; its arguments are
  `[actorId, killerId]`, with `killerId = 0` when there is no killer.
- `OnFireSuccess` calls **`actor->RespawnWithDelay()`**.

**[DOC]** `gamemode_events/GameModeEvent.cpp` — `Fire()` only calls
`OnFireSuccess` if **no** listener returned `false`; otherwise it calls
`OnFireBlocked` (which `DeathEvent` does not override, i.e. no respawn).

**[DOC]** `skymp5-server/cpp/addon/ScampServerListener.cpp:41-129` — the contract
for the JS handler's return value:

| `mp.onDeath` returns | Effect |
|---|---|
| `undefined` | **does not block** → automatic respawn happens |
| `false` | **blocks** → the server does not respawn |
| throws | error logged, **does not block** → respawn happens |

**[DOC]** `server_guest_lib/MpChangeForms.h:109` — `float spawnDelay = 25.0f`.
The default delay is **25 seconds**, and there is a `spawnDelay` property to
change it.

### 8.7 Client-input validation the server already performs

**[DEEPWIKI]** ([2.4.2](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.2-actionlistener-and-event-handling))
`ActionListener` validates before accepting: `OnUpdateMovement` runs
`MovementValidation::Validate` against impossible teleports; `OnHit` checks
weapon reach (`GetReach`, `fCombatDistance`), cadence (`CanHit`) and dead actors;
`OnChangeValues` crops impossible regeneration (`CropRegeneration`) and sends a
correction back. Custom events arrive through `OnCustomEvent` with `actorId`,
`eventName` and `argsJson`.

---

## Sources

- [skyrim-multiplayer/skymp](https://github.com/skyrim-multiplayer/skymp) — official repository, `docs/` folder
- [Game Mode Framework — DeepWiki](https://deepwiki.com/skyrim-multiplayer/skymp/5.1-game-mode-framework)
- **DeepWiki, architecture pages used in section 8** — [1.2 System Architecture](https://deepwiki.com/skyrim-multiplayer/skymp/1.2-system-architecture-overview) · [2.3 PartOne and game loop](https://deepwiki.com/skyrim-multiplayer/skymp/2.3-partone-and-game-loop) · [2.4.1 MpActor/MpObjectReference](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.1-mpactor-and-mpobjectreference) · [2.4.2 ActionListener](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.2-actionlistener-and-event-handling) · [2.5 World State](https://deepwiki.com/skyrim-multiplayer/skymp/2.5-world-state-management) · [2.6 Networking](https://deepwiki.com/skyrim-multiplayer/skymp/2.6-networking-and-message-processing) · [5.3 Properties](https://deepwiki.com/skyrim-multiplayer/skymp/5.3-properties-system)
- **Primary code cited as `[DOC]` in section 8** — `PropertyBindingFactory.cpp`, `LocationalDataBinding.cpp`, `BaseDescBinding.cpp`, `NeighborsBinding.cpp`, `WorldOrCellDescBinding.cpp`, `FormDesc.cpp`/`.h`, `ScampServer.cpp`, `ScampServerListener.cpp`, `NapiHelper.h`, `MpChangeForms.h`, `MpActor.cpp`, `gamemode_events/DeathEvent.cpp`, `gamemode_events/GameModeEvent.cpp`
- [docs/docs_skyrim_platform.md](https://github.com/skyrim-multiplayer/skymp/blob/main/docs/docs_skyrim_platform.md)
- [Issue #1338 — onHit for the gamemode](https://github.com/skyrim-multiplayer/skymp/issues/1338) (closed as won't fix)
