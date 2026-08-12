# AUTH-002 — Contrato de credenciais opacas v1

Status: proposta pronta para revisão adversarial do Claude. Não implementada.

## Princípio

Tokens são strings aleatórias opacas. Claims ficam somente no servidor/MariaDB; o cliente não interpreta nem altera identidade. “Opaco” é preferível a JWT neste fluxo porque revogação, uso único e fila já dependem de estado server-side.

## Tipos

| Tipo | Audience | Emissor | Consumidor | TTL recomendado | Reuso |
|---|---|---|---|---:|---|
| `launch_grant.v1` | `game-api:queue` | web após OAuth | game-api | 5 min | uma vez |
| `queue_grant.v1` | `game-api:poll` | game-api | game-api | 2 min deslizante, teto 15 min | rotativo; anterior invalidado |
| `game_session.v1` | `skymp:master-api` | game-api | Master API/SkyMP | 8 h | reconnect permitido |

## Representação externa

```text
hrp_<tipo-curto>_v1_<base64url(32 random bytes)>
```

Prefixos: `lg`, `qg`, `gs`. O prefixo roteia e facilita redaction; não carrega identidade. Entropia mínima: 256 bits de CSPRNG. Comprimento máximo aceito: 128 caracteres. Comparação por hash server-side.

Exemplos não válidos para produção:

```text
hrp_lg_v1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
hrp_qg_v1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
hrp_gs_v1_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC
```

## Registro server-side canônico

```json
{
  "version": 1,
  "kind": "game_session",
  "tokenHash": "sha256-lowercase-hex",
  "accountId": 42,
  "characterId": null,
  "audience": "skymp:master-api",
  "nonce": "server-generated-unique-id",
  "issuedAt": "2026-08-12T02:00:00.000Z",
  "expiresAt": "2026-08-12T10:00:00.000Z",
  "consumedAt": null,
  "revokedAt": null,
  "replacedById": null,
  "keyId": null
}
```

`characterId` é `null` até CHR-002. Depois do bind, deve pertencer a `accountId` e não pode mudar na mesma sessão. `keyId` fica reservado para assinatura de requests inter-service; o token opaco em si não precisa ser assinado.

## Regras de validação

1. Rejeitar antes do DB se tipo, prefixo, versão, charset ou tamanho forem inválidos.
2. Calcular SHA-256 do token completo; nunca logar token ou hash completo.
3. Consultar por `token_hash + kind + audience`.
4. Rejeitar `revoked_at`, expiry e cadeia substituída.
5. `launch_grant` é consumido atomicamente com `UPDATE ... WHERE consumed_at IS NULL AND expires_at > NOW()`; exatamente uma linha deve mudar.
6. `queue_grant` rotaciona em transação: novo registro criado, anterior marcado consumed/replaced.
7. `game_session` pode resolver novamente; incrementar contador e registrar last-resolved sem renovar TTL automaticamente.
8. Resolver identidade exclusivamente do registro: client payload não fornece accountId, Discord ID, characterId, role ou audience.
9. Datas são avaliadas no servidor/DB em UTC. Clock do cliente é irrelevante.
10. Falha de DB é deny-by-default; não cair para profileId local.

## Reconnect e concorrência

- Duas resoluções válidas da mesma game session podem ocorrer durante reconnect; ambas apontam a mesma account/character.
- Connection monitor usa generation/session local para que a resposta antiga não altere o novo actor.
- `resolve_count` é telemetria, não autorização. Alerta de uso simultâneo exige correlação por servidor/conexão antes de revogar.
- Logout/ban revoga todas as game sessions relevantes em transação. Disconnect comum não revoga automaticamente.

## Rotação e autenticação inter-service

Os tokens opacos não dependem de signing key. A ligação web <-> game-api e SkyMP <-> Master API ainda precisa autenticação de serviço:

- curto prazo: preservar compatibilidade `masterKey`, redigir URL e limitar rede;
- alvo: header autenticado ou mTLS quando o cliente SkyMP permitir;
- requests próprios web/game-api: HMAC/Ed25519 com `keyId`, timestamp, nonce, method, path e body canônico;
- janela de replay de request: no máximo 60 s, nonce único persistido/cacheado no consumidor.

## Redaction

Qualquer chave com `ticket`, `token`, `session`, `authorization`, `masterKey`, `secret` ou `credential` deve virar `[REDACTED]`. Em diagnóstico, permitir apenas prefixo de tipo e um correlation ID separado; nunca últimos caracteres do token.

## Vetores de teste

| Vetor | Resultado esperado |
|---|---|
| prefixo desconhecido | reject antes do DB |
| token curto/Unicode/base64 inválido | reject antes do DB |
| hash desconhecido | 404/unauthorized uniforme |
| audience trocada | reject |
| expirado/revogado | reject |
| dois consumidores do mesmo launch grant | exatamente um sucesso |
| retry do queue grant antigo após rotação | reject; novo continua válido |
| duas resoluções de game session | ambas mesma account/character; contador +2 |
| client envia accountId/characterId diferente | campos ignorados/rejeitados; registro vence |
| DB indisponível | deny; nunca fallback offline |
| token aparece em exceção/log | teste falha |
| character bind para personagem de outra conta | rollback/reject |

## Decisões pendentes para Claude

1. Queue grant precisa persistência MariaDB ou um store efêmero compartilhado é suficiente para a topologia inicial?
2. Game session de 8 h deve ter limite absoluto menor/maior e política explícita de renovação?
3. É viável remover `masterKey` da URL sem alterar upstream, ou devemos apenas isolar/redigir?
4. O bind de character deve acontecer antes da fila ou após admissão?

## Critério de aprovação

AUTH-003 só começa após resposta às quatro decisões, revisão do threat model e aceitação dos vetores de concorrência/replay.
