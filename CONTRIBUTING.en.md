# Contributing

*[Português](CONTRIBUTING.md) · **English** · [Русский](CONTRIBUTING.ru.md) · [Español](CONTRIBUTING.es.md)*

Thanks for your interest. This is a public RP server base for SkyMP under AGPL-3.0 — whatever you contribute stays available to the whole community.

Two parts: how to run and submit changes, and **the rules that aren't obvious from reading the code**. The second part matters more — almost every item exists because someone already broke that thing.

---

## 1. Getting set up

You need **Node.js 20+**, **MariaDB/MySQL**, and **Skyrim SE/AE** for in-game testing.

```bash
git clone https://github.com/vinicius3232/skymp-heavy-rp.git
cd skymp-heavy-rp

cd skymp/gamemode   && npm ci && cd ../..
cd apps/web         && npm ci && cd ../..
cd apps/game-api    && npm ci && cd ../..
cd apps/bot-discord && npm ci && cd ../..
cd apps/launcher    && npm ci && cd ../..
```

Copy each `.env.example` to `.env` and fill it in — the comments explain where each value comes from.

Database: apply `skymp/packages/database/schema.sql`, then migrations `v2` through `v8`, **in order**.

```powershell
.\scripts\phase0\Start-AllServices.ps1
```

The script checks `.env` and `node_modules` for each service and tells you what won't start. If it complains, fix what it points at — it doesn't lie out of optimism.

### Debugging

Two things that exist and almost nobody uses:

- **`localhost:9000`** in your browser opens **DevTools for the game's embedded browser**. That's how you debug the `skymp/ui/` interface. Without it you're working blind.
- The server **proxies UI requests to a dev server on port 1234**, so you can iterate on interface CSS/JS without restarting anything.

---

## 2. Running tests

```bash
cd skymp/gamemode   && npm test && npm run test:systems && npm run typecheck
cd apps/web         && npm test
cd apps/game-api    && npm test
cd apps/bot-discord && npm test
cd apps/launcher    && npm run typecheck

# Needs a database: checks that it matches the versioned migrations
cd skymp/gamemode   && npm run check:schema
```

We use Node's built-in test runner (`node --test`) — no Jest, no Vitest, no config.

**A new test must be added to the `test` script in `package.json`.** There's no file discovery; a test that isn't listed simply doesn't run, and nobody notices.

---

## 3. The rules that aren't obvious

This section is the heart of the document. Each item broke for real.

### 3.1 Gold and items: only through `core/transaction-service.js`

**Never** write `UPDATE characters SET gold = ...` or touch `character_inventory` directly.

`transaction-service` does `BEGIN` / `SELECT ... FOR UPDATE` / `COMMIT`, writes to `gold_transactions`, and accepts an idempotency key. There used to be an `economy-service.js` doing bare `UPDATE`s — its `transfer` did `removeGold` then `addGold` with no transaction, so if the second failed, the gold vanished. It was deleted on 2026-08-06 precisely so the easy path stops being the wrong one.

```js
// right
await transactionService.addGold({ characterId, amount, reason: 'quest_reward', module: 'quests' });

// wrong — no atomicity, no ledger, no trace
await db.query('UPDATE characters SET gold = gold + ? WHERE id = ?', [amount, characterId]);
```

### 3.2 Papyrus: `self` is an object, never a FormID

Use the helpers in `core/papyrus.js`:

```js
const { actorRef, baseRef } = require('./core/papyrus');
mp.callPapyrusFunction('method', 'Actor', 'Resurrect', actorRef(actorId), []);
```

The gamemode already mixed both forms across 22 call sites. SkyMP's own nine integration tests (`misc/tests/` upstream) use **exclusively** the object form, including for arguments that are references. `type: 'form'` for things that exist in the world, `type: 'espm'` for plugin base records.

### 3.3 Modules: always through `core/module-registry.js`

A new service registers itself in `phase0-basic.js` with `id`, `enabledBy` (an `ENABLE_*` flag), `dependencies`, `commands` and `initialize()`. The registry resolves dependencies and registers/unregisters commands for you.

**Never import a PARKED module directly.** Seven services sit on disk and don't run (`economy-regional`, `crafting`, `jobs`, `housing`, `horse`, `trade`, `disguise`). Importing them at boot would make them run bypassing the flags — exactly what the registry exists to prevent.

### 3.4 `server-options.json`: only wired options get in

`core/server-options.js` has two lists: `SPEC` (options that actually change behavior) and `DECLARED_BUT_UNWIRED` (ones that don't do anything yet).

When you implement an option, **move it from one list to the other**. A test prevents the example file from gaining a new key without someone classifying it.

This exists because the schema documented 24 options and **none were read** — someone would set `permadeathEnabled`, nothing would happen, and they'd conclude the server was broken. Config that looks real and does nothing is worse than no config.

### 3.5 Permissions: by name, never by number

`admin-service.hasPermission(actorId, 'retire_character')`. The function rejects numbers and unknown names, logging an error — but don't rely on that, write it correctly.

There were twelve calls passing a numeric level (`hasPermission(id, 20)`) against a `Set` of strings. `Set.has(20)` is always `false`, so they silently denied everything.

### 3.6 The client is not trusted

The project's golden rule: **the server decides, the client displays.**

Events from `mp.makeEventSource` run on the client. They're a **hint**, not proof. Acceptable for detecting death; unacceptable for granting items or gold.

Same logic in `apps/web`: `discordId` is public and proves nothing. Authentication is by ticket issued by whoever holds the secret.

### 3.7 Never `DELETE` a character

Characters leave play via `status = 'retired'`. History — audit logs, transactions, criminal record — must survive. `whitelist.js` only allows spawn with `status = 'approved'`, so `retired` is enough to remove someone from play.

Watch out for `UPDATE ... JOIN` by account: approving a whitelist once resurrected a character that had been `/permakill`ed. Filter by status.

### 3.8 Papyrus calls are expensive

Each Papyrus round-trip costs **tens of milliseconds** — the Red House RP server measured 13–35 ms per call. Not microseconds.

That makes polling expensive fast. Prefer native hooks (`mp.onDeath`, `mp.onActivate`) and `mp.makeEventSource` over `setInterval` loops reading `getActorValue`. Where polling still exists, it's marked as debt.

### 3.9 Secrets never go in a `VITE_` variable

Anything `VITE_*` in the launcher is **inlined into the installer at build time** and shipped to players. The Discord client secret used to live there — it now lives only in `apps/web`, which performs the token exchange.

---

## 4. Code style

- **Portuguese** for comments, documentation and player-facing messages. Identifiers in English, matching the file you're in.
- **Comments explain why, not what.** `// increment i` helps nobody; `// FOR UPDATE here because two concurrent purchases duplicated the item` helps a lot.
- **No build step in the gamemode.** It's plain JS loaded directly by SkyMP. `npm run typecheck` uses `types/mp.d.ts` and is informational — don't introduce compilation, it would add a step to the project's slowest loop (edit → test in game).
- Follow the style of the file you're editing, even if you'd do it differently.

### Typing the `mp` API

`skymp/gamemode/types/mp.d.ts` marks the provenance of every signature: `[DOC]` for what's in SkyMP's official documentation, `[USO]` for what was inferred from our usage.

When you discover something new in real testing, add it as `[USO]` and say where it was observed. The distinction matters: `[USO]` can change without warning in a SkyMP update.

---

## 5. Commits and Pull Requests

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(gamemode): adiciona zona segura por celula
fix(web): valida redirect_uri antes de trocar o code
docs: documenta o contrato de FormID
```

Scopes in use: `gamemode`, `web`, `game-api`, `bot-discord`, `launcher`, `schema`.

Commit messages are written in Portuguese to match the codebase, but **English is fine** if that's what you're comfortable with — a clear message in English beats an unclear one in Portuguese.

**Explain the why in the commit body.** This project's history is a real source of context; several commits explain decisions that don't fit in code.

### Before opening a PR

- [ ] Tests pass for the services you touched
- [ ] `npm run typecheck` clean, if you touched the gamemode or launcher
- [ ] New test for new behavior — checking the **argument**, not just the result (see §6)
- [ ] Documentation updated if behavior or architecture changed
- [ ] No secrets, real `.env`, or Bethesda assets in the diff

---

## 6. On tests that give false confidence

Worth its own warning, because it cost us.

The global `mp` is mocked in tests. **A mock accepts anything** — that's how 22 Papyrus calls with the wrong argument shape sat green for months. Worse: the `if (typeof mp === 'undefined') return;` guards meant tests never even reached that code.

When testing something that talks to SkyMP or the database, **assert on the argument that was passed**, not just the return value:

```js
// weak: passes even if the format is wrong
assert.equal(await service.giveItem(...), true);

// strong: catches contract errors
assert.equal(typeof call.self, 'object', 'self must be an object, not a FormID');
assert.match(query.sql, /FOR UPDATE/, 'without the lock, two purchases duplicate the item');
```

`core/papyrus.test.js` and `apps/web/server.test.js` have examples.

---

## 7. Reporting problems

- **Question, loose idea, or help request**: [Discussions](https://github.com/vinicius3232/skymp-heavy-rp/discussions). That's where the answer stays visible for whoever comes next.
- **Bug or concrete proposal**: open an issue. Say which service, what you expected, what happened.
- **Security issue**: **don't open a public issue** — see [SECURITY.en.md](SECURITY.en.md).
- **Question about a mod**: the [Mods × Gamemode Contract](docs/technical/MODS_AND_GAMEMODE_CONTRACT.md) §4 has a four-question test that settles most cases.

---

## 8. Where to start reading

1. [`docs/README.md`](docs/README.md) — the documentation map
2. [`docs/technical/QA_REPORT_2026-08.md`](docs/technical/QA_REPORT_2026-08.md) — real status of each component, including what **isn't** ready
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces talk

Those are in Portuguese — see the [language note](README.en.md#documentation-language). The QA report is the most honest about where the project stands; if something looks odd in the code, it's probably already documented there.
