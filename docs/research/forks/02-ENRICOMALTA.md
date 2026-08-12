# 02 — enricomalta/skymp

## Resumo e diferença do upstream

Snapshot `7f752f9` (2026-08-11): 14 commits à frente, 0 atrás, 300 arquivos reportados no compare. O valor principal é a organização do diretório `api/`, não uma coleção pronta de sistemas Heavy RP.

## Arquitetura

`Application`, `Module`, `ModuleLoader`, `EventBus`, `Scheduler`, `PlayerManager`, `PermissionManager`, `Logger`, `Database` e `SkyMpBridge` definem uma separação legível. Entretanto, `app.ts` instancia diretamente controllers Express e não demonstra que todos os módulos passam pelo `ModuleLoader`; existem duas histórias arquiteturais parcialmente sobrepostas.

## Classificação real

| Área | Estado | Evidência/limite |
|---|---|---|
| Core/EventBus/Logger | FUNCTIONAL_PROTOTYPE | testes para Config/EventBus/Logger; cobertura estreita |
| ModuleLoader/Scheduler/PlayerManager | FUNCTIONAL_PROTOTYPE | código concreto, pouca prova integrada |
| Auth/characters | FUNCTIONAL_PROTOTYPE | controllers/services/repositories/schemas e sessão JWT |
| Economy/inventory/item | PARTIAL | CRUD e validações; atomicidade cross-module/replay não comprovados |
| Level | PARTIAL | cálculo/service extenso; integração de gameplay não comprovada |
| NPC/quests/player-quest | PARTIAL | API/persistência; sem prova de autoridade SkyMP completa |
| PK/PvP/karma/honor/red skull/war | SCAFFOLD/PARTIAL | classes e services; pouca integração/registro e testes insuficientes |
| Death penalty | PARTIAL | regras em código; coexistem implementações em diretórios distintos |
| Anti-cheat | SCAFFOLD | recebe/registra eventos; não equivale a detecção confiável |
| Admin teleport | FUNCTIONAL_PROTOTYPE | risco alto se permission boundary falhar |

## Segurança, performance e compatibilidade

Risco `HIGH` se copiado. JWT/profile association, endpoints CRUD, teleport e inventário precisam de autorização por recurso, rate limit, transações e idempotência. O stack usa modelos/database incompatíveis com a regra MariaDB atual; não introduzir Mongo nem um segundo backend. Controllers Express por domínio aumentam superfície e queries por request; não há evidência para 100/200 jogadores.

## Recomendação

`INSPIRE`: interfaces de Module, EventBus tipado, repository/service, bridge handlers e lifecycle. `REJECT`: anti-cheat como solução pronta. `REFERENCE_ONLY`: PvP/PK/karma/war; o modelo de consentimento e conflito deve nascer das regras Heavy RP. Revisar licença arquivo a arquivo (`TERMS.md`, GitHub `NOASSERTION`) antes de qualquer cópia.
