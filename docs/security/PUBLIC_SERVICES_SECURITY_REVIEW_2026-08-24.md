# Revisão de segurança dos serviços públicos — 24/08/2026

Escopo do item `F8-001`: `apps/web`, `apps/game-api`, a API local de
`apps/bot-discord` e os contratos consumidos pelo launcher. Esta rodada foi
feita sem MariaDB; ela cobre inspeção estática e testes com os doubles já
existentes, não substitui teste integrado em staging.

## Resultado desta rodada

| Superfície | Estado | Evidência |
|---|---|---|
| Rate limits | **Corrigido localmente** | Os três serviços agora limitam tanto o número de buckets (10.000) quanto o contador de uma origem. 9 testes exercitam janela, cardinalidade adversarial e insistência de uma origem. |
| CORS e proxy | **Revisado** | `apps/web` mantém allowlist em `PANEL_PUBLIC_URL`. `trust proxy` só é ligado por `TRUST_PROXY=true`; `NODE_ENV=production` sozinho não aceita `X-Forwarded-For`. O auditor de produção exige a configuração explícita. |
| Sessão web | **Parcial** | Cookies são `httpOnly`, `sameSite=lax`, `secure` em produção e expiram em 8 h. O `MemoryStore` do `express-session` continua inadequado para múltiplas instâncias/restart (`F2-004`). |
| Segredo interno | **Revisado** | Game API e bot comparam `X-Internal-Secret` em tempo constante; o auditor verifica força e igualdade entre os serviços. A API do bot continua presa em `127.0.0.1`. |
| Entradas e uploads | **Revisado/corrigido** | JSON tem teto de 512 KiB no painel e 64 KiB nas outras APIs; crash reports limitam quantidade/tamanho, sanitizam nomes e têm retenção. `discord_id` agora exige snowflake decimal de 17–20 dígitos. |
| Exposição HTTP | **Corrigido** | Painel, Game API e bot não publicam `X-Powered-By`. |
| Updates | **Revisado** | Manifestos de cliente/modpack falham fechado e exigem SHA-256; a UI embarcada é verificada/reparada antes de jogar. |
| Replay | **Pendente** | Tickets da fila são de uso único por `UPDATE` condicional. A Master API ainda aceita resolver a mesma `game_session` mais de uma vez (`PLAT-15`); mudar isso exige validar o comportamento de reconexão do SkyMP em staging. |

## Modelo e limites do rate limiter

O rate limiter é local a cada processo. Isso protege uma instância contra
crescimento de memória e abuso básico, mas não soma tráfego entre réplicas.
Antes de escalar horizontalmente, mover a contagem para o proxy/edge ou para um
store compartilhado. O teto de buckets impede memory DoS; ao atingir o teto, a
entrada mais antiga é descartada em O(1).

## Pendências para concluir F8-001

1. Trocar o `MemoryStore` de sessão por store persistente e testar restart e
   duas instâncias (`F2-004`, depende de MariaDB/staging).
2. Exercitar replay e reconexão da Master API dentro do jogo antes de tornar
   `game_session` estritamente single-use (`PLAT-15`).
3. Colocar o painel e a Game API atrás de HTTPS/proxy real e validar IP, cookies,
   CORS e limites ponta a ponta.
4. Rodar teste de upload chunked e retenção em staging, incluindo filesystem
   cheio e concorrência de poda.

## Verificação automatizada

- `apps/web`: 51 testes.
- `apps/game-api`: 53 testes.
- `apps/bot-discord`: 45 testes.
- Nenhum dos testes desta rodada exige MariaDB ou Discord reais.
