# ADR-001 — `profileId` online representa `accountId`

Status: **ACCEPTED FOR IMPLEMENTATION**, aguardando revisão adversarial do Claude. Data: 2026-08-12.

## Contexto

Com `offlineMode=false`, o SkyMP resolve `gameData.session` no Master API. O endpoint local retorna `user.id = game_sessions.account_id`; esse número vira `profileId` no runtime. O gamemode, porém, ainda consulta `discord_identities.discord_id = profileId`. Isso mistura namespaces sem garantia de igualdade.

## Decisão

1. Em modo online, `profileId` significa exclusivamente `accounts.id`.
2. `discordId` é atributo externo associado à conta, nunca ID de gameplay.
3. `actorId` e `userId` são handles efêmeros da conexão e nunca persistem como identidade.
4. O personagem será resolvido server-side a partir da conta/sessão. Até CHR-002, mantém-se a restrição efetiva de um personagem approved ativo por conta.
5. Em laboratório offline, profile IDs 1/2 continuam permitidos somente quando `NODE_ENV !== production` e `ALLOW_LOCAL_AUTOWHITELIST=true`.

## Alteração futura de AUTH-003

`whitelist.checkWhitelist(userId, profileId, actorId)` deverá renomear semanticamente `profileId` para `accountId` no interior da função e consultar:

```sql
SELECT id, status, vip_level FROM accounts WHERE id = ?
```

Quando necessário, Discord será obtido por join server-side. Nenhum payload de UI fornece accountId/characterId para autorização.

## Consequências

- Corrige AUTH-02 sem mudar o contrato esperado pelo upstream SkyMP.
- Contas existentes continuam com seus IDs primários; não há migration nesta decisão.
- Auto-whitelist local passa a criar/usar conta pelo ID de laboratório de modo explícito, sem fingir que ele é Discord ID.
- Logs devem usar `accountId` e correlation ID; Discord ID só quando necessário e redigido conforme política.
- CHR-002 poderá vincular `game_sessions.character_id` ou tabela equivalente posteriormente.

## Alternativas rejeitadas

- Retornar Discord snowflake como `user.id`: o contrato exige número JS seguro e snowflakes excedem o intervalo seguro; truncar causa colisões.
- Derivar profileId dos últimos dígitos do Discord: controlável pelo cliente e sujeito a colisões.
- Manter igualdade acidental entre accountId e discordId: não é uma invariante do schema.

## Gates

- Teste Master API prova `user.id = account_id`.
- Testes de whitelist devem provar consulta por `accounts.id` antes de alterar produção.
- Config doctor reprova offline mode fora do local.
- Launcher deixa de escrever profileId legado quando Claude integrar MOD/AUTH no client.
