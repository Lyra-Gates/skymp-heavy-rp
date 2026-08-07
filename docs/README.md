# Documentação

Mapa dos documentos do projeto. Se você acabou de chegar, leia na ordem da primeira seção.

> **Última conferência contra o código: 07/08/2026.** Os documentos foram lidos contra o estado real do repositório e as afirmações checadas uma a uma. O que estava desatualizado foi corrigido no mesmo commit. Se você encontrar um documento afirmando algo que o código não faz, isso é um bug — [abra uma issue](https://github.com/vinicius3232/skymp-heavy-rp/issues) ou corrija no seu PR.

---

## Comece por aqui

| # | Documento | Por quê |
|---|---|---|
| 0 | [CONSTITUICAO.md](CONSTITUICAO.md) | **A constituição de design.** O que o projeto é, o que nunca criar, e por que toda mecânica precisa responder "como isso gera histórias?". O Anexo A traz as tensões conhecidas dela. |
| 1 | [QA_REPORT_2026-08.md](technical/QA_REPORT_2026-08.md) | **O estado real de cada componente**, incluindo o que não está pronto e o plano priorizado. É o documento mais honesto do projeto. |
| 2 | [ARCHITECTURE.md](ARCHITECTURE.md) | Como banco, painel web, bot, API do jogo, launcher e gamemode conversam. |
| 3 | [../CONTRIBUTING.md](../CONTRIBUTING.md) | As regras que não são óbvias lendo o código. Quase todas existem porque alguém já quebrou aquilo. |
| 4 | [../CHANGELOG.md](../CHANGELOG.md) | O que mudou em cada versão — e o que sabidamente não está pronto. |

---

## Técnico

### Entender a plataforma

| Documento | Sobre |
|---|---|
| [SKYMP_UPSTREAM_REFERENCE.md](technical/SKYMP_UPSTREAM_REFERENCE.md) | A API real do SkyMP, incluindo hooks que a documentação oficial não menciona. Onde achar a verdade quando a doc é omissa. |
| [MODS_AND_GAMEMODE_CONTRACT.md](technical/MODS_AND_GAMEMODE_CONTRACT.md) | O que acontece com um mod dentro de um cliente conectado. Responde "esse mod funciona no servidor?" com critério. |
| [SKYMP_SERVER_SETUP.md](technical/SKYMP_SERVER_SETUP.md) | Instalação e configuração do servidor SkyMP. |
| [OPERATIONS.md](technical/OPERATIONS.md) | Runbook: subir, conferir schema, quem pode o quê, portas, e o que fazer quando algo dá errado. |
| [SERVER_OPTIONS_SCHEMA.md](technical/SERVER_OPTIONS_SCHEMA.md) | Opções de gameplay — **e quais delas realmente fazem efeito hoje**. |

### Distribuição e publicação

| Documento | Sobre |
|---|---|
| [LAUNCHER_DISTRIBUTION.md](technical/LAUNCHER_DISTRIBUTION.md) | Como cliente e modpack chegam ao jogador, como a paridade é verificada, e a assinatura do instalador (§6). |
| [PUBLIC_BUILD_GUIDE.md](technical/PUBLIC_BUILD_GUIDE.md) | O que precisa estar verdadeiro antes de publicar a build pra comunidade. |
| [LICENSE_AND_AFFILIATION_POLICY.md](technical/LICENSE_AND_AFFILIATION_POLICY.md) | Licenças do SkyMP por subprojeto, o que cada situação obriga, e não-afiliação. |
| [VOICE_CLIENT_PATCH.md](technical/VOICE_CLIENT_PATCH.md) | Runbook do patch de client que o VOIP nativo precisa e que não existe upstream. |

### Decisões tomadas

| Documento | Decisão |
|---|---|
| [PARKED_SERVICES_DECISION.md](technical/PARKED_SERVICES_DECISION.md) | Quais serviços estacionados foram apagados e por quê — duas rodadas de avaliação, e o critério que a primeira deixou escapar (§7). |
| [NPC_POLICY_DECISION.md](technical/NPC_POLICY_DECISION.md) | Como lidar com NPCs vanilla num servidor Heavy RP. |
| [NAMETAG_IDENTITY_SYSTEM.md](technical/NAMETAG_IDENTITY_SYSTEM.md) | Por que o nome exibido depende de quem está olhando. |
| [MARKET_STALL_VISUAL_ASSET_PLAN.md](technical/MARKET_STALL_VISUAL_ASSET_PLAN.md) | Assets visuais das barracas, com análise de licença mod a mod. |

### Design de mundo

| Documento | Sobre |
|---|---|
| [design/SOUL_AFFINITY.md](design/SOUL_AFFINITY.md) | **Afinidade da Alma — desenho fechado, domínio e serviço implementados.** Unifica magia, vampirismo, licantropia, corrupção, encantamento e linhagem. Parte I: análise de 15 pontos. Parte II: como isso vira jogo bom. Parte III: especificação. |

### Estudos de referência

| Documento | Fonte |
|---|---|
| [REFERENCE_STUDY_SKYMP_RED_HOUSE.md](technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md) | O único gamemode RP público que existe (GPL-3.0, parado em 2021). A §4.1 é leitura do código-fonte. |

### Planejamento

| Documento | Sobre |
|---|---|
| [HEAVY_RP_GAMEPLAY_SYSTEMS_BACKLOG.md](technical/HEAVY_RP_GAMEPLAY_SYSTEMS_BACKLOG.md) | Backlog de sistemas de gameplay. |
| [FASE_0_ROTEIRO.md](technical/FASE_0_ROTEIRO.md) | **O roteiro do teste in-game — o único bloqueio real do projeto.** Passo a passo, o que observar, o que significa falhar, e o registro pra preencher enquanto testa. |
| [GOVERNANCE_MARKET_STALLS_TEST_PLAN.md](technical/GOVERNANCE_MARKET_STALLS_TEST_PLAN.md) | Plano em camadas de 13/07, restrito a governança e barracas. Superado pelo roteiro acima. |

---

## Modding

| Documento | Sobre |
|---|---|
| [MODDING_GUIDELINES.md](MODDING_GUIDELINES.md) | Política de mods: regra de ouro, perfis, fases de QA, lista negra. |
| [MODPACK.md](MODPACK.md) | Composição do modpack. |
| [technical/MODS_AND_GAMEMODE_CONTRACT.md](technical/MODS_AND_GAMEMODE_CONTRACT.md) | O lado técnico da mesma questão. |

---

## Regras de RP e staff

| Documento | Sobre |
|---|---|
| [rules/HEAVY_RP_RULES.md](rules/HEAVY_RP_RULES.md) | Regras de roleplay do servidor. |
| [rules/PUBLIC_RULES_LAUNCH_OUTLINE.md](rules/PUBLIC_RULES_LAUNCH_OUTLINE.md) | Esboço das regras públicas de lançamento. |
| [rules/CHARACTER_APPLICATION_TEMPLATE.md](rules/CHARACTER_APPLICATION_TEMPLATE.md) | Modelo de ficha de personagem. |
| [staff/WHITELIST_RUBRIC.md](staff/WHITELIST_RUBRIC.md) | Critérios de aprovação de whitelist. |

---

## Legal

| Documento | Sobre |
|---|---|
| [legal/ASSET_LICENSE_REGISTRY.md](legal/ASSET_LICENSE_REGISTRY.md) | Registro de licença de cada asset usado. |
| [technical/LICENSE_AND_AFFILIATION_POLICY.md](technical/LICENSE_AND_AFFILIATION_POLICY.md) | Política de licença e não-afiliação. |
| [../LICENSE](../LICENSE) | AGPL-3.0. |

---

## Histórico

| Documento | Sobre |
|---|---|
| [roadmap/PHASE_0_TEST_LOG.md](roadmap/PHASE_0_TEST_LOG.md) | Evidências dos testes da Fase 0 (11/07/2026 — boot de servidor, `offlineMode=true`). |
| [roadmap/FASE_0_LOG_2026-08-06.md](roadmap/FASE_0_LOG_2026-08-06.md) | Registro da execução do [roteiro atual](technical/FASE_0_ROTEIRO.md). Etapa 0 preenchida; o resto aguarda a sessão com dois jogadores. |

---

## Convenções desta documentação

- **Português.** Termos técnicos consagrados ficam em inglês (`whitelist`, `commit`, `hash`).
- **Sobre o idioma:** existem **oito documentos traduzidos** para inglês, russo e espanhol — os três de entrada (`README`, `CONTRIBUTING`, `SECURITY`) e os cinco que barram um dev de fora (ver a tabela abaixo). Russo porque é a língua nativa da comunidade SkyMP (o upstream e o Red House são russos), espanhol pelo alcance na América Latina. Os outros 25 documentos ficam **só em português** de propósito: são regras de RP, rubricas de staff, backlog e decisões históricas — servem à operação deste servidor, não a quem chega de fora. Tradução desatualizada é pior que tradução ausente: é um texto em que as pessoas confiam e que mente em silêncio. Se algum documento específico bloquear alguém, traduzimos aquele sob demanda.
- **Mexeu num documento traduzido? Atualize as quatro cópias no mesmo PR.** É a regra que decide se essa tradução vale a pena ou vira dívida. Se não der pra atualizar todas, é melhor apagar as traduções daquele documento do que deixá-las mentindo.
  - **O `README` é a exceção deliberada, e só ele.** As quatro cópias não têm as mesmas seções: a portuguesa carrega o log de status do projeto, e as três traduzidas carregam tabela de componentes, "o que você não acha em outro lugar" e a política de idioma da documentação — porque quem chega em inglês, russo ou espanhol está avaliando o projeto, não acompanhando o dia a dia dele. Isso é adaptação de público, não tradução vencida. O que **não** pode divergir é afirmação: o aviso de que o servidor ainda não foi validado com jogadores reais está nas quatro, e nenhuma diz algo que outra contradiga. Para todos os outros sete documentos da família, seção que existe numa cópia existe nas quatro.
- **Idioma novo entra na linha de troca de TODOS os arquivos da família.** Os quatro arquivos de cada documento (`X.md`, `X.en.md`, `X.ru.md`, `X.es.md`) carregam a mesma linha de links no topo. Um idioma que não seja adicionado nessa linha em todos eles fica invisível.

### Documentos traduzidos

| Documento | Por que este e não outro |
|---|---|
| [`../README.md`](../README.md) · [en](../README.en.md) · [ru](../README.ru.md) · [es](../README.es.md) | Porta de entrada |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) · [en](../CONTRIBUTING.en.md) · [ru](../CONTRIBUTING.ru.md) · [es](../CONTRIBUTING.es.md) | As invariantes que já foram quebradas |
| [`../SECURITY.md`](../SECURITY.md) · [en](../SECURITY.en.md) · [ru](../SECURITY.ru.md) · [es](../SECURITY.es.md) | Ninguém deve errar o canal de reporte por barreira de idioma |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) · [en](ARCHITECTURE.en.md) · [ru](ARCHITECTURE.ru.md) · [es](ARCHITECTURE.es.md) | Sem isso não dá pra entender o que fala com o quê |
| [`technical/QA_REPORT_2026-08.md`](technical/QA_REPORT_2026-08.md) · [en](technical/QA_REPORT_2026-08.en.md) · [ru](technical/QA_REPORT_2026-08.ru.md) · [es](technical/QA_REPORT_2026-08.es.md) | É onde está a verdade sobre o que não está pronto |
| [`technical/MODS_AND_GAMEMODE_CONTRACT.md`](technical/MODS_AND_GAMEMODE_CONTRACT.md) · [en](technical/MODS_AND_GAMEMODE_CONTRACT.en.md) · [ru](technical/MODS_AND_GAMEMODE_CONTRACT.ru.md) · [es](technical/MODS_AND_GAMEMODE_CONTRACT.es.md) | A pergunta mais repetida da comunidade |
| [`technical/SKYMP_UPSTREAM_REFERENCE.md`](technical/SKYMP_UPSTREAM_REFERENCE.md) · [en](technical/SKYMP_UPSTREAM_REFERENCE.en.md) · [ru](technical/SKYMP_UPSTREAM_REFERENCE.ru.md) · [es](technical/SKYMP_UPSTREAM_REFERENCE.es.md) | Útil pra qualquer servidor SkyMP, mesmo quem não usa esta base |
| [`technical/SERVER_OPTIONS_SCHEMA.md`](technical/SERVER_OPTIONS_SCHEMA.md) · [en](technical/SERVER_OPTIONS_SCHEMA.en.md) · [ru](technical/SERVER_OPTIONS_SCHEMA.ru.md) · [es](technical/SERVER_OPTIONS_SCHEMA.es.md) | Separa a opção que funciona da que é só intenção |
- **Diga o que não funciona.** Documento que só descreve o caminho feliz vira mentira com o tempo. Quando algo está incompleto, o texto diz — e vários avisos aqui existem porque a documentação antiga afirmava coisas que o código nunca fez.
- **Marque a procedência.** Ao afirmar algo sobre o SkyMP, diga se veio da documentação oficial, de teste real ou de leitura de código. As três têm confiabilidades diferentes.
- **Ao mudar comportamento, atualize o documento no mesmo PR.** Documentação desatualizada custa mais caro que documentação ausente: ela é confiada.
