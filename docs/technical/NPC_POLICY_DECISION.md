# Decisao Tecnica Sobre NPCs

> **Estado do codigo (06/08/2026): a Opcao C passou a ser o que o
> `npc-cleaner.js` faz.** Ate esta data o servico implementava a **Opcao B na
> forma mais extrema**: varria `mp.getActorsByProfileId(0)` e chamava
> `disable` + `delete` em todo ator encontrado, pulando apenas os de uma
> allowlist — que estava vazia. Ou seja, apagava mercadores, guardas e NPCs de
> quest a cada 60 segundos, e `delete` numa referencia persistente nao volta.
>
> O que mudou:
>
> - **A lista virou de bloqueio, nao de permissao.** So sai do mundo o que
>   estiver listado; lista vazia nao remove nada. O modo de falha aponta pro
>   lado seguro.
> - **`safeRadius` passou a existir.** Era declarado no config com o comentario
>   "limpa apenas NPCs longe dos players" e nunca era lido — o comentario
>   descrevia um recurso que nao estava escrito.
> - **`delete` saiu.** So `disable`, que e reversivel. Enquanto a curadoria da
>   secao 4 abaixo nao existir, nada aqui deve ser irreversivel.
>
> A lista vive em `skymp/config/npc-policy.json` (modelo em
> `npc-policy.example.json`) e guarda `baseDesc` (`"1a6a0:Skyrim.esm"`), nunca
> FormID numerico — ver o contrato de FormID em
> [MODS_AND_GAMEMODE_CONTRACT.md](MODS_AND_GAMEMODE_CONTRACT.md) secao 3.
>
> **A secao 4 continua pendente**: as listas de permitidos e bloqueados ainda
> nao foram curadas. Ate la o servico e inerte por construcao, mesmo com
> `ENABLE_NPC_CLEANER=true`.

## 1. Problema

Um servidor Heavy RP publico precisa decidir como lidar com NPCs vanilla, porque NPCs afetam performance, imersao, economia, lei, combate e papel dos jogadores.

## 2. Opcoes

### Opcao A - Vanilla Spawn Ligado

NPCs vanilla aparecem de forma ampla.

Vantagens:

- Mundo parece cheio desde o inicio.
- Menor necessidade de jogadores cobrirem todos os papeis.
- Facilita testes iniciais.

Riscos:

- Pode quebrar Heavy RP quando NPCs interferem em cenas.
- Pode gerar exploits de loot, combate e economia.
- Pode piorar performance.
- Pode competir com papeis que deveriam ser de jogadores.

### Opcao B - Vanilla Spawn Desligado

NPCs vanilla ficam removidos ou fortemente desabilitados.

Vantagens:

- Mais controle narrativo.
- Jogadores ocupam papeis sociais.
- Menos variaveis de combate/loot.
- Melhor para RP publico inspirado em mundos player-driven.

Riscos:

- Mundo pode parecer vazio no inicio.
- Exige staff/eventos e sistemas de profissao mais cedo.
- Novos jogadores podem sentir falta de direcao.

### Opcao C - Vanilla Spawn Seletivo

NPCs essenciais ou decorativos permanecem; NPCs de risco sao removidos ou controlados.

Vantagens:

- Melhor equilibrio para MVP.
- Mantem vida no mundo sem abrir todos os riscos.
- Permite remover spawns problematicos por ID/local.
- Facilita migrar para mundo mais player-driven com o tempo.

Riscos:

- Exige curadoria.
- Pode ter inconsistencias entre regioes.
- Precisa de testes recorrentes.

## 3. Decisao Recomendada para MVP

Usar **Vanilla Spawn Seletivo**.

Motivo:

- Heavy RP precisa de controle, mas o servidor no inicio nao tera jogadores suficientes para substituir toda a vida do mundo.
- NPCs devem existir onde ajudam ambientacao e onboarding.
- NPCs que geram loot, combate repetitivo, quest bugada ou conflito com papeis de jogadores devem ser removidos, congelados ou substituidos.

## 4. Regra de Producao

Antes da beta publica:

- Criar lista de NPCs permitidos.
- Criar lista de NPCs bloqueados.
- Criar politica de respawn.
- Testar impacto em performance.
- Testar impacto em economia.
- Documentar locais com maior risco.

## 5. Pontos de Decisao

- Guardas vanilla ficam ativos ou guardas serao apenas jogadores?
- Mercadores vanilla vendem itens ou apenas servem ambientacao?
- Criaturas selvagens ficam ativas para cacadores?
- NPCs de quest vanilla ficam desativados?
- Containers vanilla resetam ou ficam bloqueados?
- Respawn de NPC deve ser global, por tipo ou por ID?
