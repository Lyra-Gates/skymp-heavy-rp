# Operação e testes

## Ambientes

| Ambiente | Finalidade | Regras |
|---|---|---|
| Local | desenvolvimento e laboratório | auto-whitelist somente com flag explícita; dados descartáveis |
| Staging | ensaio de release | `offlineMode=false`, secrets próprios, TLS e banco isolado |
| Produção | jogadores reais | backups, monitoramento, acesso mínimo e mudança rastreável |

## Comandos de verificação atuais

```powershell
Set-Location skymp/gamemode
npm test
npm run typecheck
```

Os demais pacotes possuem suas próprias suítes. Antes de alterar contrato entre componentes, rodar os testes de `apps/web`, `apps/game-api`, `apps/bot-discord` e `apps/launcher` também.

## Migrations

- Nunca editar migration já aplicada.
- Nova mudança de schema recebe nova migration versionada em `skymp/packages/database/`.
- Aplicar schema base e migrations em ordem numérica.
- Rodar `npm run check:schema:list` no gamemode para validar o inventário; a checagem real exige banco configurado.
- Backups e restauração devem ser ensaiados no staging antes de qualquer alteração destrutiva.

## Runbook de incidente administrativo

1. Pausar a ação afetada, não editar linhas manualmente.
2. Buscar `request_id`, `action_id`, conta alvo e logs correlacionados.
3. Confirmar estado no banco e no Agent/SkyMP.
4. Revogar sessão ou aplicar contenção mínima se houver risco ativo.
5. Registrar causa, correção e teste de regressão.

## Critério de staging

- Login Discord e fila funcionam com ticket válido.
- Sessão expirada/revogada retorna falha de login.
- Whitelist aprovada entra; conta inativa ou banida não entra.
- Rate limit, CSRF e permissão recusam corretamente.
- Auditoria contém ator, alvo, ação e resultado.
