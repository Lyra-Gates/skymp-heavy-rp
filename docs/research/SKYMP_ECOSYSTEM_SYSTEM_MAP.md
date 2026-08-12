# Mapa de sistemas do ecossistema SkyMP

## Propriedades

```text
SkyrimRoleplay: housing client + custom packets + faction/hold concepts
NirnRP: housing UI/add-on
DonAthelion: ObjectReference/Camera/Input APIs
Heavy RP: housing-service PARKED
  -> arquitetura ideal: PropertyCatalog -> Ownership -> AccessGrant -> LockEnforcer -> Audit
```

O catálogo resolve `formId + world/cell + policy`; ownership pode ser personagem ou instituição; key é um grant revogável, não a autoridade final. Confisco e herança são eventos auditados.

## Facções e governança

```text
SkyrimRoleplay: holds, roster, backend whitelist, game factions
enricomalta: PermissionManager/Module pattern
Heavy RP: governance ACTIVE; faction service DEAD
  -> Faction -> Membership -> Rank -> Permission -> Appointment -> Diplomacy
```

Governance consome permissões institucionais, mas não deve ser reescrita dentro do módulo de facções.

## Identidade

```text
SkyrimRoleplay: character selection/personal data
F02K: authenticated session handoff
Heavy RP: character-state + identity + nametag PARTIAL
  -> Account -> Session -> Character -> IdentityKnowledge -> Alias/Disguise
```

Conhecimento é uma aresta entre personagens, com evidência, nome conhecido e timestamps. Staff reveal é uma capacidade separada e auditada.

## Economia, profissões e crafting

```text
enricomalta: controllers/services/repositories (prototype)
FusRoBra: miner loop/HUD (prototype)
Heavy RP: market stalls ACTIVE; regional/jobs/crafting/trade PARKED
  -> Ledger -> InventoryTransaction -> Market -> Profession -> Recipe/Crafting
```

Ordem recomendada: primeiro invariantes e ledger; depois trade; depois produção/profissão; por último preços regionais. Não ativar todos juntos.

## Crime e morte

```text
SkyrimRoleplay: death UI/state and survival experiments
enricomalta: PK/karma/red skull/war scaffold
Heavy RP: governance crime + downed/bleed-out + permakill
  -> manter implementação local; extrair apenas testes e state-machine ideas
```

## Voz

```text
theZebco: LiveKit TS -> server voiceSystem -> C++ VoiceChat -> voice-agent/infra
Heavy RP: voip-service -> UDP native helper
  -> spike comparativo -> escolher um stack -> migração -> remover o anterior
```

## Distribuição e operação

```text
F02K: buildtool -> canonical manifest -> client pack -> supervisor -> directory auth
SkyrimRoleplay: launcher/backend/server-manager
Heavy RP: game-api manifest + Electron launcher + GitHub release
  -> adaptar manifesto assinado, doctor, supervisor e rollback
```

## Persistência de mundo

```text
FusRoBra: Mongo driver/backup + estudos de objetos/NPC host
Pepsiplaya: savefile/change forms/load game patches
Heavy RP: MariaDB RP state + SkyMP native changeForms
  -> manter separação; testar ponte e restore, nunca duplicar ownership do mesmo estado
```
