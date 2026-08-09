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

What **doesn't** exist is a dedicated `mp.onHit` hook — issue #1338 asked for it
and was closed as won't fix.

> ⚠️ **Corrected on 2026-08-09, and the correction matters.** "There is no
> `mp.onHit`" is true; **"the data never reaches the JS gamemode" is false.** It
> does reach it, with the aggressor already resolved by the server, through
> `mp["onPapyrusEvent:OnHit"]`. The whole chain was read in the primary source —
> see **[§9.1](#91-the-finding-that-changes-a-decision-the-native-onhit-does-reach-the-gamemode)**.
> The two ways out listed below remain valid, but **they are no longer the only
> two**, and the third is cheaper than both.

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

## 9. Systematic DeepWiki sweep (2026-08-09)

Up to here, every time a decision in this project ran into "how does SkyMP do
this underneath", the answer came from an ad-hoc search — sometimes finding it,
sometimes not, always costing a round. This section exists so that the next
question already has a written answer.

The [DeepWiki technical wiki](https://deepwiki.com/skyrim-multiplayer/skymp) has
~40 pages generated from the real source code. **Nobody on this project had read
it end to end.** This sweep read the pages where project decisions live,
discarded what is about building upstream, and recorded only what touches
something that already exists or is still open here.

### A decision about form: extend, don't reorganize

**Written down because the alternative was considered and refused.** The new
volume would fit better in a subject-based reorganization of the whole document —
but sections 1 through 8 are **cited by number from outside this file**: Annex
A.5 of `CONSTITUICAO.md` points at §4, `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.5
points at §2.5, and so does §15 of that document. Renumbering would break those
references silently, which is exactly the class of error this document exists to
prevent. So: **§9 grows internally, organized by subject, with its own index.**
There is no competing second document.

### Provenance discipline (the same as §8, reinforced)

- **`[DOC]`** — I opened the primary file upstream and read it. It is fact about
  `main`.
- **`[DEEPWIKI]`** — comes from the wiki only, **not checked against the code**.
  The wiki is AI-generated from the real code: better than a forum and better
  than a guess, but **it simplifies and sometimes contradicts itself** — this
  sweep caught the wiki contradicting itself about text rendering (§9.6) and
  disagreeing with what we had already recorded about private properties (§9.5).
  When the wiki cites `file:line`, the path comes along: it is the shortcut for
  whoever verifies it.

**I did not verify the ~40 pages against the source** — that would have made the
task impossible. I verified line by line **one** finding: §9.1, because it
changes a decision that is already made and written down.

### Index of §9

| | Subject |
|---|---|
| [9.1](#91-the-finding-that-changes-a-decision-the-native-onhit-does-reach-the-gamemode) | 🔴 **The native `OnHit` reaches the gamemode** — `[DOC]`, high relevance |
| [9.2](#92-server-architecture-loop-boot-and-configuration) | Server architecture: loop, boot and configuration |
| [9.3](#93-persistence-mpchangeform-and-the-corpse) | Persistence, `MpChangeForm` and the corpse |
| [9.4](#94-synchronization-what-the-client-sends-when-and-with-what-guarantee) | Synchronization: what the client sends, when, and with what guarantee |
| [9.5](#95-game-systems-properties-commands-and-what-can-be-stolen-from-sweetpie) | Game systems: properties, commands, SweetPie |
| [9.6](#96-client-entity-and-text-rendering-the-nametag-case) | Client: entity and text rendering (the nametag) |
| [9.7](#97-glossary-of-upstream-terms) | Glossary of upstream terms |
| [9.8](#98-what-this-does-not-cover) | **What this does not cover** |

---

### 9.1 The finding that changes a decision: the native `OnHit` **does** reach the gamemode

**`[DOC]`** — the whole chain read in the upstream's primary source, `main`, on
2026-08-09. It is the only finding in this sweep that was verified line by line,
and it was verified because it contradicts something this repository had already
written.

**What this project believed** (§4 of this document, and the header of
`core/hit-events.js`): the OnHit packet exists in C++, but is **not exposed to
the JS gamemode**; issue #1338 asked and was closed as won't fix; therefore the
only ways out are `makeEventSource` on the client (what we do) or
`IDamageFormula` in C++.

**What the code says:** there is no `mp.onHit`. **But the event arrives all the
same**, under another name, with the aggressor **already resolved and validated
by the server**:

```js
mp["onPapyrusEvent:OnHit"] = (
  targetFormId,   // number — FormID of whoever took the hit
  akAggressor,    // { type: 'form', desc: '...' }  ← who hit, resolved by the server
  akSource,       // { type: 'espm', desc: '...' }  ← weapon/spell
  akProjectile,   // null when there is no projectile
  abPowerAttack, abSneakAttack, abBashAttack, abHitBlocked  // booleans
) => { /* ... */ };
```

**The chain, file by file:**

| # | Where | What happens |
|---|---|---|
| 1 | `ActionListener.cpp:1006` | `ActionListener::OnHit` receives the `HitMessage` from the client |
| 2 | idem, ≈L1019-1037 | **The server translates `0x14` on its own** — see below |
| 3 | idem, ≈L1043-1080 | Validates: the aggressor belongs to the user (or the registered *hoster*), same cell/worldspace, distance ≤ 4096 units (waived for bow/crossbow shots) |
| 4 | idem, ≈L1080+ | A dead aggressor cannot attack; weapon reach and cadence (`CanHit`) |
| 5 | `ActionListener.cpp:1215` and `:1256` | `OnWeaponHit` and `OnSpellHit` call `SendPapyrusOnHitEvent` |
| 6 | `ActionListener.cpp:1410-1425` | Builds 7 `VarValue`s and calls `target->SendPapyrusEvent("OnHit", …)` |
| 7 | `MpForm.cpp:34-40` | `SendPapyrusEvent` builds a `PapyrusEventEvent` and calls `.Fire(parent)` |
| 8 | `gamemode_events/PapyrusEventEvent.cpp:18-19` | The event name becomes `"onPapyrusEvent:" + "OnHit"` |
| 9 | `gamemode_events/GameModeEvent.cpp` | `Fire()` walks the listeners calling `OnMpApiEvent` |
| 10 | `addon/ScampServerListener.cpp` (≈L41-129) | Looks up `mp["onPapyrusEvent:OnHit"]`; if it is a function, calls it with the JSON args **plus** the 7 converted Papyrus args |
| 11 | `addon/PapyrusUtils.h:14-49` | Papyrus object → `{ type: 'form' \| 'espm', desc: '<FormDesc>' }` |

**Three direct consequences for `core/hit-events.js`:**

1. **The `0x14` is the server's problem, not ours.** `ActionListener.cpp`
   literally does `if (hitData.aggressor == 0x14) { aggressor = myActor;
   hitData.aggressor = aggressor->GetFormId(); }`, and the same for `target`. Our
   `hit-events.js` keeps `const JOGADOR_LOCAL = 0x14` and translates on its own
   because the client snippet reports it raw — through this path the translation
   arrives already done and correct.
2. **The aggressor arrives in the format we already use.**
   `{ type: 'form', desc: … }` is exactly the `FormDesc` of `core/papyrus.js`
   (`actorRef`/`baseRef`) and of §8.5. Nothing new to learn, no hexadecimal to
   guess.
3. **It is evidence *validated by the server*, not a raw client report.** This
   does not erase the rule in `MODS_AND_GAMEMODE_CONTRACT.en.md` — the origin is
   still a `MsgType::OnHit` message the client chose to send — but **it is a step
   up** from what we have: today we accept whatever the snippet says; through
   that path, the server has already discarded hits from a dead actor, from a
   different cell, out of reach and out of cadence **before** telling us.

**The limits, stated before anyone gets excited:**

- **Blocking does not prevent the damage.** Returning `false` only prevents
  `OnFireSuccess` — that is, the dispatch to the Papyrus VM.
  `SendPapyrusOnHitEvent` **discards** the return of `Fire()`, and the damage
  calculation runs right after, inside `OnWeaponHit`/`OnSpellHit`. **This is
  observation, not enforcement.**
- **The event belongs to the target.** It fires on the form that *took* the hit.
  If the target is not an actor, damage is skipped but the event fires anyway.
- **It is still upstream `[DOC]`, not exercised here.** None of this ran on this
  server — like everything else, it depends on somebody being connected
  (Phase 0).

> **Next step — not to be implemented now.** This is a finding, and the place to
> decide is the shared-reality review
> (`PROMPT_REVISAR_REALIDADE_COMPARTILHADA.md`). What is recorded is that
> **there is a hit-collection path we are not using today**, cheaper than
> `IDamageFormula` in C++ and more trustworthy than the current
> `makeEventSource` — and that §4 of this document had been partly wrong about
> this since it was written.

---

### 9.2 Server architecture: loop, boot and configuration

**[DEEPWIKI]** ([2.3 PartOne and game loop](https://deepwiki.com/skyrim-multiplayer/skymp/2.3-partone-and-game-loop))
`PartOne::Tick()` (`PartOne.cpp:146-151`) does three things in order:
`TickPacketHistoryPlaybacks()`, `TickDeferredMessages()` (batched queued
messages) and `WorldState::Tick()` (timers, promises, entity lifecycle).

**[DEEPWIKI]** ([2.1 TypeScript Orchestration](https://deepwiki.com/skyrim-multiplayer/skymp/2.1-typescript-server-orchestration))
What calls that tick is the TS layer: an infinite loop calling `server.tick()`
**every 1 ms** (`skymp5-server/ts/index.ts:222-235`).

> **Relevance.** Annex A.5 of the Constitution budgets the server frame against
> "three services polling every 2 s". This is the number that was missing from
> the other side of the equation: the base loop is 1 ms, and **every
> `setInterval` of ours shares the same Node process with it.** It reinforces —
> does not weaken — the rule `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.1 had
> already written: *activating hostile mobs cannot add any new timer.*

**[DEEPWIKI]** (same page) `PartOne::SetUserActor` (`PartOne.cpp:175-221`)
unsubscribes the actor from its neighbours, removes it from the grid, stores it
in `serverState.actorsMap` and **calls `RespawnWithDelay()` if the actor is
dead**. It confirms by another route what §8.6 already recorded as `[DOC]`:
automatic respawn is the default, and whoever doesn't want it has to block.

**[DEEPWIKI]** ([2.1](https://deepwiki.com/skyrim-multiplayer/skymp/2.1-typescript-server-orchestration))
Boot and hot-reload: the gamemode is **copied to a temporary file** before
loading, to escape Node's module cache (`ts/index.ts:38-61`);
`globalThis.mp = server` is what makes `mp` exist (`ts/index.ts:82`); and
`server.clear()` wipes the gamemode state before reloading (`ts/index.ts:126`).

> **Relevance.** `server.clear()` on a hot-reload means **every piece of state
> our services keep in memory disappears without warning**. It argues for the
> discipline we already practise (income ceilings by querying the ledger, never
> by an in-memory counter — `HOSTILE_MOB_ACTIVATION_DECISION.md` §4.2) and is
> worth a warning for whoever writes the next service.

**[DEEPWIKI]** (same page) `Settings` merges `server-settings.json` with **JSON
fetched from GitHub repositories** via `additionalServerSettings` (fields `type`,
`repo`, `ref`, `pathRegex`, `token`), cached in `server-settings-dump.json` with
SHA512 verification (`ts/settings.ts:134-311`).

> **Relevance.** It is a path through which **production configuration can come
> from a third-party repository**. We don't use it, and it's worth knowing it
> exists before somebody copies an example `server-settings.json` that brings it
> switched on.

---

### 9.3 Persistence, `MpChangeForm` and the corpse

**[DEEPWIKI]** ([2.5.1 Database and Persistence](https://deepwiki.com/skyrim-multiplayer/skymp/2.5.1-database-and-persistence))
Four drivers, and one of them was not in our §3:

| Driver | What it does | Source cited by the wiki |
|---|---|---|
| `MongoDatabase` | `changeForms` collection, bulk write, restricted keys become SHA-256 hashes | `database_drivers/MongoDatabase.cpp:33,72-75,87-107,143-228` |
| `FileDatabase` | One JSON per `MpChangeForm`, atomic write via `rename` | `database_drivers/FileDatabase.cpp:37-55` |
| `ZipDatabase` | The same thing inside a `.zip` | `database_drivers/ZipDatabase.cpp:40-63` |
| **`MigrationDatabase`** | **Migrates between drivers**, in batches of 1000 | `database_drivers/MigrationDatabase.cpp:94-117` |

**[DEEPWIKI]** Writing is asynchronous on its own thread (`SaverThreadMain`),
grouping several `MpChangeForm`s into an `UpsertTask` per batch
(`viet/include/save_storages/AsyncSaveStorage.h:25-61,230-234,248-250`).

> **Relevance 1 — `MigrationDatabase` answers a question we hadn't asked yet.**
> §3 recorded that `file` is the test driver and `mongodb` the production one,
> without saying how you get from one to the other. There is a ready-made path.
>
> **Relevance 2 — persistence is asynchronous and batched.** No world-state write
> is synchronous. For us that is good (it doesn't block the frame) and it is a
> warning (what `mp.set` just changed **is not on disk yet**; a crash between the
> `set` and the flush loses the change). The MySQL ledger, which is ours and
> synchronous, remains the source of truth for assets — which is exactly why the
> "assets go through `transaction-service`" rule exists.

**[DEEPWIKI]** ([2.4.1 MpActor and MpObjectReference](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.1-mpactor-and-mpobjectreference))
`MpChangeForm` fields with cited lines — all in
`server_guest_lib/MpChangeForms.h`:

| Field | Line | What it holds |
|---|---|---|
| `isOpen` | 76 | container/door open |
| `isDisabled` | 79 | "hidden from the world" |
| `isDead` | 85 | death state |
| `equipment` | 94 | equipped items and spells |
| `actorValues` | 98 | Health/Magicka/Stamina percentages |
| `templateChain` | 105 | (already used in `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.4b) |
| `spawnDelay` | 109 | (already `[DOC]` in §8.6: default 25 s) |

**[DEEPWIKI]** (same page) Inventory and container: `AddItem()`, `RemoveItem()`,
`PutItem()` (container→actor) and `TakeItem()` (actor→container) live in
`MpObjectReference.cpp:815-952`. `Activate()` — which fires the gamemode's
`ActivateEvent` and Papyrus' `OnActivate` — is at `MpObjectReference.cpp:438-503`.
`Delete()` at `:954-959`.

> **Relevance — this is the corpse question, and the wiki does not close it.**
> `HOSTILE_MOB_ACTIVATION_DECISION.md` §10 and §16 say the whole feature depends
> on the server being able to control a corpse's inventory. What this reading
> adds: **inventory is an `MpChangeForm` field**, i.e. *server* state, persisted,
> with `PutItem`/`TakeItem` going through the `ActionListener` — which points to
> "yes, it can be done". What it does **not** give is the behaviour of vanilla
> corpse looting, which is the specific case. Page `2.4.1` mentions
> `DeathStateContainerMessage` but **does not detail death-item resolution**, and
> I did not open the code. **Piece 2 (`corpse-probe.js`) is still what answers
> it.** This is evidence in favour, not a verdict.

---

### 9.4 Synchronization: what the client sends, when, and with what guarantee

**[DEEPWIKI]** ([3.2.3 Input Capture and State Synchronization](https://deepwiki.com/skyrim-multiplayer/skymp/3.2.3-input-capture-and-state-synchronization))
The numbers nobody here had:

| What | Cadence | Reliability | Source cited |
|---|---|---|---|
| `UpdateMovement` | **~130 ms per actor** | UNRELIABLE | `sendInputsService.ts:120-135` |
| `ChangeValues` (HP/MP/SP) | **only if it changed**; with no change, 2000 ms | UNRELIABLE | `sendInputsService.ts:137-196` |
| `OnHit` | per event | **RELIABLE** | `hitService.ts:15-69` |
| `SpellCast` | per event | **RELIABLE** | — |

Detail on `ChangeValues`: it delays 500 ms while casting (**except when
`health = 0`**) and is suppressed while the client's death service is busy.

> **Relevance 1 — it explains the precision ceiling of `death-service`.** The HP
> the server reads arrives, at best, when the client decides it changed; absent a
> change, every 2 seconds. **Our 2 s polling was reading a value that also
> refreshes every ~2 s** — meaning the real delay was double what we assumed. One
> more argument for the event path (`mp.onDeath`, already adopted through
> `core/death-events.js`) over polling.
>
> **Relevance 2 — the `health = 0` exception is design in our favour.** Upstream
> treated death as the case that cannot be delayed. Our architecture went the
> same way on its own.

**[DEEPWIKI]** (same page) The client's `HitService` **already filters**: it
discards hits on static objects and only accepts an attacker that is the local
player or an NPC *hosted* by them.

> **Relevance — our `hit-events.js` reimplements part of this.** The snippet we
> inject through `makeEventSource` does its own `hit` capture. The native client
> already captures, filters and sends it as RELIABLE — and what it sends is
> exactly what §9.1 shows arriving at the gamemode. **We are collecting in
> parallel to a channel that already exists, is already filtered and is already
> validated on the server.**

**[DEEPWIKI]** ([3.2 Client Synchronization](https://deepwiki.com/skyrim-multiplayer/skymp/3.2-client-synchronization))
*Hosting*: the client keeps `storage['hosted']` with the remote IDs it controls
locally — that is how a player "hosts" an NPC's movement
(`remoteServer.ts:133-155`). On the server side it is the `worldState.hosters`
that §8.1 already recorded.

> **Relevance.** It is the mechanism by which **a mob's AI runs on some player's
> machine**. It confirms, underneath, the premise of
> `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.1 (creature AI and damage cost zero in
> our frame) and that of §3.3/§4.1 (the server has no verb to stop a bear from
> walking into the safe zone — the one deciding its path is a client).

---

### 9.5 Game systems: properties, commands, and what can be stolen from SweetPie

**[DEEPWIKI]** ([5.3 Properties System](https://deepwiki.com/skyrim-multiplayer/skymp/5.3-properties-system))
Custom properties are kept by `DynamicFields` as **JSON strings in an
`unordered_map<string,string>`** (`server_guest_lib/DynamicFields.h:30`).

⚠️ **A divergence worth checking before trusting either side.** The wiki says the
privacy prefixes are **`__p_`** (private) and **`__pi_`** (private indexed),
citing `addon/property_bindings/CustomPropertyBinding.cpp:27-31`. **§2.6 of this
document** records the prefix as **`private.`**. Both cannot be right. Neither
was read in the code this round — **whoever uses a private property checks
first**, because getting this wrong leaks to the client silently, which is the
worst possible failure mode.

**[DEEPWIKI]** ([5.4 Command System](https://deepwiki.com/skyrim-multiplayer/skymp/5.4-command-system))
A client console command becomes `MsgType::ConsoleCommand`, lands in
`ActionListener::OnConsoleCommand` and is executed by `ConsoleCommands::Execute`.
The permission is `EnsureAdmin`, which checks the `MpActor`'s
`ConsoleCommandsAllowedFlag` — or whether the server released it for everyone
(`ConsoleCommands.cpp:58-72`, execution at `:74-193`;
`consoleCommandsService.ts:18-34,81-83,93-102`).

> **Relevance.** It matches the `consoleCommandsAllowed` property that §8.2
> already lists as a standard binding. It is **native, per-actor, server-side
> permission** — a layer our `admin-service` does not use today. Worth checking
> that it is not switched on by accident before the first test with outsiders.

**[DEEPWIKI]** ([5.2 SweetPie PvP](https://deepwiki.com/skyrim-multiplayer/skymp/5.2-sweetpie-pvp-game-mode))
**Checked before discarding, as the plan required.** It is an arena PvP mode
(Markarth, Riften, Whiterun, Windhelm) — in almost everything, the opposite of
Heavy RP. **Two pieces survive the discard:**

1. **`IDamageFormula` is a real extension point**, with more than one
   implementation coexisting (vanilla, SweetPie, magic variants) —
   `formulas/SweetPieDamageFormula.cpp:68-113`,
   `formulas/TES5DamageFormula.cpp:127-240`. It is "way out 2" of §4 of this
   document, and now it has a usage example.
2. **The points-by-name registry (`pointsByName`)** is independent of PvP — it is
   a named `locationalData` registry, which is the shape our
   `RESPAWN_CELL`/spawn points would take if they ever stop being constants in
   the code.

Main implementation in `skymp5-functions-lib/index.ts:1-598` (Papyrus exposure at
`:262-335`) — which is, incidentally, **the only complete published gamemode**
there is to read.

---

### 9.6 Client: entity and text rendering (the nametag case)

**[DEEPWIKI]** ([3.1.1 JavaScript API and Plugin System](https://deepwiki.com/skyrim-multiplayer/skymp/3.1.1-javascript-api-and-plugin-system))
SkyrimPlatform's `TextApi`, through a `TextsCollection` singleton
(`skyrim-platform/src/platform_se/skyrim_platform/TextApi.cpp:8-181`):

| Function | What it does |
|---|---|
| `CreateText()` | creates the text entry |
| **`SetTextRefr()`** | **attaches the text to a game reference, by FormId** |
| `SetTextPos()` | positions it at a screen coordinate |
| `GetTextsToDraw()` | hands the renderer what is visible |

**[DEEPWIKI]** ([3.1.2 Event System and Text Rendering](https://deepwiki.com/skyrim-multiplayer/skymp/3.1.2-event-system-and-text-rendering))
Drawing is a DirectX overlay (`tilted/ui/DX11RenderHandler.cpp:72-97`), with
`.spritefont` fonts loaded from `Data/Platform/Fonts/` (`:176-194`). Properties:
position, RGBA colour 0–1, rotation in radians, scale.

⚠️ **The wiki contradicts itself here, and that is information about the wiki.**
Page `3.1.2` states the coordinates are **screen-only** and that world-space "is
not specified"; page `3.1.1` documents `SetTextRefr()`, which attaches text to a
world reference. **The second is more specific and probably the right one**, but
neither was checked in the code.

> **Relevance — this is exactly the nametag question.**
> `NAMETAG_IDENTITY_SYSTEM.md` and `nametag-service.js` (a `lab` module, switched
> off) need to know whether the text follows the actor on its own or whether
> somebody has to project world→screen every frame. **`SetTextRefr()` points to
> "it follows on its own"**, which would be far cheaper than projecting. Recorded
> as `[DEEPWIKI]` with the file to check (`TextApi.cpp:8-181`) — it is the first
> thing to open when the nametag comes back to the table.

**[DEEPWIKI]** ([3.2.2 WorldView and Entity Rendering](https://deepwiki.com/skyrim-multiplayer/skymp/3.2.2-worldview-and-entity-rendering))
A remote entity is created on the client with
`player.placeAtMe(baseForm, 1, true, true)` (`view/formView.ts:169-186`). **Every
`FormView` is destroyed when the player changes worldspace/cell**
(`view/worldView.ts:71-85`), and each one self-destructs if the model's
`worldOrCell` diverges (`view/formView.ts:40-55`).

> **Relevance.** Anything of ours attached to a rendered entity — the nametag
> first in line — **dies on a cell change and has to be recreated.** It is not a
> bug, it is the lifecycle. Better to know it before debugging "the label
> vanished when I entered the tavern".

**[DEEPWIKI]** ([3.1.1](https://deepwiki.com/skyrim-multiplayer/skymp/3.1.1-javascript-api-and-plugin-system))
Useful odds and ends: client plugins come from `Data/Platform/Plugins/` (`.js` +
`-settings.txt` as JSON); `skyrimPlatform.storage` **survives a hot-reload but
not a game restart**; JS runs on its own thread, with a queue for whatever needs
the game thread.

> **Relevance.** "Survives a reload, not a restart" is the same class of warning
> as §9.2 about `server.clear()`: **in-memory state, on both sides, is
> disposable by construction.**

---

### 9.7 Glossary of upstream terms

**[DEEPWIKI]** ([7 Glossary](https://deepwiki.com/skyrim-multiplayer/skymp/7-glossary)).
Recorded as a vocabulary reference — it is what saves the next reread:

| Term | Upstream's definition |
|---|---|
| **Hoster** | the client with authority over an NPC's movement (§9.4) |
| **Neighbour** | nearby objects within the grid partition — but see §8.1: in practice it is *whoever is subscribed to the form's updates* |
| **ChangeForm** | Bethesda's concept for a record delta; here it is `MpChangeForm` |
| **FormDesc** | FormID + ESP/ESM file name, to survive load-order changes (§8.5) |
| **ESPM / libespm** | the library that reads `.esm`/`.esp`/`.esl` — it is how the server understands the base game |
| **SpSnippet** | a Papyrus snippet executed dynamically, server or client (wiki §2.7) |
| **PartOne** | the native server's coordinating class |
| **ScampServer** | the N-API addon wrapping the C++ for Node |
| **WorldState** | the central manager of all loaded entities (§8.1) |
| **VarValue** | the Papyrus VM's variant type (string, int, float or reference) |

---

### 9.8 What this does **not** cover

Recorded so that nobody rereads it thinking it is still to be done.

**Opened and nothing relevant found** — read, thin result:

| Page | Verdict |
|---|---|
| [1.2 System Architecture Overview](https://deepwiki.com/skyrim-multiplayer/skymp/1.2-system-architecture-overview) | Confirms the authoritative model §8 already covers. Nothing new. It does not say what the server **doesn't** control — which is precisely what interests us |
| [1.3 Repository Structure](https://deepwiki.com/skyrim-multiplayer/skymp/1.3-repository-structure) | Lists directories (`libespm`, `viet`, `papyrus-vm`, `savefile`…). **It doesn't even mention `misc/tests` or `docs/`** — the two sources that served us most (§2.5, §1). Here our §1 beats the wiki |
| [2.2 ScampServer Native Addon](https://deepwiki.com/skyrim-multiplayer/skymp/2.2-scampserver-native-addon) | §8.3 already has the real list, read from `ScampServer.cpp`. The wiki is poorer — and claims only `connect`/`disconnect`/`packet` reach JS, **which §9.1 refutes** |
| [3.2.2 WorldView and Entity Rendering](https://deepwiki.com/skyrim-multiplayer/skymp/3.2.2-worldview-and-entity-rendering) | Yielded only the lifecycle in §9.6. It doesn't discuss nametags and **doesn't discuss the cost of spawning many actors** — unknown #1 of `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.2 **remains unanswered by the wiki** |
| [5.2 SweetPie PvP](https://deepwiki.com/skyrim-multiplayer/skymp/5.2-sweetpie-pvp-game-mode) | Checked before discarding. It is arena PvP. The two pieces in §9.5 survived |

**Deliberately not opened** — it is about building and contributing to upstream,
not about how the game behaves in production:

- `1.1` Getting Started
- `4` Build System and Deployment **in full** — `4.1` CMake, `4.2` vcpkg,
  `4.3` CI/CD, `4.4` Deployment, `4.5` Distribution and Artifacts
- `6` Development Guide **in full** — `6.1` Environment Setup,
  `6.2` Contribution Workflow, `6.3` Testing, `6.4` Server Operations

> An honest caveat about two of them: **`6.3` Testing** and **`6.4` Server
> Operations** are the ones with a real chance of becoming useful — the first if
> we write integration tests against a real server (the path §2.5 opened), the
> second once Phase 0 finally brings a server up. They were left out this round
> by priority, not by irrelevance.

**Questions of this project the whole wiki did not answer:**

1. **Synchronization cost per active actor × players.** No page gives a number.
   It remains what only the census (`fauna-census.js`) measures.
2. **Vanilla corpse-looting behaviour.** §9.3 gives evidence in favour and
   nothing more. It remains Piece 2 (`corpse-probe.js`).
3. **Whether NPC stats scale with player level on the client.**
   `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.4(c)(2) already recorded that limit;
   the wiki does not touch it. Still open.

**Levelled lists — do not redo.** The wiki's lead about `espm::Loader` and
levelled-list resolution (§8.1) **has already been verified against the primary
source** on 2026-08-09 and promoted to `[DOC]`: it is in
[`HOSTILE_MOB_ACTIVATION_DECISION.md`](HOSTILE_MOB_ACTIVATION_DECISION.md) §7.4(b)
(Portuguese), with files, functions and the table of who passes which `pcLevel`.
**Two rounds should not pay for the same verification twice** — whoever arrives
here from `PROMPT_FECHAR_PERGUNTA_ESCALA_MOB.md` should read there, not reopen.

---

## Sources

- [skyrim-multiplayer/skymp](https://github.com/skyrim-multiplayer/skymp) — official repository, `docs/` folder
- [Game Mode Framework — DeepWiki](https://deepwiki.com/skyrim-multiplayer/skymp/5.1-game-mode-framework)
- **DeepWiki, architecture pages used in section 8** — [1.2 System Architecture](https://deepwiki.com/skyrim-multiplayer/skymp/1.2-system-architecture-overview) · [2.3 PartOne and game loop](https://deepwiki.com/skyrim-multiplayer/skymp/2.3-partone-and-game-loop) · [2.4.1 MpActor/MpObjectReference](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.1-mpactor-and-mpobjectreference) · [2.4.2 ActionListener](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.2-actionlistener-and-event-handling) · [2.5 World State](https://deepwiki.com/skyrim-multiplayer/skymp/2.5-world-state-management) · [2.6 Networking](https://deepwiki.com/skyrim-multiplayer/skymp/2.6-networking-and-message-processing) · [5.3 Properties](https://deepwiki.com/skyrim-multiplayer/skymp/5.3-properties-system)
- **Primary code cited as `[DOC]` in section 8** — `PropertyBindingFactory.cpp`, `LocationalDataBinding.cpp`, `BaseDescBinding.cpp`, `NeighborsBinding.cpp`, `WorldOrCellDescBinding.cpp`, `FormDesc.cpp`/`.h`, `ScampServer.cpp`, `ScampServerListener.cpp`, `NapiHelper.h`, `MpChangeForms.h`, `MpActor.cpp`, `gamemode_events/DeathEvent.cpp`, `gamemode_events/GameModeEvent.cpp`
- [docs/docs_skyrim_platform.md](https://github.com/skyrim-multiplayer/skymp/blob/main/docs/docs_skyrim_platform.md)
- [Issue #1338 — onHit for the gamemode](https://github.com/skyrim-multiplayer/skymp/issues/1338) (closed as won't fix — but see §9.1: the event arrives through `onPapyrusEvent:OnHit`)

### Section 9 — DeepWiki sweep (2026-08-09)

**Primary code cited as `[DOC]` in §9.1** (read through
`gh api repos/skyrim-multiplayer/skymp/contents/<path>`, branch `main`):

- `skymp5-server/cpp/server_guest_lib/ActionListener.cpp` — `OnHit` (L1006+),
  `OnSpellHit`/`OnWeaponHit` (L1215, L1256), `SendPapyrusOnHitEvent` (L1410-1425)
- `skymp5-server/cpp/server_guest_lib/MpForm.cpp:34-40` — `SendPapyrusEvent`
- `skymp5-server/cpp/server_guest_lib/gamemode_events/PapyrusEventEvent.{h,cpp}`
- `skymp5-server/cpp/server_guest_lib/gamemode_events/GameModeEvent.cpp` — `Fire`
- `skymp5-server/cpp/addon/ScampServerListener.cpp` — `OnMpApiEvent`
- `skymp5-server/cpp/addon/PapyrusUtils.h:14-49` — Papyrus → JS conversion
- Listing of `gamemode_events/` — **there is no `HitEvent`**; the path is Papyrus

**DeepWiki pages read in §9** — [1.2 System Architecture](https://deepwiki.com/skyrim-multiplayer/skymp/1.2-system-architecture-overview) · [1.3 Repository Structure](https://deepwiki.com/skyrim-multiplayer/skymp/1.3-repository-structure) · [2.1 TypeScript Orchestration](https://deepwiki.com/skyrim-multiplayer/skymp/2.1-typescript-server-orchestration) · [2.2 ScampServer Addon](https://deepwiki.com/skyrim-multiplayer/skymp/2.2-scampserver-native-addon) · [2.3 PartOne and game loop](https://deepwiki.com/skyrim-multiplayer/skymp/2.3-partone-and-game-loop) · [2.4.1 MpActor/MpObjectReference](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.1-mpactor-and-mpobjectreference) · [2.5.1 Database and Persistence](https://deepwiki.com/skyrim-multiplayer/skymp/2.5.1-database-and-persistence) · [3.1.1 JS API and Plugins](https://deepwiki.com/skyrim-multiplayer/skymp/3.1.1-javascript-api-and-plugin-system) · [3.1.2 Event System and Text Rendering](https://deepwiki.com/skyrim-multiplayer/skymp/3.1.2-event-system-and-text-rendering) · [3.2 Client Synchronization](https://deepwiki.com/skyrim-multiplayer/skymp/3.2-client-synchronization) · [3.2.2 WorldView and Entity Rendering](https://deepwiki.com/skyrim-multiplayer/skymp/3.2.2-worldview-and-entity-rendering) · [3.2.3 Input Capture and State Sync](https://deepwiki.com/skyrim-multiplayer/skymp/3.2.3-input-capture-and-state-synchronization) · [5 Gameplay Systems](https://deepwiki.com/skyrim-multiplayer/skymp/5-gameplay-systems) · [5.2 SweetPie PvP](https://deepwiki.com/skyrim-multiplayer/skymp/5.2-sweetpie-pvp-game-mode) · [5.3 Properties System](https://deepwiki.com/skyrim-multiplayer/skymp/5.3-properties-system) · [5.4 Command System](https://deepwiki.com/skyrim-multiplayer/skymp/5.4-command-system) · [7 Glossary](https://deepwiki.com/skyrim-multiplayer/skymp/7-glossary)
