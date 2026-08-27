# Plano de implementação — Ecossistema de Trabalho e Profissões

**Data:** 25/08/2026 · **Atualizado:** 26/08/2026 · **Estado:** fundação e
Public Work genérico implementados em LAB; conteúdo real e homologação
pendentes · **Escopo:** interação por E, trabalhos públicos, profissões,
crafting profissional e desativação segura do legado `jobs-service`.

## 1. Resultado esperado

Entregar um fluxo jogável e verificável no qual:

```text
personagem entra
  → encontra alvo físico
  → recebe prompt contextual
  → usa E
  → servidor resolve e valida
  → atividade progride em estado persistente
  → inventário/economia confirmam a transação
  → UI e mundo recebem o resultado
```

O primeiro corte completo inclui:

- Minerador profissional sobre Resource Nodes;
- crafting com gate de profissão/rank e estação física;
- Public Work `hay_delivery` e `firewood_delivery`;
- ficha `/profissoes` e ciclo administrativo já existente;
- Contracts preservado como domínio separado;
- remoção de `/cortarlenha` como gameplay principal após equivalência.

Não promete implementar os loops das treze profissões na mesma entrega. Cada
profissão só sai de catálogo quando possui alvo/conteúdo real, autoridade de
servidor, transação e teste in-game.

## 2. Baseline verificada em 26/08/2026

### Código e testes

- suíte completa atual: **1.262 testes, 1.261 aprovados e 1 falha conhecida**
  (`work` ausente da allowlist de Safe Zones);
- typecheck do gamemode aprovado;
- schema declarado pelas migrations: **80 tabelas**, até **v29**;
- config doctor local: aprovado;
- artefato SkyMP, cinco ESMs, dependências e configs locais presentes;
- TCP 3000 e UDP 7777 abriram no boot de 15 segundos;
- o perfil local liga `interaction-prompt`, `mining` e `crafting`;
- o perfil local desliga o legado `jobs-service`;
- Public Work está registrado, mas a flag não está ativa e não existe arquivo
  local de rotas com FormDesc reais.

### Bloqueadores observados

- MariaDB local recusou conexão em `127.0.0.1:3306`;
- governance falhou por banco, derrubando player-panel e market-stalls;
- Master API local em `127.0.0.1:3001` não estava ativa;
- `public-work-service.js`, `core/public-work-*` e migration v29 existem, mas
  ainda não foram exercitados em MariaDB real;
- o prompt local foi migrado para `crosshairRefChanged` e a execução para o
  barramento nativo `mp.onActivate`; a homologação com clientes reais falta;
- nenhum alvo físico deste ecossistema foi homologado com clientes reais.
- `mining.mine` ainda não restringe nós ao tipo `ORE`;
- Minerador aceita subir sem `interaction-prompt`, embora não tenha comando;
- o Depot registra provider de anchor sem atualizar o snapshot usado pelo E;
- replays terminais de Public Work podem produzir confirmação visual obsoleta;
- eventos de expiração de Public Work gravam `character_id = NULL`.

Conclusão: flags ligadas não significam fluxo ativado. O boot prova composição
do processo; não prova banco, E, CEF, Papyrus, inventário ou multiplayer.

## 3. Princípios de execução

1. uma única rota de interação econômica por E;
2. `mp.onActivate` possui um único dono e múltiplos assinantes nomeados;
3. cliente envia intenção; servidor decide alvo, alcance, estado e resultado;
4. Public Work nunca produz recurso primário nem XP profissional;
5. profissão só é marcada `gameplayImplemented` após conteúdo e homologação;
6. toda entrega econômica passa por transação/ledger;
7. nenhum módulo é promovido de LAB apenas porque os testes unitários passam;
8. produção permanece fail-closed enquanto staging não produzir evidência.

## 4. Fases de implementação

### Fase W0 — ambiente e baseline

- [x] inventariar módulos e flags locais;
- [x] executar suíte completa;
- [x] executar config doctor;
- [x] executar boot rápido e verificar portas;
- [ ] iniciar MariaDB e aplicar/verificar migrations;
- [ ] iniciar Master API/serviços necessários para login local;
- [ ] obter boot sem módulo com falha;
- [ ] salvar evidência de versão do binário e schema.

**Gate:** banco conectado, schema sem drift e module registry com zero falhas.

### Fase W1 — fundação de interação nativa

- [x] criar `core/activation-events.js` como dono único de `mp.onActivate`;
- [x] cobrir múltiplos assinantes, isolamento de erro, duplicata e retorno
  agregado `false`;
- [x] trocar polling da mira por `crosshairRefChanged`;
- [x] manter snapshot inicial e limpeza em menus/desconexão;
- [x] separar prompt (`crosshairRefChanged`) de execução (`onActivate`);
- [x] criar índice síncrono de anchors consumíveis;
- [x] remover a segunda captura de E pelo `buttonEvent` do event source;
- [ ] atualizar o snapshot de anchors no boot do Depot quando ele for o único
  provider físico ativo;
- [ ] homologar o bloqueio vanilla e ausência de dupla execução no jogo.

**Gate:** testes automatizados + sessão provando que uma ativação consumida
bloqueia vanilla e uma não consumida continua vanilla.

### Fase W2 — Minerador ponta a ponta

- [x] carregar nós ativos no índice físico durante inicialização;
- [x] rotear o Minerador pelo assinante único do Interaction Framework;
- [x] revalidar alvo pelo Interaction Framework no código e em testes;
- [ ] exigir `interaction-prompt` como dependência operacional do Minerador;
- [ ] restringir descoberta e consumo do Minerador a Resource Nodes `ORE`;
- [ ] confirmar `locationalData` e alcance no servidor real;
- [ ] confirmar ferramenta sem depender de resultado forjado pelo cliente;
- [ ] confirmar consumo, cooldown, capacidade, inventário e XP numa transação
  coerente;
- [ ] testar A/B/C e target distante no mesmo worldspace;
- [ ] testar disconnect/reconnect e duplo E.

**Gate:** pedra sob a mira é a única consumida; recompensa e XP ocorrem uma vez.

### Fase W3 — crafting profissional físico

- [ ] confirmar FormIDs das estações autorizadas;
- [x] tornar estação física obrigatória no execute no caminho de interação;
- [x] validar profissão/rank, ingredientes e resultado novamente no servidor;
- [ ] revisar recipes reais e remover placeholders;
- [ ] confirmar Fundidor e Curtidor com pelo menos uma receita válida cada;
- [ ] manter Ferreiro/Encantador/Cozinheiro como catálogo até receita real;
- [ ] provar assinatura do artesão quando aplicável.

**Gate:** craft remoto/sem estação/sem profissão falha sem consumir ou criar item.

### Fase W4 — Public Work MVP

- [x] criar registry fechado de trabalhos e anchors;
- [x] criar migration `public_work_runs` + eventos/cooldown conforme desenho
  transacional final;
- [x] implementar estados `assigned`, `in_progress`, `completed`, `cancelled`
  e `expired`;
- [x] impedir mais de uma corrida ativa por personagem com lock/constraint;
- [x] implementar aceite, coleta, entrega, cancelamento e expiração idempotentes;
- [x] registrar interações genéricas de quadro, origem e destino;
- [ ] implementar `hay_delivery`;
- [ ] implementar `firewood_delivery` com carga preparada, nunca corte de árvore;
- [x] pagar via boundary econômico e ledger por `run_id`;
- [x] adicionar métricas e auditoria sem dados sensíveis;
- [ ] corrigir replays de runs terminais e atribuição de `character_id` nas
  expirações antes de homologar;
- [ ] executar concorrência/retry/restart contra MariaDB real.

**Gate:** duas rotas completas por E, restart/reconnect preservados e nenhum
pagamento duplicado sob retry/concorrência.

### Fase W5 — retirada do legado

- [x] desabilitar `ENABLE_JOBS_SERVICE` no perfil local;
- [ ] remover `/cortarlenha` da lista de comandos de jogador;
- [ ] manter funções antigas apenas durante janela curta de rollback;
- [ ] provar que nenhuma flag, descriptor ou documentação ainda recomenda
  coleta econômica por comando;
- [ ] remover definitivamente o legado em mudança dedicada.

**Gate:** toda atividade suportada possui substituto físico e auditável.

### Fase W6 — expansão profissional

Ordem proposta após o MVP:

1. Lenhador profissional;
2. Caçador, depois do censo de fauna/cadáver;
3. Fazendeiro;
4. Cozinheiro/Taberneiro;
5. Tratador de Cavalos, depois da base de montarias;
6. Mensageiro integrado a cartas/contratos;
7. Ferreiro e Encantador com conteúdo real;
8. Specialization somente após dois loops profissionais precisarem dela.

Cada item é uma entrega independente. Catálogo não será apresentado como
gameplay pronto.

## 5. Matriz de ativação

| Camada | Local | Staging | Produção |
|---|---|---|---|
| Profession Core | ligado; banco ausente impede validação | após teste administrativo | após auditoria e rollback |
| Interaction Prompt | ligado; código por mira exata | após teste E/CEF | após três clientes e assinatura JS |
| Minerador | ligado; corrigir filtro ORE/dependência e homologar | após nós seedados | após concorrência/economia |
| Crafting | ligado; conteúdo real pendente | receitas e estações validadas | após teste de conservação |
| Public Work | desligado; código genérico pronto, sem rotas reais | após MariaDB + restart/reconnect | após métricas e balanceamento |
| Contracts | pode permanecer em LAB separado | homologação própria | não bloqueia Public Work |
| Jobs legado | desligado no perfil local; código mantido para rollback | desligado | removido |

## 6. Testes obrigatórios por promoção

### Automatizados

- unitários de máquina de estados e registries;
- integração de serviço com DB mockado para contratos de query;
- integração MariaDB real para locks, unique keys e rollback;
- boot com todas as combinações de dependência relevantes;
- schema drift e config doctor;
- suíte completa e typecheck.

### In-game

- E em alvo válido, inválido, vazio e alterado;
- B mais próximo/C sob a mira;
- alvo distante na mesma worldspace;
- ferramenta ausente/trocada durante ação;
- dois jogadores no mesmo nó/origem/destino;
- duplo E e replay de pacote;
- disconnect, reconnect e restart em cada estado;
- CEF fechada/menu vanilla aberto;
- inventário e ledger antes/depois;
- cliente que não executa event source.

## 7. Definition of Done

Um fluxo só está ativado quando:

- o módulo sobe sem falha e suas dependências estão ativas;
- banco e schema reais foram verificados;
- o jogador não precisa de comando para executar o loop principal;
- alvo e distância são revalidados no servidor;
- recompensa e consumo são atômicos e idempotentes;
- reconnect/restart têm comportamento definido;
- teste com múltiplos clientes produziu evidência;
- existe flag de rollback e documentação operacional;
- a equipe consegue distinguir claramente LAB, staging e produção.
