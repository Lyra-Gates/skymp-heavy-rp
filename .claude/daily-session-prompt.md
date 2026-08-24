Você está numa sessão diária automática, sem o usuário por perto. Ninguém vai
responder perguntas nem aprovar nada durante esta sessão — não pergunte, decida
dentro dos limites abaixo ou pare e registre o motivo.

## O que fazer

1. Releia a memória do projeto (MEMORY.md e os arquivos linkados) para entender
   o estado atual: o que já foi reativado, o que está PARKED, quais ADRs estão
   congeladas, o que ficou combinado nas últimas sessões.
2. Escolha UM item concreto que já está em andamento ou já foi decidido nas
   memórias/ADRs (ex: um passo do plano de reativação de PARKED, um teste de
   characterization faltando, um TODO deixado explícito numa sessão anterior).
   Não invente escopo novo nem decida arquitetura — se o próximo passo depende
   de uma decisão do dono do produto que ainda não foi tomada, não escolha esse
   item.
3. Trabalhe nesse item: edite código, rode os testes relevantes, confira
   contra as convenções do projeto (mutação obrigatória, FormDesc como string
   "célula:base", patrimônio só via transaction-service, etc — ver
   skymp-convencoes-de-rigor na memória).
4. NÃO rode `git commit`, `git push`, `git reset --hard`, `git clean`,
   `git branch -D` nem `rm -rf`. Essas ações estão bloqueadas em
   `.claude/settings.json` (deny de projeto, tem precedência sobre qualquer
   allow global) — mas não tente contornar isso de propósito nenhuma. Deixe o
   trabalho em arquivos modificados/não commitados para o usuário revisar.

## Lista de veto (nunca fazer, mesmo que pareça o próximo passo óbvio)

- Qualquer afirmação sobre `schema.sql`/migrations sem rodar
  `check:schema:list` antes.
- Confiar em teste que usa `mp` mockado como se validasse comportamento real.
- Decidir arquitetura do ecossistema de trabalho (Employment vs Public Work vs
  Business) — já está congelada em ADR.
- Afirmar que algo funciona no cliente/runtime do SkyMP sem ter rodado de
  verdade — várias correções recentes (ex: BOUND-004) não foram validadas em
  runtime real.

## Ao terminar (sempre, mesmo se não fez nada)

Escreva um resumo em
`.claude/daily-logs/AAAA-MM-DD.md` (data de hoje) com:

- Qual item você escolheu e por quê (ou por que não achou nenhum item seguro
  para tocar sozinho).
- O que foi alterado (lista de arquivos) e o resultado dos testes rodados.
- O que ficou pela metade ou bloqueado, e o que falta para o usuário decidir
  antes da próxima sessão automática.

Não commite esse log nem o resto do trabalho — ele fica como arquivo não
rastreado/modificado para o usuário revisar manualmente.
