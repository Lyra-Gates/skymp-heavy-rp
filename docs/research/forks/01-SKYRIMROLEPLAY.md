# 01 — SkyrimRoleplay/skyrp

## Resumo e diferença do upstream

Snapshot `83ca453` (2026-07-27): 234 commits à frente, 6 atrás, 249 arquivos divergentes. É o fork mais relevante para gameplay RP e o mais divergente dos auditados. Adiciona backend, launcher, server-manager, deploy, UI e serviços de gameplay sobre a base SkyMP.

## Arquitetura

```text
Client service/UI -> customPacket intent -> gamemode/server validation
  -> world/custom properties and/or backendFactionApi
  -> backend HTTP + persistence -> refreshed private state -> client UI
```

O desenho correto aparece quando o cliente pede `propertyInfoRequest/propertyRequest` e o servidor decide. O risco aparece nos pontos em que target/nome/ação e identidade atravessam packets/HTTP sem um contrato uniforme de autorização.

## Sistemas encontrados

- **Properties/housing — FUNCTIONAL_PROTOTYPE:** `housingService.ts`, property request packets, UI e docs. Inclui claim, rename e operações de acesso. `ADAPT`.
- **Facções/holds — PARTIAL:** `factionService.ts`, `backendFactionApi.ts`, faction whitelist/backend roster. Há serialização por profile na bridge e mutations não são automaticamente repetidas, uma boa defesa contra replay acidental. `ADAPT`.
- **Character selection — FUNCTIONAL_PROTOTYPE:** serviço cliente e dados por personagem. `ADAPT` para Account/Session/Character local.
- **Death/bleedout/UI — PARTIAL:** animações e death screen. O Heavy RP já tem state machine melhor integrada; `DUPLICATE_EXISTING`.
- **Survival/Frostfall — PARTIAL/RESEARCH:** documentação e integração cliente; não adotar sem decisão de produto.
- **Backend/dashboard/manifest/manager — PARTIAL:** útil como estudo operacional, porém acoplado à implantação do fork.

## Segurança e performance

Risco geral `MEDIUM/HIGH` para reutilização direta. Todo `target`, `profileId`, player name, faction requirement e property action deve ser re-resolvido no servidor. Exigir idempotency key para mutations e não depender de GET-before-POST como única proteção concorrente. Loops de proximidade e refresh de UI precisam de benchmark; backend HTTP não deve ficar no caminho síncrono de cada tick.

## Compatibilidade e licença

O repositório conserva `TERMS.md` do upstream e componentes com licenças próprias. O detector GitHub retorna `NOASSERTION`; portanto reutilização literal fica `INSPIRE_ONLY` até revisão arquivo a arquivo. Conceitos são compatíveis; Mongo/backend específico e suposições de holds não são. O Heavy RP permanece AGPL-3.0-or-later e MariaDB/MySQL.

## Recomendações

Adaptar: target resolver, grants/keys/locks, membership/rank/roster e seleção de slot. Não copiar: backend completo, UI específica, IDs de holds, Mongo, manifests do fork ou services client-authoritative. Testar property claim A/B/C, revoke/reconnect, faction promote sem autorização, corrida e backend indisponível.
