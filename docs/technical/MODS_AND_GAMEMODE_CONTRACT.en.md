# How a mod behaves inside the gamemode

*[Português](MODS_AND_GAMEMODE_CONTRACT.md) · **English** · [Русский](MODS_AND_GAMEMODE_CONTRACT.ru.md) · [Español](MODS_AND_GAMEMODE_CONTRACT.es.md)*

`docs/MODDING_GUIDELINES.md` (Portuguese) covers **what** is allowed and **why** — policy, blacklist, QA phases. This document is the other half: **what technically happens** to a mod when it enters a client connected to our server, based on the code that exists today in `skymp/gamemode/`.

It exists to answer, without guesswork, the question that always comes back: *"does this mod work on the server?"*

---

## 1. The three layers, and where each mod lands

A client connected to our server has three independent layers. A mod acts on one or more of them, and that's what decides its fate.

| Layer | Who's in charge | What a mod can do here |
|---|---|---|
| **Assets** (`.nif`, `.dds`, sound, animation) | The client, locally | Change appearance freely. The server never reads a mesh or a texture. |
| **Plugin records** (`.esp`/`.esm`/`.esl`: FormIDs, stats, recipes, leveled lists) | The plugin, **identical for everyone** | Define what exists in the world. Only works if **everyone** has the same plugin in the same position. |
| **Gameplay logic** (who owns what, who may do what, what it costs) | The Node.js gamemode, on the server | **Nothing.** Mod scripts are not consulted in any decision. |

The confusion almost always comes from treating the three as one thing — because in single-player they are.

---

## 2. Why mod Papyrus scripts have no gameplay effect

The gamemode doesn't listen to Papyrus — it **calls** Papyrus. Traffic is one-way, server to client.

The entire vocabulary the server uses against the game today fits in this list (collected from the `mp.callPapyrusFunction` calls in `skymp/gamemode/`):

```
Debug.notification          Debug.SendAnimationEvent    Game.getFormEx
Actor.getActorValue         Actor.SetActorValue         Actor.GetItemCount
Actor.PlayIdle              Actor.Resurrect
ObjectReference.AddItem     ObjectReference.RemoveItem
ObjectReference.disable     ObjectReference.delete
```

They are all **imperative**: "show this", "play that animation", "put this item there". There is no point where the server asks the client "so, what happened?" and believes the answer.

*(Note from 2026-08-06: the server can also **read plugin records** via `mp.lookupEspmRecordById(formId)` — weapon base damage, armor value, perks, race. This doesn't change the rule above, but it widens what can be validated without trusting the client: the server can check a weapon's damage against the ESM rather than against a table of our own. See `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1, Portuguese.)*

The practical consequence:

- A mod that adds an `OnActivate` script to a crafting bench **does run** on the client that installed it. But if it grants an item, that item exists only on that player's screen — it doesn't go through `core/transaction-service.js`, so it isn't in `character_inventory`, doesn't show up in `/painel`, and vanishes on the next login.
- An economy mod that changes merchant prices changes the local vanilla menu. Player market stalls (`market-stalls-service.js`) read prices from `market_stall_items` in MySQL and never look at the record.
- A survival mod applying a hunger effect changes the local `ActorValue`. `death-service.js` polls `Actor.getActorValue('Health')` and will see the drop — meaning a survival mod **can** put someone's character into our `DOWNED` state. That's exactly why survival scripts are blacklisted on the client side.

That last case is the general rule worth internalizing: **a mod cannot create state, but it can move ActorValues, and the server reads ActorValues.** Any mod touching health, stamina or magicka must be treated as a gameplay mod, even if it advertises itself as visual.

---

## 3. The FormID contract

What the server **actually** shares with plugins is FormIDs. They show up in three places in the code:

- `core/transaction-service.js` writes `character_inventory (character_id, base_id, count)` — `base_id` is a FormID.
- `admin-service.giveItemAdmin(actorId, targetActorId, baseId, count)` and the `/additem <actorId> <baseId> <count>` command.
- `market-stalls-service.js` stores the `base_id` of every listed item and uses `Game.getFormEx` + `PlaceAtMe` to materialize the stall.

A FormID carries the load order index in its first byte (`0xXX......`). From that comes the hard rule:

> **If two players' load orders differ by a single position, FormIDs shift and the same `base_id` in the database becomes a different item on each screen.**

This is not a bug you can work around with more server-side validation — the database stores a number that only means something inside one specific load order. That's why plugin parity is mandatory rather than a quality preference.

It's also why the launcher (`apps/launcher/electron/main.ts`) does two separate things:

1. `verify-mods`: compares the hash of every file in `Data/` against the server's `mods.json` — guarantees the **content** is the same.
2. `analyze-plugins`: reads each plugin's header, checks that every master exists and appears **before** its dependent — guarantees the **order** is the same.

Only both together uphold the contract. Either one alone is not enough.

---

## 4. A practical test to classify a mod

Before sending a mod into the QA phases of `MODDING_GUIDELINES.md`, run these four questions. They separate "approve outright" from "needs testing" from "rejected" faster than reading the Nexus page.

**1. Does it have an `.esp`/`.esm`/`.esl`?**
No → it's a pure asset replacer. It lands in layer 1, and is almost always approvable as a visual option (Profile 2).
Yes → keep going.

**2. Does it have scripts (`.pex`) or depend on SKSE?**
Yes → assume local logic. It only gets in if the logic is purely cosmetic (camera, HUD, UI). Anything that grants an item, changes a price, alters an ActorValue or fires a world event is rejected — not because it will "break", but because it creates a second authority over state, and then the player sees one thing while the database says another.

**3. Does it add or reorder records?**
Yes → it must go into Profile 1 (identical for everyone) and into a fixed load order slot. It cannot be optional. If it isn't worth making mandatory for everyone, it isn't worth adding.

**4. Does it touch NPCs, spawns or cells?**
Yes → the server has authority over actors (`npc-cleaner.js`, `mp.getActorsByProfileId`). A mod that adds or repositions an NPC conflicts head-on. That's the origin of the Immersive Citizens, Open Cities and JK's Skyrim rejections on the blacklist.

---

## 5. What changes when the mod is ours

Our own plugins (`HeavyRP_Equipment.esm`, `HeavyRP_Props.esm`) escape none of the above — they just give us the two things we don't get from a third-party mod:

- **Stable FormIDs**, chosen by us and never reordered.
- **No scripts**, because the corresponding logic is written as a service in `skymp/gamemode/` and goes through `core/module-registry.js`, `core/action-policy.js` and `core/transaction-service.js` like any other feature.

In other words: "our mod" is always a pair — a script-free plugin declaring what exists, and a Node service deciding what happens.

---

## 6. Cross-references

All Portuguese-only:

- `docs/MODDING_GUIDELINES.md` — policy, profiles, QA phases, blacklist.
- `docs/technical/LAUNCHER_DISTRIBUTION.md` — how parity is distributed and verified in practice.
- `docs/technical/MARKET_STALL_VISUAL_ASSET_PLAN.md` — this test applied to a concrete case (market stalls).
- `docs/legal/ASSET_LICENSE_REGISTRY.md` and `docs/technical/LICENSE_AND_AFFILIATION_POLICY.md` — the licensing side, which is a separate barrier, independent from the technical one.
