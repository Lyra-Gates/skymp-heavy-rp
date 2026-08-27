# Estudo do core publicado por `skyrim-roleplay/skymp`

**Data:** 25/08/2026 · **Escopo:** core SkyMP/Skyrim Platform usado como
referência pelo ecossistema Keizaal · **Resultado:** útil para contratos de
integração; não contém o gamemode privado de trabalhos do Keizaal.

## Resumo executivo

O repositório é útil, mas por um motivo diferente do inicialmente esperado.
Ele não revela como o Keizaal implementa seus trabalhos. A branch `main` é um
espelho quase atual de `skyrim-multiplayer/skymp`: no snapshot estudado, estava
**0 commits à frente e 4 atrás**. Os quatro commits ausentes tratavam de suporte
a `LCTN`, dependências e configuração de build, não de profissões ou economia.

O valor real do clone é permitir estudar o motor que transporta nossas
interações. A leitura confirmou quatro decisões:

1. o prompt deve reagir a `crosshairRefChanged`, em vez de consultar a mira a
   cada 100 ms indefinidamente;
2. E sobre um objeto já produz o evento nativo `activate`, com `target` e
   `caster` exatos e conversão para IDs do servidor;
3. o SkyMP base valida existência, autoridade do caster e worldspace, mas **não
   valida alcance** na ativação; distância continua sendo nossa obrigação;
4. `mp.onActivate` é um hook global, síncrono e bloqueável. O projeto precisa
   de um único barramento dono desse hook antes de Minerador ou Public Work
   dependerem dele.

Não importar o fork, não copiar um suposto sistema de jobs e não trocar nossa
base. Adaptar os contratos comprovados abaixo e manter toda recompensa,
cooldown, ferramenta, estado e idempotência autoritativos no servidor.

## Método e cobertura

A pesquisa não se limitou ao README. Foi feito clone integral, inventário da
árvore, inspeção de branches e histórico, comparação Git com o upstream atual e
leitura transversal das camadas relevantes:

- 1.799 arquivos versionados no snapshot;
- `skyrim-platform`: eventos, tipos gerados e implementação C++;
- `skymp5-client`: ativação, event sources, conversão de FormID e verificação
  de JavaScript recebido do servidor;
- `skymp5-server`: parser de mensagens, ativação, eventos de gamemode,
  propriedades, persistência e testes;
- `docs`, `ROADMAP.md`, configurações, exemplos e testes unitários/de integração;
- diff completo entre o HEAD do espelho e `skyrim-multiplayer/skymp/main`.

“Completo” aqui significa cobertura sistemática de toda a árvore e leitura em
profundidade dos caminhos que podem afetar nosso projeto. Não significa alegar
que cada uma das centenas de implementações C++ sem relação com trabalhos foi
lida linha a linha.

## 1. O que o repositório é — e o que não é

O próprio GitHub identifica `skyrim-roleplay/skymp` como fork de
`skyrim-multiplayer/skymp`. Não há branch pública de gamemode Keizaal nesse
repositório. A árvore contém motor, cliente, Skyrim Platform, parser ESM/ESP,
VM Papyrus, frontend base, testes e infraestrutura de build.

Consequências:

- o código pode confirmar o comportamento real da API SkyMP;
- o código não prova timers, recompensas, cooldowns, persistência ou
  anti-exploit dos trabalhos do Keizaal;
- changelogs do Keizaal continuam sendo fonte de produto, enquanto este clone
  é fonte do contrato técnico do motor;
- qualquer alegação “o Keizaal faz assim no servidor” exige outra fonte.

## 2. Aquisição de alvo: usar evento, não polling contínuo

O Skyrim Platform declara:

```ts
interface CrosshairRefChangedEvent {
  reference: ObjectReference | undefined
}
```

A implementação C++ escuta `SKSE::CrosshairRefEvent`, resolve a referência e
emite `crosshairRefChanged`. Portanto, o adaptador compartilhado pode:

1. fazer um snapshot inicial da mira no primeiro `update`;
2. atualizar o prompt apenas em `crosshairRefChanged`;
3. converter `event.reference.getFormID()` com
   `ctx.getFormIdInServerFormat()`;
4. limpar o prompt quando `reference` vier ausente;
5. revalidar o alvo no momento da ação e novamente no servidor.

O polling atual de 100 ms continua aceitável como fallback temporário de LAB,
mas não deve ser promovido. Além do custo por frame, ele envia refreshs
periódicos mesmo sem mudança. O próprio manual do Skyrim Platform alerta que
`update` ocorre a cada frame e deve ser evitado quando existe evento específico.

## 3. Tecla E e ativação nativa

O evento cliente `activate` contém:

```ts
interface ActivateEvent {
  target: ObjectReference
  caster: ObjectReference
  isCrimeToActivate: boolean
}
```

`ActivationService` lê os FormIDs, rejeita caster inválido, converte target e
caster para o formato remoto e envia uma mensagem confiável ao servidor. O
servidor associa o pacote ao ator conectado, valida hoster quando aplicável,
resolve o target e dispara `mp.onActivate(target, caster)`.

Esse caminho é melhor evidência de “o jogador pressionou E sobre este objeto”
do que interpretar apenas `buttonEvent`. Porém, há duas restrições:

- o hook do gamemode é global: atribuições concorrentes se sobrescrevem;
- o retorno é síncrono. `false` bloqueia o processamento vanilla; uma Promise
  não é um mecanismo válido para decidir o bloqueio depois de consulta SQL.

### Decisão de arquitetura

Criar `core/activation-events.js`, seguindo o padrão de
`core/death-events.js`:

- único dono de `mp.onActivate`;
- múltiplos assinantes nomeados, com ordem explícita;
- filtro síncrono baseado num índice em memória de FormIDs físicos;
- retorno agregado: se um assinante consumir o alvo, devolver `false` para
  impedir que a mesma tecla também execute o comportamento vanilla;
- trabalho assíncrono iniciado depois da decisão síncrona, sempre revalidado
  pelo `interaction-service`;
- falha de assinante não pode derrubar os demais;
- rejeitar no boot qualquer atribuição direta preexistente a `mp.onActivate`.

`buttonEvent` pode permanecer para atalhos que não são ativação de mundo. Não
deve ser o segundo protocolo econômico para Minerador/Public Work, pois E pode
disparar simultaneamente o listener genérico e a ativação vanilla.

## 4. Limites reais da validação nativa

O caminho `ActionListener::OnActivate` protege parte importante da fronteira:

- exige ator vinculado à conexão;
- valida a autoridade do caster remoto/hoster;
- ignora target inexistente;
- `CheckInteractionAbility` exige o mesmo worldspace;
- respeita activation parents e permite ao gamemode bloquear a ativação.

Mas `CheckInteractionAbility` compara worldspace e **não mede distância**.
Logo, um cliente alterado ainda pode enviar um target distante no mesmo mundo.

Para toda ação econômica, o nosso pipeline deve continuar verificando:

```text
ator da conexão
  -> target exato registrado
  -> mesma célula/worldspace
  -> distância calculada no servidor
  -> estado/política/permissão
  -> ferramenta autoritativa quando disponível
  -> cooldown + concorrência + idempotência
  -> transação/ledger
```

“Veio targetado pelo evento nativo” não equivale a “veio autorizado”.

## 5. Event sources e fronteira de confiança

`mp.makeEventSource()` distribui uma string JavaScript ao cliente. O cliente a
instala uma vez, fornece `ctx.sendEvent`, conversores de FormID e `ctx.state`, e
envia custom events por canal confiável. No servidor, o ator verdadeiro vem da
conexão; o nome do evento precisa começar com `_`.

Isso confirma nosso uso como transporte de **intenção**, não de verdade de
domínio. O payload continua totalmente controlável pelo jogador.

Também há dois cuidados operacionais novos:

1. event sources podem ser bloqueados pelo cliente; gameplay econômico não
   pode depender de que todo cliente honesto execute o snippet para preservar
   invariantes globais;
2. a verificação Ed25519 do JavaScript é efetivamente opcional: se nenhuma
   chave pública estiver configurada, o cliente pula a verificação. A build de
   produção deve distribuir `server-public-keys`/server info e reprovar a
   ausência dessa configuração no nosso check de release.

Hot reload de gamemode também fica desligado por padrão no upstream porque
reaplicar scripts em clientes conectados pode causar duplicação/desync. Manter
essa opção desabilitada em produção.

## 6. Propriedades atuais do servidor

A documentação textual de propriedades está incompleta em relação ao código.
`PropertyBindingFactory` atual expõe, entre outras:

- `locationalData`, `pos`, `angle`, `worldOrCellDesc`;
- `inventory`, `equipment`, `appearance`;
- `neighbors`, `actorNeighbors`, `onlinePlayers`;
- `isDead`, `isDisabled`, `isOnline`, `isOpen`;
- `profileId`, `spawnPoint`, `spawnDelay`, `percentages`;
- `baseDesc`, `type`, `idx`, `templateChain`.

Isto confirma que `locationalData` é contrato de código real, não apenas uma
hipótese nossa. Ainda assim, o teste in-game permanece necessário para provar o
formato e a disponibilidade contra uma `MpObjectReference` específica do nosso
modpack.

Não substituir o inventário transacional MariaDB pelo setter genérico de
`inventory`. `mp.set(..., 'inventory', ...)` é uma projeção ampla e não oferece
ledger, idempotência nem fronteira de domínio para economia Heavy RP.

## 7. Roadmap do motor como matriz de risco

O roadmap classifica aparência, atributos básicos, morte, inventário e crafting
tipo forja como feitos. Movimento, dano, containers, equipamento, pickup,
ingredientes, scripts e console permanecem parciais. Skills/perks, alquimia,
encantamento, temper, lockpicking, NPCs, loot, cavalos, quests, clima, tempo,
statics e vários outros sistemas continuam planejados.

Orientação para trabalhos:

- animação é feedback; nunca é autoridade de conclusão;
- carga de Public Work deve ser nossa entidade persistente, não depender de
  física/drag de objetos ainda incompleta;
- profissão não deve confiar na skill vanilla até existir contrato próprio;
- containers concorrentes não são base segura para depósitos econômicos;
- NPC empregador é apresentação opcional; o domínio deve funcionar com quadro
  e referências estáticas;
- clima, horário e perks não entram no MVP de trabalhos.

## 8. Impacto direto no nosso projeto

| Área atual | Achado | Decisão |
|---|---|---|
| `interaction-prompt-service` | polling de mira a cada 100 ms | substituir por `crosshairRefChanged`, com snapshot/fallback de LAB |
| captura de E | `buttonEvent` compete com ativação nativa | migrar interação de mundo para barramento `mp.onActivate` |
| distância | upstream só confere worldspace | manter `interaction-service` como autoridade de alcance |
| alvo físico | ativação fornece target/caster exatos | classificar no servidor; nunca aceitar tipo enviado pelo cliente |
| event source | payload confiável no transporte, não no conteúdo | schema, rate limit, re-resolução e idempotência continuam obrigatórios |
| JS do servidor | assinatura é pulada sem public key | adicionar gate de configuração de chaves na produção |
| posição de objeto | `locationalData` existe no binding atual | manter teste runtime; atualizar documentação de API assumida |
| jobs públicos | nenhum gamemode Keizaal está publicado | manter design original baseado em evidência de produto, não copiar código |

## 9. Ordem recomendada antes de Public Work

1. implementar e testar `activation-events` como dono único de `mp.onActivate`;
2. trocar o prompt para `crosshairRefChanged`, mantendo leitura inicial e
   limpeza em transições de menu/conexão;
3. registrar FormIDs consumíveis num índice síncrono de alvos físicos;
4. fazer Minerador consumir o evento de ativação pelo barramento;
5. provar em jogo que o E não executa duas rotas e que `false` bloqueia a
   ativação vanilla do veio;
6. testar A/B/C: B mais perto, C sob a mira, somente C é usado;
7. testar target distante no mesmo worldspace e comprovar recusa pelo nosso
   range check;
8. configurar e validar chaves de assinatura do JavaScript de gamemode;
9. só então iniciar quadro/origem/destino de Public Work.

## 10. O que não adotar

- importar `skyrim-roleplay/skymp` como se fosse uma distribuição Keizaal;
- tratar ausência de commits próprios como prova de ausência de gameplay no
  servidor privado;
- usar polling por frame quando existe evento específico;
- aceitar `buttonEvent` e `activate` como dois caminhos econômicos paralelos;
- confiar no worldspace check nativo como prova de proximidade;
- retornar Promise de `mp.onActivate` esperando bloquear processamento vanilla;
- promover event sources sem chaves públicas configuradas;
- usar setters genéricos de inventário como transação econômica;
- construir MVP em cima de NPC, física de carga, skill vanilla ou container
  concorrente que o próprio roadmap ainda classifica como incompleto.

## Fontes primárias

- [Repositório `skyrim-roleplay/skymp`](https://github.com/skyrim-roleplay/skymp)
- [Roadmap do core](https://github.com/skyrim-roleplay/skymp/blob/main/ROADMAP.md)
- [Eventos do Skyrim Platform](https://github.com/skyrim-roleplay/skymp/blob/main/docs/skyrim_platform/new_events.md)
- [Tipos gerados do Skyrim Platform](https://github.com/skyrim-roleplay/skymp/blob/main/skyrim-platform/src/platform_se/codegen/convert-files/skyrimPlatform.ts)
- [Serviço cliente de ativação](https://github.com/skyrim-roleplay/skymp/blob/main/skymp5-client/src/services/services/activationService.ts)
- [Event sources no cliente](https://github.com/skyrim-roleplay/skymp/blob/main/skymp5-client/src/services/services/gamemodeEventSourceService.ts)
- [Verificação de JavaScript recebido](https://github.com/skyrim-roleplay/skymp/blob/main/skymp5-client/src/services/services/serverJsVerificationService.ts)
- [Recepção de mensagens no servidor](https://github.com/skyrim-roleplay/skymp/blob/main/skymp5-server/cpp/server_guest_lib/ActionListener.cpp)
- [Ativação e validação de interação](https://github.com/skyrim-roleplay/skymp/blob/main/skymp5-server/cpp/server_guest_lib/MpObjectReference.cpp)
- [Bindings de propriedades](https://github.com/skyrim-roleplay/skymp/blob/main/skymp5-server/cpp/addon/property_bindings/PropertyBindingFactory.cpp)
- [Referência de configuração](https://github.com/skyrim-roleplay/skymp/blob/main/docs/docs_server_configuration_reference.md)

