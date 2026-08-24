# Baseline de observabilidade — 24/08/2026

Inventário do que o projeto consegue explicar hoje sem depender de MariaDB,
Skyrim ou serviços externos. Este documento é a evidência inicial de `F8-002`;
não declara o gate concluído.

## Cobertura existente

| Sinal mínimo | Existe hoje | Onde aparece | Lacuna operacional |
|---|---|---|---|
| Conexões | **Parcial** | `connection-monitor.js` registra conexão, associação ao `profileId`, rejeição e desconexão. | Só texto; não há contadores, duração de sessão nem endpoint. |
| Falhas de login | **Parcial** | Master API registra chave inválida e erros; launcher mostra as falhas ao jogador. | Não há total por causa nem correlação launcher→Master API→game-api. |
| Latência DB | **Sim, por serviço** | O wrapper compartilhado mede sucesso/erro em buckets fixos no painel e na Game API. | Ainda falta collector/retenção e instrumentar o gamemode. |
| Eventos CEF | **Sim, local** | `ui-event-rate-limiter.snapshot()` conta observados/rejeitados por tipo e o bootstrap publica JSON a cada 60 s, sem payload. | Métrica fica só no stdout e reinicia com o processo. |
| Rejeições | **Parcial** | Guards de autenticação/segredo e rate limits incrementam motivos enumerados. | Ainda falta cobrir as recusas de domínio no gamemode e na fila. |
| Transferências | **Parcial** | `transaction-service` e `inventory` registram sucesso, replay e falha; o ledger durável fica no banco. | Sem taxa/latência agregada nem alerta de falha. |
| Reconciliações | **Parcial** | Existem rotinas de economia/estado físico e `healthCheck()`. | Execuções e divergências não são agregadas. |
| Polling | **Não medido** | Intervalos existem em conexão, morte, painel, interação e atalhos. | Não há duração de tick, atraso ou sobreposição. |
| CPU e memória | **Sim nos serviços Node** | Snapshots internos incluem CPU acumulada, RSS, heap e memória externa; SkyMP declara `mp.getPrometheusMetrics()`. | Ainda falta gamemode, collector e histórico. |
| Fila | **Sim, efêmero** | `GET /health` da Game API expõe capacidade, ocupados, conectados e espera. | Sem histórico, alertas ou persistência após restart. |
| Saúde de módulos | **Local** | `module-registry.healthCheckAll()` isola falhas de módulos ativos. | Resultado não é publicado nem acompanhado. |

## Princípios para a implementação

1. Métricas não podem carregar ticket, session token, secret, texto de chat,
   payload CEF, motivo livre ou identificador pessoal.
2. Métricas internas não devem ficar em endpoint público sem autenticação.
3. Nomes e labels precisam ter cardinalidade limitada; nunca usar IP, actorId,
   accountId, rota dinâmica ou mensagem de erro como label.
4. Logs devem preservar o prefixo estável do componente e incluir um
   `requestId` opaco quando uma operação cruza serviços.
5. Métrica em memória serve a uma instância; produção precisa de scrape ou
   envio externo para sobreviver a restart.

## Próximas entregas executáveis

### O1 — Instrumentação HTTP (`IMPLEMENTADO`, sem collector)

- [x] contadores por serviço, rota normalizada e classe de status;
- [x] duração em buckets fixos;
- [x] contadores de rate limit e autenticação recusada;
- [x] endpoint interno protegido por `X-Internal-Secret` na Game API e no bot;
- [x] endpoint staff-only no painel;
- [x] `X-Request-Id` validado/gerado e propagado do painel para o bot;
- [ ] collector, retenção e alertas.

Endpoints:

- painel: `GET /api/metrics` (sessão com papel de staff);
- Game API: `GET /internal/metrics` (`X-Internal-Secret`);
- bot: `GET /api/metrics` (`X-Internal-Secret`, API presa a `127.0.0.1`).

O snapshot não contém SQL, parâmetros, IP, accountId, actorId, ticket, token,
payload CEF ou texto livre. Séries têm cardinalidade limitada e rotas dinâmicas
usam o template Express (`/recurso/:id`), nunca a URL concreta.

### O2 — Banco e fluxo de login (`PARCIAL`)

- [x] medir duração e erro nos wrappers de consulta do painel/Game API, sem registrar SQL/params;
- [ ] propagar `requestId` desde o launcher para OAuth, fila e Master API;
- contar falha por causa enumerada (`invalid_ticket`, `not_whitelisted`, etc.).

### O3 — Gamemode e processo

- publicar `healthCheckAll()`, eventos CEF, conexões e reconciliações;
- integrar, quando disponível no artefato pinado, `getPrometheusMetrics()`;
- medir duração/overlap dos pollers e CPU/RSS do processo.

### O4 — Operação

- escolher coletor, retenção e alertas;
- dashboard mínimo de login, fila, DB, CEF, transferências e recursos;
- executar incidente controlado e provar diagnóstico sem reprodução local.

`F8-002` só pode ser concluído depois de O1–O4 e do exercício de incidente.
