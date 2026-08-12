# TASK-006 - Idempotencia da compra em barracas

**Status:** implementada e validada localmente  
**Dono sugerido:** Economy / Core  
**Ultima atualizacao:** 2026-08-11

## Problema

`market-stalls-service` ja fazia a compra inteira em uma transacao, mas criava
um UUID novo a cada chamada. Um retry da UI apos perda de resposta era outra
compra: podia debitar ouro e entregar o mesmo anuncio duas vezes.

## Entrega

- A UI pode encaminhar `requestId` em `governance:interaction:execute` para
  `stall.buy`; a fronteira rejeita ID curto, longo ou nao textual e item/quantidade
  com conversao parcial.
- `buyItem` aceita esse ID, cria UUID apenas para os comandos legados e registra
  a chave em `market_stall_sales`.
- A migration v13 cria `idempotency_key` unica no historico de vendas.
- A mesma chave e lida com `FOR UPDATE` dentro da transacao; retry confirmado
  retorna a venda original sem ouro, inventario, estoque, ledger ou efeito
  Papyrus adicional.
- O rate limit permite somente o replay da mesma chave durante a janela de dois
  segundos; novas chaves continuam limitadas normalmente.

## Verificacao

- Teste de regressao repete uma compra com o mesmo `requestId` e prova que ha
  apenas um historico, dois lancamentos de ouro (as duas pontas da unica venda)
  e um lancamento de inventario.
- A migration v13 foi incorporada ao schema versionado. Em 11/08/2026, a suíte
  completa do gamemode passou com **547 testes e zero falhas**. A homologação
  concorrente com dois clientes reais continua pendente.

## Proximo passo

Homologar com dois clientes reais: repetir o mesmo clique e disparar dois
cliques com IDs diferentes sobre a ultima unidade. A segunda situacao deve
produzir uma compra e uma recusa por estoque, sem saldo parcial.
