# Projeto SkyAdmin

## Objetivo

Transformar o painel web já existente em uma superfície administrativa segura para whitelist, gestão de jogadores, staff, moderação, auditoria e operações do servidor SkyMP.

## Escopo inicial

- Login Discord e sessão web persistente.
- RBAC granular, baseado no banco, com negação por padrão.
- Consulta de jogadores, contas, personagens, whitelist e histórico.
- Ações moderadas: aprovar/rejeitar whitelist, notas, warn, kick, ban e revogação de sessão.
- Auditoria imutável de ações administrativas.
- Fila transacional de ações e, depois, ponte para o processo SkyMP.

## Fora do escopo inicial

- Painel genérico de SQL ou edição direta de tabelas.
- Execução arbitrária de shell/console pelo navegador.
- Substituir SkyMP, txAdmin, GameAP ou Pterodactyl.
- Redis, BullMQ, microsserviços e containers obrigatórios.
- Ações in-game perigosas antes de existir uma ponte autenticada e idempotente.

## Princípios

1. MariaDB é a fonte de verdade.
2. O navegador pede uma ação; nunca escolhe como ela é executada.
3. Toda mutação tem ator, alvo, motivo, permissão, `request_id`, resultado e auditoria.
4. A identidade de jogo vem do Master API, nunca de um ID declarado pelo cliente.
5. Falhar fechado para autorização e ações destrutivas.
6. O painel evolui dentro de `apps/web`; não será criado um segundo produto paralelo.

## Indicadores de pronto para uso de staff

- Staff sem permissão não consegue inferir nem executar ação privilegiada.
- Repetir uma requisição não duplica efeito.
- Uma ação falha deixa resultado e motivo consultáveis.
- Ban e logout revogam sessões de jogo aplicáveis.
- Cada rota administrativa possui teste de autorização e auditoria.
