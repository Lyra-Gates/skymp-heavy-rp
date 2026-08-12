# Gap analysis do SkyMP Heavy RP

Snapshot: árvore local em 2026-08-12. `COMPLETE` não foi atribuído a nenhum domínio que dependa de sessão multiplayer real ou operação pública sem evidência de teste de carga/E2E.

| Área | Estado | Evidência | Gap principal | Próximo gate |
|---|---|---|---|---|
| characters | PARTIAL | character state, application schema | slots/sessão/reconnect | CHR-001/002 |
| identity | PARTIAL | identity + nametag tests | knowledge, alias, disguise | IDN model |
| chat | GOOD | service + tests | carga/spatial index | benchmark 100 |
| voice | NEEDS_REFACTOR | helper + service + tests | NAT/capacidade/mute/reconnect | VOI-001 |
| death | GOOD | state machine + tests | E2E A/B/C | session matrix |
| PK | PARTIAL | permakill/soul | política e atomicidade | PK contract |
| CK | WEAK | componentes parciais | lifecycle completo | product decision |
| governance | GOOD | prison/fine/warrant + hardening | depende de facções/tesouro | institutional RBAC |
| crime | GOOD | governance/evidence concepts | confiscation/case lifecycle | crime ledger |
| factions | MISSING | serviço removido | domínio inteiro | FAC-001..004 |
| properties | WEAK | arquivo PARKED | ownership/access/enforcement | PROP-001..004 |
| economy | PARTIAL | stalls + gold + transaction work | ledger global e invariantes | ECON boundary |
| professions | WEAK | jobs PARKED | authority/anti-farm | after ledger |
| crafting | WEAK | service PARKED + seed | inventory transaction | after trade |
| survival | MISSING | serviço removido | valor de produto não provado | research only |
| trade | WEAK | service PARKED | atomicity/replay/disconnect | TRADE protocol |
| NPCs | WEAK | cleaner/fauna probes | authority/AI/load | host spike |
| quests | MISSING | sem domínio próprio | escopo e persistence | post-MVP |
| mounts | WEAK | horse PARKED | shared state/ownership | native spike |
| objects | PARTIAL | native changeForms | catalog/ownership/reconnect | object contract |
| staff | GOOD | admin/permissions/tests | RBAC unificado | permission audit |
| logging | GOOD | moderation log + Discord | correlation/redaction | structured log |
| anti-cheat | PARTIAL | server validation/hardening | threat model/telemetry | abuse suite |
| launcher | PARTIAL | Electron app | signed manifest/rollback | MOD-001..004 |
| modpack | PARTIAL | manifest generator/docs | authenticity/load-order gate | signed canonical pack |
| authentication | PARTIAL | web/launcher/whitelist | opaque handoff/replay | AUTH-001..004 |
| database | GOOD | MariaDB schema/migrations/mysql2 | drift + transaction coverage | CI schema gate |
| monitoring | WEAK | health concepts/logs | metrics/SLO/alerts | OPS observability |

## Ordem de desbloqueio

```text
Session/Character
  -> Identity
  -> Transaction + Audit primitives
  -> Faction membership/permissions
  -> Property ownership/access
  -> Trade/inventory atomicity
  -> Regional economy
  -> Professions
  -> Crafting
  -> Survival (somente após decisão de produto)
```

Esta ordem evita que propriedades usem IDs instáveis, que facções dupliquem governance e que economia seja ativada sem transação. Disfarces vêm após IdentityKnowledge, não junto de nametags.

## Cenários obrigatórios de escala

| Jogadores | Objetivo mínimo |
|---:|---|
| 10 | Correção funcional A/B/C, reconnect e falha de backend |
| 30 | Voz simultânea, chat, death e market sem perda |
| 50 | Meta inicial; p95 de handlers, DB pool e largura de banda |
| 100 | Teste de capacidade, não promessa de suporte |
| 200 | Pesquisa/limite; exigir spatial index, backpressure e orçamento por sistema |
