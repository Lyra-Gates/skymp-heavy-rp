# Decisões arquiteturais vigentes

| ID | Decisão | Motivo |
|---|---|---|
| SA-001 | Evoluir `apps/web`, sem painel paralelo | preserva login, whitelist e contexto atual |
| SA-002 | MariaDB é fonte de verdade | já é dependência central e evita infraestrutura prematura |
| SA-003 | `profileId online === accountId` | remove ambiguidade entre Discord e identidade interna |
| SA-004 | Discord ID não é chave de gameplay | é identidade externa, mutável no contexto do produto |
| SA-005 | Ações passam por catálogo e fila persistente | evita shell livre, permite auditoria, timeout e retry seguro |
| SA-006 | Sem Redis/BullMQ na primeira versão | transactional outbox MariaDB resolve a necessidade inicial |
| SA-007 | Agent abre conexão de saída | reduz superfície de rede e permite host Windows atrás de NAT |
| SA-008 | RBAC SQL simples antes de Casbin/Cerbos | menor custo operacional e total transparência das permissões |

## Decisões pendentes

- Escolher runner definitivo de migrations após piloto com MariaDB.
- Definir duração e escopo dos bans.
- Definir protocolo de autenticação do Agent (mTLS ou credencial rotativa inicial).
- Definir política de múltiplos personagens por conta.
- Validar PKCE no fluxo OAuth do launcher antes de mudança em produção.
