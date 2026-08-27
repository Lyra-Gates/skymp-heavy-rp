# Sistema de Trabalhos Públicos

**Status:** IMPLEMENTADO EM LAB — desligado localmente e não homologado em
runtime · **Data:** 25/08/2026 · **Conferido contra o código:** 26/08/2026 ·
**Decisão:** [ADR 011](../technical/ADR_011_PUBLIC_WORK.md) ·
**Pesquisa:** [estudo de referência](../research/PUBLIC_WORK_REFERENCE_STUDY_2026-08-25.md)

Para a visão conjunta da jornada do jogador e das fronteiras entre trabalho
livre, profissão, especialização, emprego, negócio, contrato e governança, ver
[Visão do Ecossistema de Trabalho e Profissões](WORK_AND_PROFESSION_ECOSYSTEM_VISION.md).

O domínio, a persistência e o fluxo genérico por interação já existem em
`public-work-service.js`, `core/public-work-*` e
`migration-v29-public-work.sql`. O módulo permanece desligado no perfil local:
`ENABLE_PUBLIC_WORK_SERVICE` não está ativo e ainda não há arquivo de rotas com
FormDesc reais. MariaDB e clientes Skyrim não estavam disponíveis para
homologação nesta revisão; portanto “implementado” aqui significa código e
testes automatizados, não fluxo promovido ou jogável em produção.

## 1. Visão do jogador

Um personagem sem profissão encontra um quadro ou capataz, aproxima-se e usa
**E**. Ele escolhe um serviço simples, pega uma carga física, realiza a rota e
entrega no alvo correto usando **E** novamente.

Não há `/trabalho`, `/pegarcarga` ou `/entregar`. O chat não executa gameplay.

```text
quadro/capataz + E
  → escolher trabalho
  → origem + E
  → transportar/realizar serviço
  → destino + E
  → recompensa e cooldown
```

## 2. Objetivo de produto

Public Work existe para:

- dar uma primeira atividade a personagens novos;
- criar circulação entre locais e encontros de RP;
- oferecer renda mínima quando profissionais estão offline;
- ensinar interação, inventário e economia sem consumir um slot de profissão;
- gerar demanda narrativa por escolta, proteção e comércio.

Não existe para competir com Minerador, Lenhador, Fazendeiro, Caçador ou
artesãos.

## 3. Fronteiras obrigatórias

| Sistema | Public Work não pode fazer |
|---|---|
| Profession | conceder XP, rank, especialização ou recurso primário |
| Contracts | fingir que uma corrida do sistema foi publicada por jogador |
| Employment | criar vínculo permanente com cidade, negócio ou facção |
| Governance | conceder cargo ou autoridade institucional |
| Resource Nodes | consumir nós reservados à coleta profissional no MVP |

Exemplo obrigatório: o trabalho `firewood_delivery` recebe uma carga preparada;
ele nunca chama o corte de árvore do Lenhador.

## 4. Experiência e interação

### 4.1 Descoberta

- Quadro, capataz ou ponto de serviço é um alvo físico.
- O prompt mostra `[E] Ver trabalhos` somente dentro do alcance.
- O menu lista apenas trabalhos disponíveis naquele ponto.
- Indisponibilidade deve explicar cooldown, corrida ativa ou requisito físico
  sem revelar informações sensíveis do servidor.

### 4.2 Aceite

- Aceite cria uma `PublicWorkRun` em `assigned`.
- O servidor escolhe e persiste origem/destino válidos.
- Aceitar duas vezes com o mesmo `request_id` devolve a mesma execução.
- Personagem com corrida ativa não recebe outra.

### 4.3 Coleta da carga

- O jogador usa E na origem correta.
- O servidor revalida personagem, corrida, status, prazo e distância.
- Uma carga/token único é vinculada à execução.
- A corrida passa para `in_progress`.

### 4.4 Entrega

- O jogador usa E no destino correto.
- O servidor não aceita coordenada ou “concluído=true” do cliente como prova.
- Conclusão e pagamento acontecem de forma idempotente e auditável.
- A carga é invalidada e inicia-se o cooldown compartilhado.

### 4.5 Contrato obrigatório de alvo exato

O prompt nasce da referência sob a mira. A proximidade calculada pelo servidor
decide se a ação pode aparecer, mas nunca procura nem escolhe outro alvo. Em
local movimentado, “o mais próximo” pode ser outra pedra, outro jogador ou
outro ponto de entrega e por isso não existe como fallback.

Para qualquer ação de mundo (`quadro`, `origem`, `destino`, nó de recurso,
contêiner ou jogador), vale o contrato abaixo:

1. o cliente lê a referência que está sob a mira com
   `Game.getCurrentCrosshairRef()`;
2. converte o FormID para o formato do servidor antes de enviar;
3. envia somente a intenção e o identificador do alvo — nunca distância,
   permissão, recompensa ou conclusão;
4. o servidor resolve esse FormID contra os anchors registrados;
5. o servidor revalida personagem, célula, distância, estado da corrida e ação
   disponível tanto no `query` quanto no `execute`;
6. se a mira estiver vazia, o alvo tiver mudado ou o FormID não for permitido,
   a ação falha fechada. Não há fallback para “o mais próximo”.

```text
cliente                         servidor
  mira no objeto                  │
  E ── alvo FormID + query ──────►│ resolve + valida
    ◄── ações permitidas ─────────│
  escolhe ação                    │
    ── alvo + action + requestId ►│ resolve novamente
                                  │ valida estado/distância/idempotência
    ◄── resultado/auditoria ──────│ persiste antes de responder
```

O prompt mostrado e o alvo enviado precisam corresponder à mesma referência.
Se isso não puder ser garantido, esconder/cancelar o prompt é mais seguro que
executar uma ação em alvo aproximado.

O MVP implementado não introduziu `interactionContextId`. Ele usa alvo exato,
nova resolução no pipeline `query`/`execute`, distância server-side e
`requestId` idempotente. Um contexto opaco continua como hardening futuro e
jamais substituirá a nova resolução e validação no `execute`.

### 4.6 Ações com duração

Animação e barra de progresso são apresentação. O servidor cria uma sessão com
início e término esperados e decide quando a ação pode concluir. Um
`setInterval`/`setTimeout` no cliente nunca é prova de que mineração, corte,
coleta ou carregamento terminou. Trocar de alvo, sair do alcance, desconectar ou
perder o estado exigido deve cancelar ou suspender conforme regra explícita do
trabalho.

## 5. Catálogo e prioridade

| Ordem | Código | Loop | Risco | MVP |
|---:|---|---|---|---:|
| 1 | `hay_delivery` | fardo A → celeiro B | baixo | sim |
| 2 | `firewood_delivery` | depósito A → destino B | baixo | sim |
| 3 | `courier_run` | carta lacrada A → destinatário B | médio | depois do MVP |
| 4 | `porter` | caixa A → armazém B | baixo | depois do MVP |
| 5 | `stable_supply` | suprimento A → estábulo B | baixo | depois do MVP |
| 6 | `supply_runner` | provisão entre locais públicos | médio | depois do MVP |

Os dois primeiros validam o núcleo sem exigir combate, NPC inteligente,
profissão ou verificação subjetiva.

## 6. Estados e transições

```text
assigned ──coleta──► in_progress ──entrega válida──► completed
    │                    │
    ├──cancelar───────────┴────────────────────────► cancelled
    └──prazo───────────────────────────────────────► expired
```

Regras:

- `completed`, `cancelled` e `expired` são terminais.
- somente `in_progress` pode concluir;
- somente a origem atribuída pode iniciar;
- somente o destino atribuído pode concluir;
- transição inválida falha fechada e não paga;
- toda transição persiste antes de responder sucesso ao cliente.

## 7. Recompensa e economia

Princípios de balanceamento:

- recompensa menor que a renda esperada de um profissional ativo;
- valor base conhecido pelo servidor, nunca informado pelo cliente;
- pequeno ajuste por distância pode existir após medição real;
- sem drop aleatório no MVP;
- sem recompensa em recurso profissional primário;
- sem XP de profissão;
- cooldown aplicado por grupo, não apenas por cidade;
- emissão de moeda registrada no ledger com motivo e `run_id`.

Valores numéricos permanecem **TBD** até haver relatório econômico e sessão com
três clientes. O valor do Keizaal é evidência de baixo pagamento, não parâmetro
copiado automaticamente.

## 8. Persistência implementada

`migration-v29-public-work.sql` cria quatro tabelas:

- `public_work_runs`: snapshot da rota, recompensa, cooldown, estado, carga,
  três request IDs independentes e timestamps;
- `public_work_active_slots`: chave primária por `character_id`, garantia
  material de uma única execução ativa;
- `public_work_cooldowns`: cooldown compartilhado por personagem e grupo;
- `public_work_events`: trilha das transições.

Aceite, coleta, entrega, cancelamento e expiração usam transações e locks. Os
request IDs possuem índices únicos; o pagamento e o ledger são gravados na
mesma transação da conclusão. A migration está apenas versionada: ainda não foi
aplicada nem exercitada contra MariaDB real nesta máquina.

## 9. Arquitetura de módulo

Módulo implementado: `public-work-service.js`, registrado em `phase0-basic.js`
atrás de `ENABLE_PUBLIC_WORK_SERVICE=false` por padrão.

Dependências obrigatórias registradas:

- `interaction`;
- `interaction-prompt`;
- transaction/economy boundary e banco, consumidos pelo serviço.

O módulo registra suas próprias interações. Não alterar o Interaction Framework
para ensinar regras de trabalho público ao core.

`jobs-service.js` permanece como legado de caracterização durante a migração. O
novo serviço não chama `chopWood`, `mineOre` ou `catchFish`. Após equivalência e
teste in-game, `/cortarlenha` é removido do caminho de jogador.

## 10. Segurança e anti-exploit

| Ameaça | Controle obrigatório |
|---|---|
| concluir sem pegar carga | status + `cargo_token` |
| concluir no destino errado | destino resolvido e distância no servidor |
| duplo clique/retry | `request_id` + pagamento idempotente |
| duas corridas simultâneas | lock/constraint por personagem |
| reutilizar carga antiga | token invalidado em estado terminal |
| trocar/vender carga | item vinculado ou token não transferível |
| desconectar para resetar | execução persistente |
| trocar de cidade para burlar espera | cooldown por grupo compartilhado |
| cliente forjar recompensa | definição e snapshot do servidor |
| spam de interação | rate limit do Interaction Framework |
| E atuar no alvo errado em área cheia | FormID sob a mira + resolução exata; nunca nearest-target no execute |
| trocar o alvo entre menu e execução | re-resolução no execute; `interactionContextId` se aprovado no PW0 |
| concluir timer acelerando a UI | sessão e relógio autoritativos no servidor |

## 11. Roadmap de implementação

### Fase PW0 — preparação documental

- [x] Taxonomia e ADR.
- [x] Estudo Keizaal e similares.
- [x] Fluxo, estados e fronteiras.
- [ ] Confirmar no mapa um quadro, duas origens e dois destinos com FormIDs.
- [x] Adotar token persistente server-side no MVP; item físico transferível
  permanece fora do corte atual.
- [x] Criar adaptador compartilhado com `Game.getCurrentCrosshairRef()`,
  conversão de FormID e classificação server-side do tipo.
- [ ] Homologar esse adaptador na versão de SkyMP usada pelo projeto.
- [x] Confirmar no fonte que `crosshairRefChanged` entrega a referência exata e
  que E chega ao servidor pelo caminho nativo `activate(target, caster)`.
- [x] Criar barramento dono único de `mp.onActivate`, com decisão síncrona de
  consumo/bloqueio e trabalho assíncrono revalidado pelo Interaction Framework.
- [x] Substituir o polling de mira de 100 ms por `crosshairRefChanged`, mantendo
  snapshot inicial e fallback apenas durante homologação.
- [ ] Impedir dupla captura de E pelo Skyrim, prompt e CEF; provar que uma
  interação consumida devolve `false` e bloqueia o processamento vanilla.
- [ ] Provar que o nosso range check recusa target distante no mesmo worldspace;
  o SkyMP base não valida distância em `CheckInteractionAbility`.
- [x] Remover a seleção por proximidade da autoridade de prompt/execução.
- [ ] Decidir e registrar em ADR o uso de `interactionContextId`, seu vínculo e
  TTL. Não implementar token ad hoc dentro de Public Work.
- [x] Fechar Blocker D em código com um adaptador compartilhado de alvo físico.
- [ ] Fechar Blocker D em runtime com o teste manual de três clientes.

### Fase PW1 — domínio puro

- [x] Registry estático de definições executáveis (nenhuma rota fictícia).
- [x] Máquina de estados sem SkyMP.
- [x] Testes de transição, expiração, carga e replay idempotente.
- [x] Migration v29 e repositório transacional.

### Fase PW2 — interação no mundo

- [x] Fluxo genérico de quadro + E.
- [x] Fluxo genérico de origem + E.
- [x] Fluxo genérico de destino + E.
- [ ] `hay_delivery` e `firewood_delivery`.
- [x] Prompt e mensagens de erro em português.
- [x] Query e execute vinculados ao FormID exato sob a mira.
- [x] Mira vazia, troca de mira e alvo não registrado falham fechados em testes.

### Fase PW3 — economia e hardening

- [x] Pagamento e ledger atômicos no código e nos testes com banco falso.
- [x] Cooldown compartilhado.
- [x] Varredura de expiração.
- [x] Métricas e trilha de auditoria básicas.
- [ ] Teste de concorrência contra MariaDB real.

#### Defeitos conhecidos antes da homologação

- replay de `assignment_request_id` não rejeita run já
  `completed`/`cancelled`/`expired`, podendo responder “Trabalho aceito” sem
  criar nova execução;
- replay de coleta pode devolver confirmação de uma run terminal quando outra
  run ativa na mesma origem permite o `canSee`;
- a transição de expiração grava `public_work_events.character_id = NULL`,
  reduzindo a auditabilidade direta por personagem;
- Safe Zones ainda não reconhece a categoria `work`; esse é o único teste
  vermelho da suíte atual.

### Fase PW4 — validação in-game

- [ ] Três clientes em simultâneo: A operador, B alvo mais próximo e C alvo sob
  a mira; a ação deve atingir C.
- [ ] Disconnect/reconnect carregando corrida ativa.
- [ ] Restart durante `in_progress`.
- [ ] Duplo clique e retry de rede.
- [ ] Tentativa de entrega sem carga e no alvo errado.
- [ ] Medição de duração, recompensa e taxa de abandono.

### Fase PW5 — quadro híbrido

- [ ] Mostrar contratos jogador↔jogador no mesmo ponto visual.
- [ ] Manter APIs e estados separados.
- [ ] Permitir missivas sociais sem recompensa automática.

## 12. Critérios de aceite do MVP

O MVP só pode ser promovido de LAB quando:

1. nenhum comando de jogador for necessário no fluxo;
2. duas rotas completas funcionarem por E;
3. distância for validada no servidor em origem e destino;
4. nenhuma corrida pagar duas vezes sob concorrência/retry;
5. reconnect e restart não perderem nem duplicarem a execução;
6. trabalho público não conceder XP nem recurso primário de profissão;
7. cooldown valer entre cidades/trabalhos do mesmo grupo;
8. ledger identificar cada pagamento pelo `run_id`;
9. dois clientes não conseguirem reivindicar a mesma execução/carga;
10. a sessão manual registrar evidência, não apenas “pareceu funcionar”.
11. E nunca executar contra o alvo apenas mais próximo quando a mira aponta
    para outro;
12. alvo vazio, trocado, fora da célula ou fora do alcance falhar sem efeito;
13. nenhum timer do cliente conseguir antecipar recompensa ou transição;
14. o mesmo adaptador de alvo físico atender Minerador e Public Work sem dois
    protocolos concorrentes.
15. o JavaScript de event sources ser assinado e a build de produção possuir
    chave pública configurada; ausência de chave reprova o release.

## 13. Fora de escopo do MVP

- reputação com empregador;
- salário por hora;
- carreira ou rank de trabalho público;
- veículo/carroça persistente;
- rotas com combate obrigatório;
- pagamento variável por avaliação humana;
- editor administrativo de catálogo;
- Employment, Business ou folha de pagamento;
- generalização de todas as profissões num único motor de jobs.

## 14. Orientação para code review

Reprovar uma implementação se ela:

- criar item/moeda fora dos boundaries oficiais;
- confiar em alvo, recompensa, distância ou conclusão enviados pelo cliente;
- usar `setTimeout` como única representação da corrida;
- adicionar comando de chat como caminho principal;
- conceder madeira/minério/peixe comercial em Public Work;
- duplicar lógica do Interaction Framework;
- misturar Public Work com Contract ou Profession na mesma tabela;
- declarar pronto sem teste MariaDB e três clientes.
- usar proximidade/nearest-target como autoridade da ação;
- aceitar FormID sem conversão, resolução e revalidação no servidor;
- copiar timer client-side de outro fork como prova de trabalho concluído;
- criar um segundo listener de E ou protocolo de alvo exclusivo do módulo.
