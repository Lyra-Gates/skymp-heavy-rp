# Documentação

Mapa dos documentos do projeto. Se você acabou de chegar, leia na ordem da primeira seção.

> **Última conferência contra o código: 26/08/2026.** A fonte de verdade para estado operacional e backlog é o [PRODUCTION_READINESS_ACTION_PLAN.md](roadmap/PRODUCTION_READINESS_ACTION_PLAN.md); o parecer de promoção continua **NO-GO**. O snapshot local verificável registra **1.262 testes do gamemode (1.261 aprovados e 1 falha conhecida)**, migrations até **v29**, **80 tabelas declaradas** e typecheck do gamemode limpo. MariaDB e homologação com clientes reais continuam pendentes. Totais agregados de “testes de produto” do snapshot de 24/08 não foram recalculados nesta revisão e não devem ser usados como número atual. [PROJECT_STATE.md](../PROJECT_STATE.md) resume capacidades e preserva a evolução histórica, mas não substitui o quadro operacional. Documentos de handoff e pesquisa são registros datados: quando superados, preservam o contexto histórico e recebem aviso explícito. Se você encontrar um documento afirmando algo que o código não faz, isso é um bug — [abra uma issue](https://github.com/vinicius3232/skymp-heavy-rp/issues) ou corrija no seu PR.

---

## Comece por aqui

| # | Documento | Por quê |
|---|---|---|
| 0 | [CONSTITUICAO.md](CONSTITUICAO.md) | **A constituição de design.** O que o projeto é, o que nunca criar, e por que toda mecânica precisa responder "como isso gera histórias?". O Anexo A traz as tensões conhecidas dela. |
| 1 | [roadmap/PRODUCTION_READINESS_ACTION_PLAN.md](roadmap/PRODUCTION_READINESS_ACTION_PLAN.md) | **Fonte de verdade operacional e do backlog.** Tarefas com IDs, status, dependências, gates G0–G5, critérios de aceite e evidências. |
| 1.1 | [operations/PRODUCTION_BLOCKERS_2026-08-24.md](operations/PRODUCTION_BLOCKERS_2026-08-24.md) | **Parecer vigente de promoção: NO-GO.** Lista a evidência externa ainda necessária. |
| 1.2 | [../PROJECT_STATE.md](../PROJECT_STATE.md) | **Capacidades atuais e evolução histórica** do framework; não substitui o quadro operacional. |
| 1.3 | [QA_REPORT_2026-08.md](technical/QA_REPORT_2026-08.md) | Auditoria detalhada por componente, usada como contexto técnico datado. |
| 2 | [ARCHITECTURE.md](ARCHITECTURE.md) | Como banco, painel web, bot, API do jogo, launcher e gamemode conversam. |
| 2.1 | [research/ADMIN_PLATFORM_AUDIT.md](research/ADMIN_PLATFORM_AUDIT.md) | **O estado real do painel de staff.** Doze rotas administrativas, zero verificações de permissão — e o que mais a auditoria de 13/08 encontrou. Leia antes de `skyadmin/`. |
| 2.2 | [skyadmin/README.md](skyadmin/README.md) | Centro de orientação do painel de staff: escopo, arquitetura, plano, segurança, operação e referências. **É projeto, não estado** — ver a §7 da auditoria acima. |
| 3 | [../CONTRIBUTING.md](../CONTRIBUTING.md) | As regras que não são óbvias lendo o código. Quase todas existem porque alguém já quebrou aquilo. |
| 4 | [../CHANGELOG.md](../CHANGELOG.md) | O que mudou em cada versão — e o que sabidamente não está pronto. |

---

## Técnico

### Entender a plataforma

| Documento | Sobre |
|---|---|
| [research/SKYMP_INTEGRATION_AUDIT.md](research/SKYMP_INTEGRATION_AUDIT.md) | **Auditoria de 14/08 da fronteira com o SkyMP.** Nenhum dos problemas do Heavy RP exige patch — mas seis chamadas nossas usam API que não existe, e uma delas derruba todo jogador conectado em dois segundos. **Leia antes de qualquer sessão de teste.** |
| [SKYMP_UPSTREAM_REFERENCE.md](technical/SKYMP_UPSTREAM_REFERENCE.md) | A API real do SkyMP, incluindo hooks que a documentação oficial não menciona. Onde achar a verdade quando a doc é omissa. |
| [SKYMP_COMPATIBILITY_MATRIX.md](technical/SKYMP_COMPATIBILITY_MATRIX.md) | **A única declaração de versão do projeto** — SkyMP, Skyrim, SKSE, SkyrimPlatform, modpack — mais o procedimento de atualização e as três camadas de teste que ela exige. |
| [PAPYRUS_USAGE_POLICY.md](technical/PAPYRUS_USAGE_POLICY.md) | As 128 funções Papyrus que o servidor implementa, classificadas em REQUIRED/SAFE/LIMITED/AVOID. Chamar qualquer outra devolve `null` em silêncio. |
| [PLUGIN_LOAD_ORDER_STRATEGY.md](technical/PLUGIN_LOAD_ORDER_STRATEGY.md) | Por que o primeiro byte do FormID é o índice do plugin, por que **ESL não existe no SkyMP**, e o que o nosso gate de paridade ainda deixa passar. |
| [SKYMP_PATCH_POLICY.md](technical/SKYMP_PATCH_POLICY.md) | Quando patch, quando adapter, quando extensão de cliente, quando PR — e o que mudou quando o upstream passou a exigir cessão de direito autoral. |
| [`core/skymp-adapter/`](../skymp/gamemode/core/skymp-adapter/README.md) | A fronteira declarada contra o motor: identidade, Papyrus e detecção de capacidade. Só os boundaries que a auditoria provou instáveis. |
| [MODS_AND_GAMEMODE_CONTRACT.md](technical/MODS_AND_GAMEMODE_CONTRACT.md) | O que acontece com um mod dentro de um cliente conectado. Responde "esse mod funciona no servidor?" com critério. |
| [SKYMP_SERVER_SETUP.md](technical/SKYMP_SERVER_SETUP.md) | Checklist do servidor SkyMP nativo: ambientes, arquivos obrigatórios, marco mínimo de validação. |
| [FASE_0_SETUP_DO_ZERO.md](technical/FASE_0_SETUP_DO_ZERO.md) · [en](technical/FASE_0_SETUP_DO_ZERO.en.md) | **O onboarding do monorepo inteiro**, do zero: dependências de cada app, banco, todos os `.env`, assets do Skyrim, artefato do servidor, Discord, túnel — mais uma seção de problemas conhecidos com cada erro real encontrado ajudando um fork externo a subir o projeto. |
| [LAUNCHER_UI_GUIDE.md](technical/LAUNCHER_UI_GUIDE.md) | Sistema de design do launcher (fontes, cores, o motivo `.hud-panel`), por que o dashboard da Home é assimétrico, `npm run dev` vs `npm start`, como iterar visual sem o ambiente inteiro de pé, e a tabela dos três valores do Discord que se parecem e não são a mesma coisa. |
| [OPERATIONS.md](technical/OPERATIONS.md) | Runbook: subir, conferir schema, quem pode o quê, portas, e o que fazer quando algo dá errado. |
| [SERVER_OPTIONS_SCHEMA.md](technical/SERVER_OPTIONS_SCHEMA.md) | Opções de gameplay — **e quais delas realmente fazem efeito hoje**. |

### Frameworks centrais

| Documento | Sobre |
|---|---|
| [framework/MODULE_SYSTEM.md](framework/MODULE_SYSTEM.md) | O `module-registry`: ciclo de vida de módulo, a diferença entre PARKED e desligado por flag, ordenação topológica. Lista o que é PARKED de verdade hoje. |
| [framework/INTERACTION_FRAMEWORK.md](framework/INTERACTION_FRAMEWORK.md) | O único caminho de interação desde 13/08 (`ADR-002`). Integra a suíte atual do gamemode; ver [testing/INTERACTION_TEST_MATRIX.md](testing/INTERACTION_TEST_MATRIX.md) para o que ainda falta provar em sessão real. |
| [framework/INVENTORY_FRAMEWORK.md](framework/INVENTORY_FRAMEWORK.md) | O caminho obrigatório para qualquer item que muda de dono. Ver [testing/INVENTORY_TRANSACTION_MATRIX.md](testing/INVENTORY_TRANSACTION_MATRIX.md). |
| [framework/ECONOMY_FRAMEWORK.md](framework/ECONOMY_FRAMEWORK.md) | Como saber que seu módulo está mexendo em ouro do jeito errado. Ver [testing/ECONOMY_SECURITY_MATRIX.md](testing/ECONOMY_SECURITY_MATRIX.md). |

### Distribuição e publicação

| Documento | Sobre |
|---|---|
| [LAUNCHER_DISTRIBUTION.md](technical/LAUNCHER_DISTRIBUTION.md) | Como cliente e modpack chegam ao jogador, como a paridade é verificada, e a assinatura do instalador (§6). |
| [ADR_012_LAUNCHER_CONNECTION_BOOTSTRAP.md](technical/ADR_012_LAUNCHER_CONNECTION_BOOTSTRAP.md) | Por que o bootstrap da conexão falha fechado, grava dois contratos, remove identidade legada, ignora o gateway público e só confirma sucesso depois do `spawn`. |
| [research/LAUNCHER_COMPARATIVE_STUDY_2026-08-26.md](research/LAUNCHER_COMPARATIVE_STUDY_2026-08-26.md) | Estudo estático do launcher externo que revelou a dependência de `/serverinfo`; separa o que foi adaptado, rejeitado e ainda depende de teste real. |
| [PUBLIC_BUILD_GUIDE.md](technical/PUBLIC_BUILD_GUIDE.md) | O que precisa estar verdadeiro antes de publicar a build pra comunidade. |
| [LICENSE_AND_AFFILIATION_POLICY.md](technical/LICENSE_AND_AFFILIATION_POLICY.md) | Licenças do SkyMP por subprojeto, o que cada situação obriga, e não-afiliação. |
| [SKYVOICE_LIVEKIT_AUDIT.md](technical/SKYVOICE_LIVEKIT_AUDIT.md) | **Comece por aqui para qualquer coisa de voz.** Auditoria do VOIP atual + validação do LiveKit. Corrige a versão da CEF (é a **108**, não "~70"), mostra por que `getUserMedia` falha de verdade, e traz o spike que provou o transporte A→SFU→B contra um `livekit-server` real. A §12 diz o que continua bloqueado: ninguém ouviu. |
| [VOICE_CLIENT_PATCH.md](technical/VOICE_CLIENT_PATCH.md) | Runbook do patch de client que o VOIP nativo precisava e que não existe upstream — **descartado**, e mantido porque explica por que a captura saiu do navegador. O bloco no topo corrige a versão da CEF e acrescenta o terceiro motivo da rejeição. |
| [VOICE_NATIVE_HELPER.md](technical/VOICE_NATIVE_HELPER.md) | O caminho de voz que **existe e captura hoje**, e o Plano B da migração. WASAPI fora do CEF, relay pelo servidor, primeiro build e primeira captura medida (§8.3, §8.4). A §8.2 diz o que continua sem prova: ninguém ouviu. |
| [VOICE_FORK_AUDIT_SKYMP_VGR_2026-08-11.md](technical/VOICE_FORK_AUDIT_SKYMP_VGR_2026-08-11.md) | O único fork com voz LiveKit ponta a ponta no fonte — e as lacunas dele (`proximityLoop` que não inicia, API de posição aberta sem autenticação) que não devemos repetir. |

### Decisões tomadas

| Documento | Decisão |
|---|---|
| [PARKED_SERVICES_DECISION.md](technical/PARKED_SERVICES_DECISION.md) | Quais serviços estacionados foram apagados e por quê — duas rodadas de avaliação, e o critério que a primeira deixou escapar (§7). |
| [NPC_POLICY_DECISION.md](technical/NPC_POLICY_DECISION.md) | Como lidar com NPCs vanilla num servidor Heavy RP. Deixou seis perguntas abertas na §5. |
| [HOSTILE_MOB_ACTIVATION_DECISION.md](technical/HOSTILE_MOB_ACTIVATION_DECISION.md) | Responde a terceira delas — criaturas hostis ficam ativas —, e derruba a premissa de que havia algo a "ativar": o `npc-cleaner` é inerte, então o mundo provavelmente já está cheio de lobos e ursos. Análise de 15 pontos. **A mecânica continua sem uma linha de código**; os dois instrumentos que a decidem existem desde 08/08 — ver [FAUNA_CENSUS_PROTOCOL.md](technical/FAUNA_CENSUS_PROTOCOL.md). |
| [NAMETAG_IDENTITY_SYSTEM.md](technical/NAMETAG_IDENTITY_SYSTEM.md) | Por que o nome exibido depende de quem está olhando. |
| [MARKET_STALL_VISUAL_ASSET_PLAN.md](technical/MARKET_STALL_VISUAL_ASSET_PLAN.md) | Assets visuais das barracas, com análise de licença mod a mod. |

### Unificação de 22/08/2026: Profissões, Economia/Vault, Depot, Ambiente, UX

| Documento | Sobre |
|---|---|
| [gameplay/PROFESSION_FRAMEWORK.md](gameplay/PROFESSION_FRAMEWORK.md) | Profession Core implementado e testado, atrás de `ENABLE_PROFESSION_SERVICE`. Minerador é o primeiro consumidor; as demais profissões ainda carecem de gameplay própria. |
| [technical/ADR_007_WORK_ECOSYSTEM_TAXONOMY.md](technical/ADR_007_WORK_ECOSYSTEM_TAXONOMY.md) | Separa Profession, Employment, Business, Public Work, Contract e Governance para impedir sobreposição de domínio. |
| [technical/ADR_008_PROFESSION_SPECIALIZATION_BOUNDARY.md](technical/ADR_008_PROFESSION_SPECIALIZATION_BOUNDARY.md) | A decisão sobre onde termina Profession e começa Specialization. |
| [gameplay/WORK_AND_PROFESSION_ECOSYSTEM_VISION.md](gameplay/WORK_AND_PROFESSION_ECOSYSTEM_VISION.md) | Visão unificada para equipe e produto: trabalhos livres, profissões/classes profissionais, especializações, empregos, posições, negócios, contratos e governança. |
| [technical/ADR_011_PUBLIC_WORK.md](technical/ADR_011_PUBLIC_WORK.md) | Trabalho público como piso econômico: sem profissão/XP, com interação física, estado persistente, carga, idempotência e cooldown. |
| [technical/ADR_012_LAUNCHER_CONNECTION_BOOTSTRAP.md](technical/ADR_012_LAUNCHER_CONNECTION_BOOTSTRAP.md) | Configuração e criação do processo do jogo são fail-closed; identidade fica no servidor e sucesso exige `spawn` confirmado. |
| [technical/ECONOMY_VAULT_AUDIT.md](technical/ECONOMY_VAULT_AUDIT.md) | Os 3 gaps sobre a infraestrutura de economia já existente: anti-cheat de ouro físico e auditoria de transação grande. |
| [technical/DEPOT_SERVICE_AUDIT.md](technical/DEPOT_SERVICE_AUDIT.md) | Armazenamento regional de itens por hold — recuperado de um commit de auto-save nunca finalizado e mesclado na unificação de 22/08. Sem reserva de ouro própria, sem checagem de combate. |
| [technical/ENVIRONMENT_AUDIT.md](technical/ENVIRONMENT_AUDIT.md) | Time Sync: relógio autoritativo do servidor, heartbeat de correção de deriva, persistência entre restarts. |
| [technical/ENVIRONMENT_WEATHER_SPIKE.md](technical/ENVIRONMENT_WEATHER_SPIKE.md) | Spike de pesquisa — sincronização de clima (ForceWeather). Sem implementação; nenhum `weather-service.js` existe. |
| [technical/UI_UX_INTERACTION_AUDIT.md](technical/UI_UX_INTERACTION_AUDIT.md) | Tarefa 11 — prompt de interação `[E]`, o mesmo menu de ações por tecla em vez de só clique, e a ponte `SELF` pro painel do jogador. |

### Atalhos de teclado e menus de ação (22/08/2026)

| Documento | Sobre |
|---|---|
| [technical/VOICE_MODE_KEY_AUDIT.md](technical/VOICE_MODE_KEY_AUDIT.md) | `Tab` cicla sussurro/normal/grito, `M` muta — ligando um backend de voz que já existia mas cujo cliente estava 100% morto (nenhuma tecla, nenhum botão, nenhum caminho até esta auditoria). Indicador persistente na CEF, decisão de acessibilidade. |
| [technical/PLAYER_SHORTCUTS_AUDIT.md](technical/PLAYER_SHORTCUTS_AUDIT.md) | `F2` abre o `/painel`; inventário completo de todo comando `/` de jogador (18 arquivos varridos), categorizado por candidatura a atalho — o que já tinha caminho melhor, o que devia virar aba de painel, o que fica texto pra sempre. |
| [technical/PLAYER_ACTION_SHORTCUTS_PLAN.md](technical/PLAYER_ACTION_SHORTCUTS_PLAN.md) | As 5 fases executadas a partir do inventário acima: trade-overlay consertada (os botões não chamavam nenhum listener), `/socorrer` e `/stallpack`/`/stallremove` no menu `[E]`, `/profissoes`/`/alma` como abas do painel, modal de escolha (`browserModal` tipo `'choice'`) pro pedido de revista. Corrige duas premissas erradas do próprio plano ao ler o código de verdade antes de codar. |

### Economia: contratos, dívida, troca e crafting (reativados 20/08/2026)

| Documento | Sobre |
|---|---|
| [gameplay/CONTRACTS.md](gameplay/CONTRACTS.md) | Um jogador publica trabalho, outro aceita, escrow trava no post. Saiu de PARKED em 20/08 — `LAB`, atrás de `ENABLE_CONTRACTS_SERVICE`. |
| [gameplay/DEBT_SYSTEM.md](gameplay/DEBT_SYSTEM.md) | Registro de dívida selado quando um contrato não pode ser pago — nunca cobrança automática. Continua PARKED de verdade. |
| [gameplay/TRADE_SYSTEM.md](gameplay/TRADE_SYSTEM.md) | Troca direta entre jogadores. Implementado e testado, sem UI CEF, nunca rodou numa sessão real. |
| [gameplay/CRAFTING_SYSTEM.md](gameplay/CRAFTING_SYSTEM.md) | Receitas com gate de `required_profession`/`required_rank`. Reativado em 20/08; ganhou a Assinatura do Artesão em 22/08 — ver seção abaixo. |
| [gameplay/PUBLIC_WORK_SYSTEM.md](gameplay/PUBLIC_WORK_SYSTEM.md) | **Contrato canônico de trabalhos públicos.** Domínio e fluxo genérico implementados em LAB; rotas reais, MariaDB e homologação por E ainda pendentes. |

### Crime & Proveniência e Assinatura do Artesão (21-22/08/2026)

| Documento | Sobre |
|---|---|
| [technical/CRIME_SYSTEM_AUDIT.md](technical/CRIME_SYSTEM_AUDIT.md) | `item_instances` rastreia posse de item roubado, janela "quente", restituição automática por combat-log, revista institucional revela o dono original. |
| [design/MAKERS_MARK.md](design/MAKERS_MARK.md) | Artesão com rank suficiente assina o que craft (`crafted_item_signatures`); a revista institucional da guarda mostra essa autoria. |

### Design de mundo

| Documento | Sobre |
|---|---|
| [design/ENFORCEMENT_PLAN.md](design/ENFORCEMENT_PLAN.md) | **Punição e permissão — plano.** A permissão `ban` é concedida e **nada no código a usa**: os três pontos de aplicação funcionam e ninguém escreve neles. Quatro itens, ordenados por dependência, nenhum bloqueado pela Fase 0. |
| [design/ANTICHEAT.md](design/ANTICHEAT.md) | **Anti-cheat — scanner de cliente rejeitado, alternativa aprovada.** Por que varrer a máquina do jogador detecta a coisa errada, e por que a detecção de ActorValue implausível no servidor é inforjável e não custa privacidade. |
| [design/SOUL_AFFINITY.md](design/SOUL_AFFINITY.md) | **Afinidade da Alma — desenho fechado, domínio e serviço implementados.** Unifica magia, vampirismo, licantropia, corrupção, encantamento e linhagem. Parte I: análise de 15 pontos. Parte II: como isso vira jogo bom. Parte III: especificação. |

### Estudos de referência

| Documento | Fonte |
|---|---|
| [REFERENCE_STUDY_SKYMP_RED_HOUSE.md](technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md) | O único gamemode RP público que existe (GPL-3.0, parado em 2021). A §4.1 é leitura do código-fonte. |
| [research/PUBLIC_WORK_REFERENCE_STUDY_2026-08-25.md](research/PUBLIC_WORK_REFERENCE_STUDY_2026-08-25.md) | Keizaal, Vengeful Realms, Mereth, Daedric Online, Nirn RP e sistemas adjacentes; separa comportamento anunciado, código auditável e hipótese. |
| [research/VENGEFUL_REALMS_INTERACTION_STUDY_2026-08-25.md](research/VENGEFUL_REALMS_INTERACTION_STUDY_2026-08-25.md) | Auditoria completa do README, docs, frontend e ZIP público do patch; define o que adaptar e o que rejeitar em alvo, sessões, mineração e lenhador. |
| [research/SKYRIM_ROLEPLAY_SKYMP_CORE_STUDY_2026-08-25.md](research/SKYRIM_ROLEPLAY_SKYMP_CORE_STUDY_2026-08-25.md) | Clone e diff integral do espelho ligado ao Keizaal; extrai contratos reais de crosshair, ativação, alcance, event sources, propriedades e limites do motor. |

### Planejamento

| Documento | Sobre |
|---|---|
| [roadmap/PRODUCTION_READINESS_ACTION_PLAN.md](roadmap/PRODUCTION_READINESS_ACTION_PLAN.md) | Plano operacional vivo para promover o projeto de `LAB` até alfa fechada e produção: dashboard, bloqueadores P0, fases F0–F9, critérios de saída e registro de execução. |
| [roadmap/WORK_ECOSYSTEM_IMPLEMENTATION_PLAN_2026-08-25.md](roadmap/WORK_ECOSYSTEM_IMPLEMENTATION_PLAN_2026-08-25.md) | Plano executável W0–W6 para interação por E, Minerador, crafting profissional, Public Work, retirada do jobs legado e promoção segura por ambiente. |
| [HEAVY_RP_GAMEPLAY_SYSTEMS_BACKLOG.md](technical/HEAVY_RP_GAMEPLAY_SYSTEMS_BACKLOG.md) | Backlog de sistemas de gameplay. |
| [GUIA_SESSAO_DE_TESTE.md](technical/GUIA_SESSAO_DE_TESTE.md) | **Como chegar até o roteiro:** ligar os quatro serviços, conferir as portas, e o guia copiável para mandar aos testadores. A Parte 2 é escrita para quem nunca viu o repositório. |
| [FASE_0_ROTEIRO.md](technical/FASE_0_ROTEIRO.md) | **O roteiro do teste in-game — o único bloqueio real do projeto.** Passo a passo, o que observar, o que significa falhar, e o registro pra preencher enquanto testa. Comece pelo guia acima. |
| [FAUNA_CENSUS_PROTOCOL.md](technical/FAUNA_CENSUS_PROTOCOL.md) | Sessão separada do roteiro, e de outra natureza: **não há "passou" nem "falhou", só o que existe no mundo.** Como rodar o censo de fauna e a prova do cadáver — as duas perguntas que decidem se a mecânica de caça existe. |
| [MOBS_LOOT_LAB_HANDOFF_2026-08-12.md](roadmap/MOBS_LOOT_LAB_HANDOFF_2026-08-12.md) | Resultado do boot instrumentado: NPCs estavam desabilitados por ausência de `npcEnabled`; configuração local corrigida, sondas carregadas e comandos da sessão in-game registrados. |
| [GOVERNANCE_MARKET_STALLS_TEST_PLAN.md](archive/GOVERNANCE_MARKET_STALLS_TEST_PLAN.md) *(arquivado)* | Plano em camadas de 13/07, restrito a governança e barracas. Superado pelo roteiro acima. |

### Ciclo de hardening de 11/08/2026

| Documento | Estado |
|---|---|
| [roadmap/CODEX_CLAUDE_IMPLEMENTATION_PLAN.md](roadmap/CODEX_CLAUDE_IMPLEMENTATION_PLAN.md) | Plano coordenado; o snapshot inicial já foi consolidado em `c23179d`. |
| [roadmap/TASK_001_UI_EVENT_CONTRACT.md](roadmap/TASK_001_UI_EVENT_CONTRACT.md) | Gateway, validação e rate limiting de eventos CEF implementados; CEF real pendente. |
| [roadmap/TASK_002_CORE_TYPECHECK.md](roadmap/TASK_002_CORE_TYPECHECK.md) | Estado do typecheck e limites do contrato JS atual. |
| [roadmap/TASK_003_CONNECTION_LIFECYCLE.md](roadmap/TASK_003_CONNECTION_LIFECYCLE.md) | Monitor de conexão implementado; cliente real pendente. |
| [roadmap/TASK_004_ECONOMY_TRANSACTION_BOUNDARY.md](roadmap/TASK_004_ECONOMY_TRANSACTION_BOUNDARY.md) | Tesouros e mercado regional transacionais; módulo regional permanece PARKED. |
| [roadmap/TASK_005_VOIP_CAPACITY_AND_SECURITY.md](roadmap/TASK_005_VOIP_CAPACITY_AND_SECURITY.md) | Limites de protocolo implementados; benchmark de áudio real pendente. |
| [roadmap/TASK_006_MARKET_STALL_IDEMPOTENCY.md](roadmap/TASK_006_MARKET_STALL_IDEMPOTENCY.md) | Retry idempotente implementado; concorrência com dois clientes pendente. |
| [technical/AUTH_001_TRUST_BOUNDARY_INVENTORY.md](technical/AUTH_001_TRUST_BOUNDARY_INVENTORY.md) | Inventário das identidades, tokens e fronteiras de confiança. |
| [technical/AUTH_002_OPAQUE_TICKET_V1.md](technical/AUTH_002_OPAQUE_TICKET_V1.md) | Contrato de credencial opaca, hashing e redaction. |
| [technical/CHR_001_ACCOUNT_SESSION_CHARACTER_IDENTITY.md](technical/CHR_001_ACCOUNT_SESSION_CHARACTER_IDENTITY.md) | Contrato de identidade entre conta, sessão e personagem. |

### Pesquisa de forks

As duas rodadas cobrem conjuntos **diferentes** de projetos e se somam. A de 12/08 auditou oito forks do SkyMP; a de 13/08 cobriu os sete projetos de referência do briefing de ecossistema, dos quais quatro nunca tinham sido vistos.

| Documento | Sobre |
|---|---|
| [research/SKYMP_FORK_RESEARCH_INDEX.md](research/SKYMP_FORK_RESEARCH_INDEX.md) | **Leia primeiro.** Mapa das três rodadas abaixo, o que cada uma cobre, e quais fatos de rodadas antigas já foram corrigidos por uma mais nova. |
| [research/SKYMP_FORK_DIFF_MATRIX.md](research/SKYMP_FORK_DIFF_MATRIX.md) | **Rodada de 14/08**, e a primeira feita por comparação de commits em vez de leitura de árvore. Corrige duas afirmações registradas como fato: o "fork do Red House" não tem um commit próprio na `main`, e o Hijos tem o dobro do que estava documentado. |
| [research/SKYMP_ECOSYSTEM_MATRIX.md](research/SKYMP_ECOSYSTEM_MATRIX.md) | **Rodada de 13/08.** Matriz de 37 sistemas contra sete projetos, com licença e profundidade de verificação de cada um — três deles não têm licença, e são justamente os que têm o que nos falta. |
| [research/SKYMP_ECOSYSTEM_DEEP_DIVE.md](research/SKYMP_ECOSYSTEM_DEEP_DIVE.md) | Relatório por projeto. Traz os quatro achados acionáveis, os dois resultados negativos, e onde nós estamos à frente. |
| [roadmap/ECOSYSTEM_ADAPTATION_ROADMAP.md](roadmap/ECOSYSTEM_ADAPTATION_ROADMAP.md) | P0–P7 derivado da rodada de 13/08. Não reordena o roadmap de forks; acrescenta e declara dependência. Cinco tarefas não dependem da Fase 0. |
| [research/SKYMP_FORK_RESEARCH_EXECUTIVE_SUMMARY.md](research/SKYMP_FORK_RESEARCH_EXECUTIVE_SUMMARY.md) | **Rodada de 12/08.** Síntese executiva da pesquisa do ecossistema e lacunas Heavy RP. |
| [research/SKYMP_ECOSYSTEM_SYSTEM_MAP.md](research/SKYMP_ECOSYSTEM_SYSTEM_MAP.md) | Mapa dos sistemas encontrados nos forks estudados. |
| [research/SKYMP_FORKS_SYSTEM_MATRIX.md](research/SKYMP_FORKS_SYSTEM_MATRIX.md) | Matriz comparativa dos forks. |
| [technical/REFERENCE_STUDY_SKYMP_FORKS_2026-08-11.md](technical/REFERENCE_STUDY_SKYMP_FORKS_2026-08-11.md) | Estudo técnico consolidado e rastreável. |

---

## Plataforma: launcher, game-api e distribuição

| Documento | Sobre |
|---|---|
| [research/PLATFORM_INFRASTRUCTURE_AUDIT.md](research/PLATFORM_INFRASTRUCTURE_AUDIT.md) | **Auditoria de 13/08.** O caminho login→fila→sessão auditado linha a linha: 27 achados, o desenho da máquina de estados do launcher, o manifesto v2, e o que fazer (e o que **não** fazer) de infraestrutura antes da Fase 0. |
| [platform/MOD_DISTRIBUTION_POLICY.md](platform/MOD_DISTRIBUTION_POLICY.md) | O que pode ser redistribuído e o que só pode ser verificado. Quatro categorias, e como o manifesto as codifica. |
| [testing/LAUNCHER_PLATFORM_TEST_MATRIX.md](testing/LAUNCHER_PLATFORM_TEST_MATRIX.md) | Instalação limpa, update, repair, manifesto adversário, backend fora do ar, fila, tickets. O que já é coberto, o que só uma máquina com Skyrim prova, e onde investir primeiro. |
| [technical/LAUNCHER_DISTRIBUTION.md](technical/LAUNCHER_DISTRIBUTION.md) | O que o código faz **hoje** — canais, manifestos, login, assinatura do instalador. |
| [technical/LAUNCHER_UI_GUIDE.md](technical/LAUNCHER_UI_GUIDE.md) | Sistema de design do launcher, por que a Home é assimétrica, e as três credenciais do Discord que se confundem. |
| [research/MO2_LAUNCHER_INTEGRATION_RESEARCH.md](research/MO2_LAUNCHER_INTEGRATION_RESEARCH.md) | **Pesquisa, não implementação.** Rodar o jogo via Mod Organizer 2 em vez de `skse64_loader.exe` direto — USVFS, precedente do Wabbajack, licença GPL-3.0, e o bloqueador real: compatibilidade SkyrimPlatform+USVFS nunca testada neste projeto. Plano faseado começando por bancada manual. |

---

## Plataforma administrativa: painel de staff, RBAC e moderação

| Documento | Sobre |
|---|---|
| [research/ADMIN_PLATFORM_AUDIT.md](research/ADMIN_PLATFORM_AUDIT.md) | **Auditoria de 13/08.** O que existe hoje: dois sistemas de permissão que não se conhecem, três permissões que nada verifica, ban construído pela metade, e o teto real do que a API `mp` permite fazer com jogador conectado. |
| [admin/ADMIN_PLATFORM.md](admin/ADMIN_PLATFORM.md) | O painel alvo: catorze módulos, cinco fases, o fluxo de uma ação — e por que `server.restart` e `modules.toggle` a quente ficam de fora. |
| [admin/RBAC.md](admin/RBAC.md) | Catálogo de ~40 permissões, seis cargos, modelo de dados, contrato do middleware e a política de Discord. |
| [admin/MODERATION_WORKFLOW.md](admin/MODERATION_WORKFLOW.md) | Casos, warns, ban com prazo, whitelist em cinco estados, apelação — e a diferença entre aposentar e matar um personagem. |
| [testing/ADMIN_SECURITY_MATRIX.md](testing/ADMIN_SECURITY_MATRIX.md) | O portão: três testes por rota, matriz cargo × permissão, ameaças da §20 e as mutações que provam que os testes valem. **Nenhum deles existe ainda.** |
| [technical/ADR_005_ADMIN_RBAC.md](technical/ADR_005_ADMIN_RBAC.md) | A decisão: permissão é a unidade, cargo é agrupamento, o banco é a autoridade, e não há herança entre cargos. |

---

## Modding

| Documento | Sobre |
|---|---|
| [MODDING_GUIDELINES.md](MODDING_GUIDELINES.md) | Política de mods: regra de ouro, perfis, fases de QA, lista negra. |
| [MODPACK.md](MODPACK.md) | Composição do modpack. |
| [platform/MOD_DISTRIBUTION_POLICY.md](platform/MOD_DISTRIBUTION_POLICY.md) | Permissão de redistribuição, mod a mod. |
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
| [archive/README.md](archive/README.md) | Documentos que se autodeclaram superados — não deletados, preservados como registro histórico. |

---

## Convenções desta documentação

- **Português.** Termos técnicos consagrados ficam em inglês (`whitelist`, `commit`, `hash`).
- **Sobre o idioma:** existem **oito documentos traduzidos** para inglês, russo e espanhol — os três de entrada (`README`, `CONTRIBUTING`, `SECURITY`) e os cinco que barram um dev de fora (ver a tabela abaixo). Russo porque é a língua nativa da comunidade SkyMP (o upstream e o Red House são russos), espanhol pelo alcance na América Latina. Os demais documentos ficam **só em português** de propósito: são regras de RP, pesquisas, handoffs, rubricas de staff, backlog e decisões históricas — servem à operação deste servidor, não a quem chega de fora. Tradução desatualizada é pior que tradução ausente: é um texto em que as pessoas confiam e que mente em silêncio. Se algum documento específico bloquear alguém, traduzimos aquele sob demanda.
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
