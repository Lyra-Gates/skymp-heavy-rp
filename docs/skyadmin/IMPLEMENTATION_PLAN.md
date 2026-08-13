# Plano de implementação

## Marco 0 — base e testes

- Inventariar rotas, tabelas, permissões e fluxos existentes.
- Manter uma suíte executável sem servidor externo.
- Critério: testes web, game-api, bot, launcher e gamemode documentados e reproduzíveis.

## Marco 1 — identidade e migrations

- [x] Definir `profileId online === accountId`.
- [x] Corrigir a whitelist para consultar `accounts.id`.
- [ ] Formalizar runner único de migrations e checagem de drift.
- [ ] Cobrir login, sessão expirada, reconexão e revogação com testes de integração MariaDB.

## Marco 2 — RBAC no banco

- Criar `staff_roles`, `staff_permissions`, `staff_role_permissions`, `staff_memberships` e overrides somente onde necessário.
- Substituir o gate genérico `requireStaff` por `requirePermission(permission)`.
- Registrar toda negação e alteração de permissão.
- Critério: matriz de permissões testada para cada rota administrativa.

## Marco 3 — pipeline de ação e auditoria v2

- Criar catálogo de ações e schemas JSON validados.
- Criar `admin_actions`, `admin_action_attempts`, `admin_action_outbox` e `admin_action_results`.
- Implementar idempotência, motivo obrigatório, correlação e transactional outbox.
- Critério: retries não duplicam efeitos e falhas são visíveis no histórico.

## Marco 4 — moderação e aplicação no jogo

- Implementar notas, warnings, ban persistente, revogação de sessões e kick.
- Criar SkyAdmin Agent/bridge mínima para estado online e kick.
- Critério: ban impede login; kick afeta só o alvo; ambas as ações ficam auditadas.

## Marco 5 — interface de operação

- Lista e busca de jogadores/contas/personagens.
- Perfil de jogador com timeline, notas, histórico de sessões e moderação.
- Whitelist e staff manager sobre APIs protegidas.
- Critério: nenhuma ação sensível é um CRUD genérico de banco.

## Marco 6 — segurança e staging

- Sessão MariaDB, CSRF, CSP, rate limits persistentes quando necessário e logs estruturados.
- Staging com TLS, secrets externos e backup/restauração testados.
- Critério: checklist de segurança aprovado antes de produção.

## Ordem de trabalho imediata

1. Documentação central e runner de migrations.
2. Modelo RBAC e migrations.
3. Middleware de permissão e testes web.
