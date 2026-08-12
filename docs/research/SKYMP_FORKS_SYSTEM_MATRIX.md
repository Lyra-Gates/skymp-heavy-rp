# Matriz de sistemas dos forks SkyMP

Escala de segurança: `GOOD`, `MIXED`, `WEAK`, `UNKNOWN`. Aplicabilidade considera o Heavy RP e a arquitetura MariaDB atual. Notas: `GV` gameplay, `HRP` Heavy RP, `CQ` qualidade, `ARQ`, `SEG`, `PERF`, `MAN`, `COMP`, `COST`; 0 é pior/menor, 5 é melhor/maior. Em `COST`, 5 significa custo alto.

| Fork | Sistema | Arquivos principais | Maturidade | Segurança | Aplicabilidade | Decisão | Notas GV/HRP/CQ/ARQ/SEG/PERF/MAN/COMP/COST | Conclusão |
|---|---|---|---|---|---|---|---|---|
| SkyrimRoleplay | Properties/housing | `housingService.ts`, custom packets, docs properties | FUNCTIONAL_PROTOTYPE | MIXED | VERY_HIGH | ADAPT | 5/5/3/3/3/3/3/3/4 | USE_LATER |
| SkyrimRoleplay | Factions/holds/roster | `factionService.ts`, `backendFactionApi.ts`, `factionWhitelist.js` | PARTIAL | MIXED | VERY_HIGH | ADAPT | 5/5/3/3/3/3/3/3/4 | USE_LATER |
| SkyrimRoleplay | Character select | `characterSelectService.ts`, backend | FUNCTIONAL_PROTOTYPE | MIXED | HIGH | ADAPT | 4/5/3/3/3/3/3/3/3 | USE_LATER |
| SkyrimRoleplay | Death/survival | `deathService.ts`, death UI, Frostfall docs | PARTIAL | MIXED | MEDIUM | DUPLICATE_EXISTING | 4/4/3/3/3/3/3/2/4 | REFERENCE_ONLY |
| SkyrimRoleplay | Backend/dashboard/manifest | `skymp5-backend`, `server-manager` | PARTIAL | MIXED | HIGH | INSPIRE | 3/3/3/3/2/3/2/2/4 | REFERENCE_ONLY |
| enricomalta | Application/ModuleLoader/EventBus | `api/src/core/*` | FUNCTIONAL_PROTOTYPE | GOOD | HIGH | INSPIRE | 2/3/3/4/3/3/4/3/3 | USE_LATER |
| enricomalta | Auth/characters | `modules/auth`, `modules/characters` | FUNCTIONAL_PROTOTYPE | MIXED | MEDIUM | INSPIRE | 4/4/3/3/2/3/3/1/5 | REFERENCE_ONLY |
| enricomalta | Economy/inventory/items | module controllers/services/repositories | PARTIAL | WEAK | MEDIUM | INSPIRE | 4/4/2/3/2/2/3/1/5 | REFERENCE_ONLY |
| enricomalta | PvP/PK/karma/war | `modules/PvP/*` | SCAFFOLD | WEAK | MEDIUM | INSPIRE | 4/4/2/2/1/3/2/2/4 | REFERENCE_ONLY |
| enricomalta | Anti-cheat | `modules/anticheat/*` | SCAFFOLD | WEAK | LOW | REJECT | 2/3/1/2/1/2/2/2/4 | IGNORE |
| enricomalta | Quests/NPC/level | module trees | PARTIAL | UNKNOWN | LOW | RESEARCH_MORE | 3/3/2/3/2/2/3/1/5 | REFERENCE_ONLY |
| F02K | Managed server/supervisor | `supervisor.ts`, `main.ts`, packaging scripts | FUNCTIONAL_PROTOTYPE | GOOD | VERY_HIGH | ADAPT | 2/3/4/4/4/4/4/4/3 | USE_NOW |
| F02K | Directory auth/sessions | `directory-auth.ts`, connector, storage | FUNCTIONAL_PROTOTYPE | GOOD | VERY_HIGH | ADAPT | 2/5/4/4/4/4/4/3/4 | USE_NOW |
| F02K | Client pack/manifest | `client-pack.ts`, `modcollection.ts`, buildtool | PRODUCTION_READY candidate | GOOD | VERY_HIGH | ADAPT | 3/4/4/4/4/4/4/4/3 | USE_NOW |
| F02K | Gamemode compiler | compiler builder/checker/types | FUNCTIONAL_PROTOTYPE | GOOD | MEDIUM | RESEARCH_MORE | 2/3/4/4/4/4/4/2/5 | USE_LATER |
| NirnRP | Admin/animation/housing/item UI | `constructorComponents/*` | FUNCTIONAL_PROTOTYPE | UNKNOWN | HIGH (UI) | INSPIRE | 4/4/3/3/1/3/3/3/3 | REFERENCE_ONLY |
| NirnRP | Object/Magic APIs | `ObjectReferenceApi`, `MagicApi` | PARTIAL | UNKNOWN | HIGH | RESEARCH_MORE | 4/4/3/3/2/3/2/2/5 | USE_LATER |
| NirnRP | Clone AI/horse physics | `CloneAiThrottle`, `HorsePhysicsBlock` | EXPERIMENTAL | UNKNOWN | MEDIUM | RESEARCH_MORE | 3/3/2/2/2/3/2/2/5 | REFERENCE_ONLY |
| theZebco | LiveKit voice | TS service/system, C++ client, Go agent, Terraform | FUNCTIONAL_PROTOTYPE | MIXED | VERY_HIGH | RESEARCH_MORE | 5/5/4/4/3/4/3/2/5 | USE_LATER |
| FusRoBra | Miner/HUD | miner docs + front code | PROTOTYPE | MIXED | MEDIUM | INSPIRE | 4/4/2/2/2/2/2/2/4 | REFERENCE_ONLY |
| FusRoBra | Mongo persistence/backup | Mongo driver/tests/scripts | IMPLEMENTED | MIXED | LOW | REJECT as DB; INSPIRE ops | 2/2/3/3/3/3/3/0/5 | REFERENCE_ONLY |
| FusRoBra | Mount/NPC host/persistent objects | `ESTUDO-*`, viability docs | RESEARCH | UNKNOWN | MEDIUM | RESEARCH_MORE | 4/4/3/3/2/2/3/3/5 | REFERENCE_ONLY |
| DonAthelion | ObjectReference/Camera/Input/CallNative | Skyrim Platform C++ APIs | FUNCTIONAL_PROTOTYPE | MIXED | HIGH | RESEARCH_MORE | 4/4/3/3/2/3/2/2/5 | USE_LATER |
| Pepsiplaya | Save/load/change forms | SFReader/Writer, CombineBrowser, LoadGame | EXPERIMENTAL | UNKNOWN | MEDIUM | RESEARCH_MORE | 3/4/3/3/2/3/2/2/5 | REFERENCE_ONLY |
| reggiedroid | Engine/gameplay changes | 39-file divergence | UNKNOWN | UNKNOWN | LOW pending review | RESEARCH_MORE | 2/2/2/2/2/2/2/2/5 | REFERENCE_ONLY |
| Metadraconis/skymp-vgr | Sync/voice-related divergence | 30-file divergence; existing local study | EXPERIMENTAL | UNKNOWN | MEDIUM | RESEARCH_MORE | 3/3/2/2/2/2/2/2/5 | REFERENCE_ONLY |
| dotKz and zero-delta mirrors | Nenhum código próprio útil | compare API | MIRROR/BEHIND | N/A | NONE | REJECT | 0/0/0/0/0/0/0/0/0 | IGNORE |

## Security blockers derivados

- `AUTH-01`: rejeitar identidade, cargo, saldo, target ownership e `profileId` fornecidos pelo cliente.
- `ECON-01`: toda transferência requer idempotency key, lock/transaction e ledger append-only.
- `PROP-01`: target de porta/container deve ser resolvido no servidor por catálogo permitido e distância/célula observada.
- `VOICE-01`: token de sala deve ter audience, TTL curto, escopo e revogação; cliente não escolhe arbitrariamente a sala.
- `MOD-01`: SHA-256 sem autenticidade não basta; assinar o manifesto e proteger a chave de release.
