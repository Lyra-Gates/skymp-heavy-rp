# TASK-004 - Fronteira transacional da economia regional

**Status:** fronteiras atomicas implementadas; modulo regional ainda PARKED  
**Dono sugerido:** Economy / Database  
**Ultima atualizacao:** 2026-08-11

## Por que esta tarefa existe

`economy-regional.js` nao esta ativado no boot Fase 0, e isto e correto. A
rotina de saque do tesouro do Hold remove ouro de `holds` e depois adiciona em
`factions` usando duas queries independentes. Uma queda entre elas deixa os
tesouros divergentes. Alem disso, o arquivo referencia `governance.getMembership`
e `factionInfo` de modo que hoje produz tres erros no typecheck.

O modulo tambem mistura movimentacao de inventario, ouro do personagem,
estoque e imposto em operacoes sem uma fronteira transacional unica. Corrigir
somente os tres erros e liga-lo seria uma regressao de seguranca economica.

## Entrega implementada em 2026-08-11

O saque Hold -> Faccao agora passa por
`core/institutional-treasury-service.js` e pela migration v11:

- bloqueia a linha do Hold com `SELECT ... FOR UPDATE`;
- consulta o cargo de lorde pela mesma conexao da transacao;
- debita com condicao `treasury >= amount`, credita a faccao regente e grava o
  ledger `institutional_treasury_transactions` antes do commit;
- usa `idempotency_key` unica para replay nao mover ouro duas vezes;
- faz rollback se credito ou ledger falhar; cache e notificacao ocorrem apenas
  depois do commit;
- valida inteiro seguro positivo, sem `parseInt` frouxo.

Foram adicionados cinco testes cobrindo sucesso, saldo concorrente insuficiente,
replay, falha depois do debito e entrada malformada. A migration v11 foi
aplicada ao banco local e `npm run check:schema` confirmou alinhamento.

## Entrega implementada em 2026-08-11 — mercado regional

As operacoes `sellToMarket` e `buyFromMarket` agora delegam ao
`core/regional-market-transaction-service.js`, apoiado pela migration v12:

- uma unica transacao bloqueia o preco/estoque, inventario do personagem e
  ouro antes de movimentar qualquer valor;
- compra debita ouro, entrega item, reduz estoque e grava os dois ledgers mais
  o registro de mercado antes do mesmo commit;
- venda remove item, credita ouro liquido, credita o imposto ao Hold, aumenta
  estoque e grava os tres registros antes do mesmo commit;
- `regional_market_transactions.idempotency_key` e unica: o mesmo `requestId`
  devolve o resultado confirmado sem movimentar saldo ou item pela segunda vez;
- cliente, cache e notificacao so sao atualizados depois de `COMMIT`;
- a entrada da UI deixou de aceitar `parseInt` parcial: FormID e quantidade
  devem ser inteiros positivos completos, com quantidade maxima de 100.

Cinco testes dedicados cobrem compra, rollback de debito, venda com imposto,
replay sem estoque e limite de tamanho da chave. A suite completa passou com
529 testes e o typecheck permaneceu limpo. A migration v12 tambem foi aplicada
ao banco local e `npm run check:schema` confirmou o alinhamento.

## Resultado esperado

Uma transferencia de tesouro deve terminar integralmente ou nao alterar nada:

1. abrir conexao e iniciar transacao;
2. ler e bloquear a linha do Hold com `SELECT ... FOR UPDATE`;
3. confirmar a associacao do lorde e a permissao no servidor;
4. debitar o Hold com condicao `treasury >= amount`;
5. creditar a faccao correta, usando o `ruling_faction_id` do Hold;
6. gravar ledger/auditoria com actor, origem, destino, valor e `requestId`;
7. commit; em qualquer falha, rollback e nenhuma notificacao de sucesso;
8. somente apos commit, atualizar cache e avisar o jogador.

## Criterios de aceite

- Dois saques concorrentes nunca podem consumir mais que o saldo do Hold.
- Falha forjada depois do debito produz rollback e saldos inalterados.
- Faccao de destino vem da linha bloqueada, nao de estado/cache do cliente.
- Valor aceita apenas inteiro seguro positivo.
- Um mesmo `requestId` nao executa duas vezes.
- O ledger permite reconstituir toda transferencia sem depender de logs.
- Testes unitarios simulam begin, commit, rollback e liberacao da conexao.
- O typecheck fica limpo para este modulo antes de ele sair de PARKED. **Feito**.

## Fora de escopo desta tarefa

- Ativar a economia regional no boot antes dos criterios acima.
- Alterar saldo diretamente por comando de staff sem trilha de auditoria.

## Dependencias

- API de transacao do `database` exposta e testavel. **Atendida.**
- Interface de membership da governanca estavel. **Atendida.**
- Ledger institucional proprio. **Atendido pela migration v11.**
- Ledger do mercado regional. **Atendido pela migration v12.**
- Revisao de concorrencia em MySQL/InnoDB no ambiente de homologacao. **Pendente
  com jogadores reais.**

## Proxima fatia

Executar homologacao MySQL/InnoDB concorrente (duas compras do ultimo estoque,
dois saques do mesmo tesouro e replay real da UI) e so entao propor um
descriptor completo do modulo no `core/module-registry.js`. O modulo continua
PARKED ate essa decisao: esta entrega elimina as fronteiras transacionais
inseguras, mas nao ativa um sistema sem ciclo de vida, comandos e shutdown
revisados.
