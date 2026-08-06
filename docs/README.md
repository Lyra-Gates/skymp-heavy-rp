# Documentação

Mapa dos documentos do projeto. Se você acabou de chegar, leia na ordem da primeira seção.

---

## Comece por aqui

| # | Documento | Por quê |
|---|---|---|
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
| [SERVER_OPTIONS_SCHEMA.md](technical/SERVER_OPTIONS_SCHEMA.md) | Opções de gameplay — **e quais delas realmente fazem efeito hoje**. |

### Distribuição e publicação

| Documento | Sobre |
|---|---|
| [LAUNCHER_DISTRIBUTION.md](technical/LAUNCHER_DISTRIBUTION.md) | Como cliente e modpack chegam ao jogador, e como a paridade é verificada. |
| [PUBLIC_BUILD_GUIDE.md](technical/PUBLIC_BUILD_GUIDE.md) | O que precisa estar verdadeiro antes de publicar a build pra comunidade. |
| [LICENSE_AND_AFFILIATION_POLICY.md](technical/LICENSE_AND_AFFILIATION_POLICY.md) | Licenças do SkyMP por subprojeto, o que cada situação obriga, e não-afiliação. |
| [VOICE_CLIENT_PATCH.md](technical/VOICE_CLIENT_PATCH.md) | Runbook do patch de client que o VOIP nativo precisa e que não existe upstream. |

### Decisões tomadas

| Documento | Decisão |
|---|---|
| [PARKED_SERVICES_DECISION.md](technical/PARKED_SERVICES_DECISION.md) | Quais serviços estacionados foram apagados e por quê. |
| [NPC_POLICY_DECISION.md](technical/NPC_POLICY_DECISION.md) | Como lidar com NPCs vanilla num servidor Heavy RP. |
| [NAMETAG_IDENTITY_SYSTEM.md](technical/NAMETAG_IDENTITY_SYSTEM.md) | Por que o nome exibido depende de quem está olhando. |
| [MARKET_STALL_VISUAL_ASSET_PLAN.md](technical/MARKET_STALL_VISUAL_ASSET_PLAN.md) | Assets visuais das barracas, com análise de licença mod a mod. |

### Estudos de referência

| Documento | Fonte |
|---|---|
| [REFERENCE_STUDY_SKYMP_RED_HOUSE.md](technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md) | O único gamemode RP público que existe (GPL-3.0, parado em 2021). A §4.1 é leitura do código-fonte. |

### Planejamento

| Documento | Sobre |
|---|---|
| [HEAVY_RP_GAMEPLAY_SYSTEMS_BACKLOG.md](technical/HEAVY_RP_GAMEPLAY_SYSTEMS_BACKLOG.md) | Backlog de sistemas de gameplay. |
| [GOVERNANCE_MARKET_STALLS_TEST_PLAN.md](technical/GOVERNANCE_MARKET_STALLS_TEST_PLAN.md) | Plano de teste in-game em camadas. **É o próximo bloqueio real do projeto.** |

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
| [roadmap/PHASE_0_TEST_LOG.md](roadmap/PHASE_0_TEST_LOG.md) | Evidências dos testes da Fase 0. |

---

## Convenções desta documentação

- **Português.** Termos técnicos consagrados ficam em inglês (`whitelist`, `commit`, `hash`).
- **Sobre o idioma:** os documentos de entrada (`README`, `CONTRIBUTING`, `SECURITY`) são mantidos em português e inglês. A documentação técnica profunda fica **só em português**, de propósito: são muitos arquivos que mudam com frequência, e tradução desatualizada é pior que tradução ausente — é um texto em que as pessoas confiam e que mente em silêncio. Se algum documento específico bloquear alguém, traduzimos aquele sob demanda.
- **Diga o que não funciona.** Documento que só descreve o caminho feliz vira mentira com o tempo. Quando algo está incompleto, o texto diz — e vários avisos aqui existem porque a documentação antiga afirmava coisas que o código nunca fez.
- **Marque a procedência.** Ao afirmar algo sobre o SkyMP, diga se veio da documentação oficial, de teste real ou de leitura de código. As três têm confiabilidades diferentes.
- **Ao mudar comportamento, atualize o documento no mesmo PR.** Documentação desatualizada custa mais caro que documentação ausente: ela é confiada.
