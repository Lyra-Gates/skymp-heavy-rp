# Parecer de prontidão — 24/08/2026

> **Revalidado localmente em 26/08/2026.** A decisão NO-GO permanece. O
> gamemode agora possui 1.262 testes, todos aprovados,
> migration v29 e 80 tabelas declaradas. MariaDB e clientes reais continuam
> indisponíveis; portanto nenhum gate de promoção foi fechado.

## Decisão atual: NO-GO para produção/alfa pública

O repositório tem uma base automatizada forte e os trabalhos possíveis sem
MariaDB foram executados, mas não existe evidência suficiente para promover o
sistema. Esta decisão é baseada nos gates, não em percepção de acabamento.

## Bloqueios externos obrigatórios

| Bloqueio | Evidência necessária para fechar |
|---|---|
| MariaDB/staging indisponível | migrations até v29 aplicadas, schema drift limpo, concorrência e restart |
| clientes Skyrim reais | dois clientes por 30 min; CEF, `[E]`, Papyrus e reconexão |
| conteúdo físico | FormDescs de nó/depot/estações e receita de Ferreiro confirmados |
| distribuição | segunda instalação limpa, manifesto e launcher end-to-end |
| assinatura | instalador com assinatura/timestamp válidos e SmartScreen registrado |
| operação | responsáveis, canal, janela, backup e rollback exercitado |
| capacidade | soak de 6–8h com 5–10 jogadores e relatório |
| alfa | duas semanas com 10–20 convidados e sem perda de dados |

## Decisão de produto pendente

F6-003 não deve ser implementada por adivinhação: “rank acessa recurso raro” no
Depot pode significar capacidade, depósito, retirada, aba ou estoque
institucional. Bloquear retirada do minério raro impediria a cooperação com o
Fundidor. O dono de produto precisa definir a regra e os atores autorizados.

## Evidência automatizada disponível

- gamemode: 1.262 testes, todos aprovados, e typecheck limpo;
- migration dry-run: 27 arquivos, 162 instruções, até v29;
- schema declarado: 80 tabelas;
- registry: 76 testes listados, sem órfãos;
- write guards: nenhuma armadilha conhecida;
- runner de soak: testes unitários e relatório JSON, aguardando staging;
- backup, restore, rollback, staging e auditor de configuração já versionados.
- launcher: bootstrap fail-closed coberto por 15 testes novos, suíte 85/85,
  typecheck/lint aprovados e instalador NSIS gerado; handshake com dois clientes
  ainda pendente conforme
  [`ADR-012`](../technical/ADR_012_LAUNCHER_CONNECTION_BOOTSTRAP.md).

O documento vivo de execução continua sendo
[`PRODUCTION_READINESS_ACTION_PLAN.md`](../roadmap/PRODUCTION_READINESS_ACTION_PLAN.md).
O próximo operador deve começar pelos bloqueios acima, não reabrir tarefas já
concluídas no código sem uma regressão observada.
