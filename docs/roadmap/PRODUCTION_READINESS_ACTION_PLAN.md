# Plano de Ação — Alfa Fechada e Prontidão de Produção

> **Documento operacional vivo.** Este é o quadro principal para acompanhar a promoção do SkyMP Heavy RP de código em laboratório até uma alfa fechada confiável.
>
> **Baseline inicial:** 24/08/2026, `main` em `90dfbc9`.
> **Última atualização:** 24/08/2026.
> **Próxima revisão obrigatória:** ao concluir qualquer tarefa `P0`, ao mudar um gate de módulo ou ao terminar uma sessão com clientes reais.

---

## 1. Como usar este documento

Antes de começar uma tarefa:

1. Leia a tarefa, suas dependências e seu critério de aceite.
2. Confirme no código que o estado descrito aqui ainda é verdadeiro.
3. Mude o status para `EM ANDAMENTO` e registre responsável, branch e data.
4. Faça a menor mudança que satisfaça o critério.
5. Execute as verificações indicadas.
6. Registre a evidência: commit/PR, comando, log ou roteiro preenchido.
7. Só marque `[x]` quando **todo** o critério de aceite estiver comprovado.

Regras:

- Teste com `mp` mockado comprova `G1`, nunca `G2` ou `G3`.
- “O servidor subiu” não comprova login, spawn, CEF nem gameplay.
- Feature atrás de `ENABLE_*` continua `LAB` até ser exercitada com a flag ligada.
- Falha encontrada reabre a tarefa correspondente, mesmo que ela estivesse concluída.
- Migrations são MariaDB/MySQL e precisam manter `schema.sql` e a timeline versionada coerentes.
- Não reativar serviço `PARKED` por import direto; toda ativação passa pelo `module-registry`.

### Legenda de status

| Status | Significado |
|---|---|
| `TODO` | Não iniciado |
| `EM ANDAMENTO` | Trabalho ativo, ainda sem critério completo |
| `BLOQUEADO` | Depende de decisão, pessoa, credencial ou ambiente externo |
| `PARCIAL` | Parte existe, mas falta evidência ou integração indispensável |
| `CONCLUÍDO` | Critério de aceite comprovado e evidência registrada |
| `PARKED` | Fora do escopo atual por decisão explícita |

### Gates de maturidade

| Gate | Definição | Evidência mínima |
|---|---|---|
| `G0` | Implementado | Código presente e revisável |
| `G1` | Automatizado | Testes/checks locais verdes |
| `G2` | Runtime | Funciona contra servidor SkyMP real |
| `G3` | Multiplayer | Funciona com pelo menos dois clientes reais |
| `G4` | Staging | Sobrevive a restart, reconexão e falhas controladas |
| `G5` | Produção | Monitorado, reversível, documentado e liberado |

---

## 2. Meta da primeira entrega

### Definição de Alfa Fechada

A alfa está pronta quando 5–10 jogadores convidados conseguem, sem correção manual durante a sessão:

- instalar e reparar o cliente pelo launcher;
- autenticar pelo Discord;
- passar pela whitelist e receber a identidade correta;
- entrar, sair e reconectar;
- usar identidade, chat, painel e interação `[E]`;
- trocar itens e ouro sem duplicação ou perda;
- ficar `DOWNED`, ser socorridos ou sofrer bleed-out;
- participar de uma cena básica de governança;
- manter o estado após restart;
- produzir logs suficientes para explicar qualquer falha.

### Fora do escopo da primeira alfa

- clima e estações;
- magia institucional, vampirismo e licantropia;
- guerra territorial;
- economia regional simulada;
- housing e cavalos;
- integração com Mod Organizer 2;
- VOIP definitivo, se o fallback do Discord for necessário;
- mundo vivo com tick externo.

---

## 3. Dashboard executivo

| Fase | Objetivo | Status | Gate de saída | Dependência |
|---|---|---|---|---|
| F0 | Baseline e congelamento de escopo | `PARCIAL` | Escopo, versões e ambiente declarados | — |
| F1 | Remover bloqueadores do caminho crítico | `EM ANDAMENTO` | Login, UI instalada e checks limpos | F0 |
| F2 | Staging reproduzível | `TODO` | Stack completa + backup/restore | F1 |
| F3 | Primeira fatia multiplayer | `TODO` | Identidade/chat/painel com 2 clientes | F2 |
| F4 | Economia e inventário | `TODO` | Sem perda/duplicação sob concorrência | F3 |
| F5 | Morte e governança | `TODO` | Cena completa, durável e auditada | F4 |
| F6 | Loop econômico jogável | `TODO` | Cadeia Minerador→Ferreiro→Venda | F5 |
| F7 | Crime e proveniência | `TODO` | Roubo/restituição/confisco rastreáveis | F6 |
| F8 | Hardening | `TODO` | Segurança, métricas, rollback, assinatura | F7 |
| F9 | Alfa fechada | `TODO` | 2 semanas sem perda de dados | F8 |

### Baseline de verificação em 24/08/2026

- [x] Total atual: **1.348 testes de produto**, 0 falhas.
- [x] Gamemode: **1.151 testes**, 0 falhas.
- [x] Painel web: **46 testes**, 0 falhas.
- [x] Game API: **48 testes**, 0 falhas.
- [x] Bot Discord: **40 testes**, 0 falhas.
- [x] Launcher: **63 testes**, 0 falhas.
- [x] Registro de patches: **46 testes**, 0 falhas.
- [x] Checks de sistema: **13/13**.
- [x] Registro do gamemode: **70 testes listados**, nenhum órfão.
- [x] Schema declarado legível: **72 tabelas**.
- [x] Typecheck do launcher verde.
- [x] Typecheck do gamemode verde — os 2 erros da baseline foram corrigidos em 24/08/2026.
- [x] `check-write-guards --all` sem ocorrências — os 2 FormDesc e a cobertura de 13 migrations foram corrigidos em 24/08/2026.
- [ ] Sessão real com dois jogadores concluída.

---

## 4. F0 — Baseline e congelamento de escopo

### F0-001 — Congelar expansão até a fatia vertical

- [x] **Status:** `CONCLUÍDO`
- **Objetivo:** não iniciar mecânica nova antes de login, UI e multiplayer básico funcionarem.
- **Ações:** registrar a decisão no planejamento corrente e revisar qualquer nova proposta contra a seção “Fora do escopo”.
- **Aceite:** nenhuma tarefa fora de F0–F5 entra em execução sem desbloqueio explícito.
- **Evidência:** este plano define explicitamente a meta da alfa e a seção “Fora do escopo”; decisão registrada em 24/08/2026.

### F0-002 — Fixar versões reais do laboratório

- [ ] **Status:** `PARCIAL`
- **Já existe:** pin declarado do SkyMP `d85f18d8...`, Skyrim Steam 1.6.1170 e matriz de compatibilidade.
- **Já existe também:** `BUILD_INFO.json` local registra pin, versão do pacote e SHA-256 dos dois binários críticos; o instalador falha se um artefato declarar commit divergente.
- **Falta:** o artefato atual não declara o commit de origem (`commitVerified=false`); ainda é preciso gerar o próximo artefato com `upstreamCommit` e comprovar a versão real do SkyrimPlatform/SKSE dos testadores.
- **Aceite:** boot registra versões/pin; divergência relevante falha de modo explícito.
- **Evidência:** `Write-ServerBuildInfo.ps1` executado em 24/08/2026; hashes do servidor registrados e aviso explícito de commit não comprovado observado.

### F0-003 — Definir modpack mínimo da Fase 0

- [ ] **Status:** `PARCIAL`
- **Já existe:** `apps/game-api/plugins.fase0.txt` com os masters base.
- **Já existe também:** `mods.json` regenerado em SHA-256 a partir dos cinco masters em `skymp/data`, com load order de `plugins.fase0.txt`; a Game API recusa algoritmo legado, hash inválido e manifesto vazio.
- **Falta:** aprovar o manifesto em uma segunda instalação limpa e registrar a procedência/licença dos masters fora do repositório público.
- **Aceite:** manifesto produzido de uma pasta `Data` conhecida e aprovado pelo launcher em uma segunda instalação limpa.
- **Evidência:** cinco hashes SHA-256 gerados em 24/08/2026; suíte da Game API com 50 testes, incluindo o contrato fail-closed do manifesto.

---

## 5. F1 — Bloqueadores imediatos

### F1-001 — Resolver login real ponta a ponta (`P0`)

- [ ] **Status:** `BLOQUEADO NO AMBIENTE LOCAL`
- **Contexto:** o commit `90dfbc9` parou o mock da UI de esconder o erro de login, mas não resolveu sua causa raiz.
- **Dependências:** F0-002, credenciais Discord e ambiente SkyMP.
- **Ações:** coletar logs do launcher, painel, Game API, SkyMP e SkyrimPlatform; seguir ticket → fila → sessão → Master API → `profileId`.
- **Aceite:** login e reconexão mantêm o mesmo `accountId/profileId`; ticket consumido não é reutilizável; refresh da sessão do launcher emite ticket novo.
- **Teste de regressão:** obrigatório para a causa encontrada.
- **Evidência parcial (24/08/2026):** boot curto do SkyMP aprovou artefato/assets, carregou o gamemode e abriu TCP 3000/UDP 7777. A governança falhou porque MariaDB recusou 127.0.0.1:3306; o Master API recusou 127.0.0.1:3001. O serviço Windows `MariaDB` existe, mas está parado e esta sessão não possui permissão para iniciá-lo. Falta iniciar MariaDB com privilégio administrativo, subir o painel/Master API e executar o login com cliente real.

### F1-002 — Instalar e reparar automaticamente a UI CEF (`P0`)

- [ ] **Status:** `PARCIAL` (`G1` concluído; falta `G2`)
- **Contexto original:** `skymp/ui/` nunca era copiada para `Data/Platform/UI`; o setup documentava cópia manual.
- **Ações:** incluir UI no canal de distribuição; verificar hash; reparar ausência/divergência; bloquear `Jogar` com mensagem acionável se a UI obrigatória não estiver pronta.
- **Aceite:** instalação limpa recebe a UI sem cópia manual; apagar um arquivo dispara repair; CEF real carrega conteúdo não vazio.
- **Evidência:** sete arquivos incluídos em `resources/skymp-ui`; reparo SHA-256 automático antes da fila e botão manual em Configurações; build NSIS concluído com instalador de 104.838.607 bytes; testes cobrem instalação ausente, corrupção, idempotência, bundle inválido e ligação fail-closed. Falta observar o CEF real carregando conteúdo não vazio.

### F1-003 — Corrigir FormDesc de spawn (`P0`)

- [ ] **Status:** `PARCIAL` (`G1` concluído; falta `G2`)
- **Arquivos:** `governance-service.js` e `whitelist.js`.
- **Defeito:** `0x162e2` em vez de `162e2:Skyrim.esm`.
- **Aceite:** guard deixa de apontar as duas ocorrências; teste confere formato canônico; spawn/retorno é observado em runtime.
- **Evidência:** FormDesc alterado para `162e2:Skyrim.esm`; 2 regressões novas; `check-write-guards --all` limpo; suíte do gamemode com 1.151 testes. Observação do spawn real permanece pendente.

### F1-004 — Zerar o typecheck do gamemode (`P0`)

- [x] **Status:** `CONCLUÍDO`
- **Erros baseline:** `core/character-dashboard-bridge.js:41` e `core/depot-service.js:338`.
- **Aceite:** `npm run typecheck` encerra com código 0, sem filtro que esconda erro do projeto.
- **Evidência:** JSDoc corrigido em `character-dashboard-bridge.js` e `depot-service.js`; `npm run typecheck` encerra com código 0 em 24/08/2026.

### F1-005 — Limpar guardas de escrita prioritárias (`P0`)

- [x] **Status:** `CONCLUÍDO`
- **Baseline:** 15 ocorrências em `check-write-guards --all`; 13 são migrations sem teste direto.
- **Ações:** criar cobertura estática das migrations prioritárias, começando por v25 e pelas migrations alteradas no ciclo atual.
- **Aceite:** nenhuma ocorrência classificada como bloqueadora para nova escrita.
- **Evidência:** contratos mínimos adicionados para as 13 migrations sem cobertura direta; `node scripts/check-write-guards.js --all` retorna “OK: nenhuma armadilha conhecida encontrada.”; 29 testes do schema passam.

### F1-006 — Reconciliar documentação operacional (`P1`)

- [x] **Status:** `CONCLUÍDO`
- **Divergências conhecidas:** MD5 vs SHA-256; instruções que param em v9/v10; contagem antiga de opções ligadas; `version-check.js` descrito como ativo sem chamador.
- **Aceite:** README, setup, modpack, operações e compatibilidade não contradizem o código atual.
- **Evidência:** guias operacionais e suas traduções reconciliados com SHA-256, migrations disponíveis até v25, 17 opções ligadas e `version-check.js` sem chamador; o check de schema agora informa dinamicamente a última migration; 34 testes focados, 61 do launcher, typecheck e inventário de 72 tabelas aprovados em 24/08/2026.

### F1-007 — Decidir e implementar a checagem de versão do cliente (`P1`)

- [x] **Status:** `CONCLUÍDO`
- **Contexto original:** `version-check.js` existia sem importador e conflitava conceitualmente com a versão própria do launcher (`0.0.0`).
- **Aceite:** existe uma única fonte de versão e um gate real, ou o código morto é removido com decisão documentada.
- **Evidência:** `clientVersion` do manifesto de distribuição é a fonte do cliente; o fluxo JOGAR falha fechado antes da fila quando o manifesto não pode ser validado ou há atualização; `version-check.js` morto foi removido; dois testes de contrato protegem ordem e fail-closed.

### Gate F1

- [ ] Login real concluído.
- [ ] UI CEF instalada automaticamente e visível em jogo.
- [x] UI CEF empacotada e reparada automaticamente pelo launcher.
- [ ] Manifesto SHA-256 real aprovado.
- [x] Gate de versão do cliente ativo antes da fila.
- [x] Typecheck do gamemode verde.
- [x] Nenhum bloqueador de escrita conhecido.

---

## 6. F2 — Staging reproduzível

### F2-001 — Criar stack de staging

- [ ] **Status:** `TODO`
- **Serviços:** MariaDB, painel, bot, Game API, SkyMP e launcher.
- **Aceite:** um procedimento versionado sobe a stack; health checks confirmam cada serviço; `offlineMode=false`.
- **Evidência:** _preencher_.

### F2-002 — Migrar banco limpo até v25

- [ ] **Status:** `TODO`
- **Aceite:** instalação vazia aplica schema + migrations em ordem; `npm run check:schema` não encontra faltas.
- **Evidência:** _preencher saída do check + versão MariaDB_.

### F2-003 — Backup e restore exercitados

- [ ] **Status:** `TODO`
- **Aceite:** backup restaurado em banco vazio permite login e leitura do personagem de teste.
- **Evidência:** _preencher data, duração, comandos e resultado_.

### F2-004 — Persistir sessões web

- [ ] **Status:** `TODO`
- **Contexto:** `express-session` usa a store padrão em memória.
- **Aceite:** sessão sobrevive a restart controlado e funciona com a arquitetura prevista de staging.
- **Evidência:** _preencher_.

### F2-005 — Segredos e TLS

- [ ] **Status:** `TODO`
- **Aceite:** nenhum placeholder; segredos separados por ambiente; serviços públicos usam TLS; rotação documentada.
- **Evidência:** _preencher sem copiar segredo_.

### Gate F2

- [ ] Stack sobe de modo reproduzível.
- [ ] Schema real alinhado.
- [ ] Backup/restore comprovado.
- [ ] Procedimento de rollback escrito antes do primeiro teste multiplayer.

---

## 7. F3 — Primeira fatia multiplayer

Flags candidatas desta fase: Interaction Framework, Player Panel, Interaction Prompt e Player Shortcuts. Ligar apenas as dependências necessárias.

### F3-001 — Dois clientes conectados

- [ ] **Status:** `TODO`
- **Aceite:** dois jogadores autenticados entram na mesma célula e permanecem conectados por 30 minutos.
- **Evidência:** _preencher roteiro/log_.

### F3-002 — Identidade contextual

- [ ] **Status:** `TODO`
- **Aceite:** desconhecido → apresentação → nome conhecido → alias; tudo persiste após reconexão e não vaza nome civil.
- **Evidência:** _preencher_.

### F3-003 — Chat por proximidade

- [ ] **Status:** `TODO`
- **Aceite:** local, sussurro e grito respeitam célula/alcance; flood é limitado; logs não vazam dados indevidos.
- **Evidência:** _preencher_.

### F3-004 — Painel e atalhos

- [ ] **Status:** `TODO`
- **Aceite:** `/painel`, F2, abas e refresh funcionam dentro da CEF real; fechar/reabrir não prende foco ou movimento.
- **Evidência:** _preencher_.

### F3-005 — Interaction Framework `[E]`

- [ ] **Status:** `TODO`
- **Aceite:** alvo correto, distância validada no servidor, ação some quando não autorizada e payload forjado é recusado.
- **Evidência:** _preencher_.

### F3-006 — Desconexão, reconexão e restart

- [ ] **Status:** `TODO`
- **Aceite:** caches de personagem/staff são removidos; identidade e estado durável retornam; resposta antiga de whitelist não afeta reconexão.
- **Evidência:** _preencher_.

### Gate F3

- [ ] Roteiro completo com dois clientes.
- [ ] Nenhum erro silencioso da CEF.
- [ ] Nenhum vazamento de identidade.
- [ ] Métricas básicas de login, CEF, CPU e memória registradas.

---

## 8. F4 — Economia e inventário

Ordem de promoção: Economy Physical Sync → Trade → Market Stalls → Depot.

### F4-001 — Economia concorrente em MariaDB real

- [ ] **Status:** `TODO`
- **Aceite:** saldo insuficiente, retry idempotente, duas transferências simultâneas, rollback e auditoria de valor alto comprovados.
- **Evidência:** _preencher_.

### F4-002 — Inventário e projeção no cliente

- [ ] **Status:** `TODO`
- **Aceite:** banco é autoridade; reconexão converge inventário; falha após commit não duplica nem perde item.
- **Evidência:** _preencher_.

### F4-003 — Trade com dois jogadores

- [ ] **Status:** `TODO`
- **Aceite:** convite, ofertas, confirmação bilateral, cancelamento, timeout e desconexão sem item em limbo.
- **Evidência:** _preencher_.

### F4-004 — Barracas concorrentes

- [ ] **Status:** `TODO`
- **Aceite:** duas compras do último item resultam em uma venda; retry não cobra duas vezes; imposto e vendedor recebem exatamente o devido.
- **Evidência:** _preencher_.

### F4-005 — Depot regional

- [ ] **Status:** `TODO`
- **Aceite:** capacidade, hold, depósito/retirada concorrentes e terminal físico real validados.
- **Evidência:** _preencher_.

### Gate F4

- [ ] Nenhum ouro duplicado ou perdido.
- [ ] Nenhum item duplicado ou perdido.
- [ ] Todo movimento valioso possui ledger/auditoria.

---

## 9. F5 — Morte e governança

### F5-001 — Confirmar `mp.onDeath` e reduzir polling

- [ ] **Status:** `TODO`
- **Aceite:** hook real dispara, bloqueia respawn nativo e produz `DOWNED`; polling é removido ou reduzido com justificativa medida.
- **Evidência:** _preencher_.

### F5-002 — Socorro, bleed-out e restart

- [ ] **Status:** `TODO`
- **Aceite:** `/socorrer` e `[E]`; bleed-out; penalidade; desconexão/restart durante `DOWNED`; sem duplicação de consequência.
- **Evidência:** _preencher_.

### F5-003 — Permadeath administrativo

- [ ] **Status:** `TODO`
- **Aceite:** motivo obrigatório, permissão correta, soft-delete, auditoria e impossibilidade de respawn/aprovação acidental.
- **Evidência:** _preencher_.

### F5-004 — Cena completa de governança

- [ ] **Status:** `TODO`
- **Fluxo:** plantão → abordagem → revista → mandado/multa → prisão → liberação.
- **Aceite:** escopo, distância, consentimento e estados duráveis revalidados; toda ação forte auditada.
- **Evidência:** _preencher_.

### Gate F5

- [ ] Cena completa com dois jogadores e um guarda.
- [ ] Estados de morte/custódia sobrevivem a restart.
- [ ] Autoridade vem do servidor, nunca do payload cliente.

---

## 10. F6 — Primeiro loop econômico jogável

Loop alvo: **Minerador → Depot → Fundidor → Ferreiro → item assinado → barraca/contrato**.

### F6-001 — Resource Node Framework mínimo

- [ ] **Status:** `TODO`
- **Aceite:** node físico confirmado, cooldown autoritativo, recompensa via Inventory Framework e defesa contra repetição.
- **Evidência:** _preencher_.

### F6-002 — Integrar Jobs ao Profession Core

- [ ] **Status:** `TODO`
- **Aceite:** profissão/rank influenciam o loop por regra documentada; FormID provisório da pesca removido ou a pesca fica fora da alfa.
- **Evidência:** _preencher_.

### F6-003 — Integrar Profissão ao Depot

- [ ] **Status:** `TODO`
- **Aceite:** regra “rank acessa recurso raro” implementada sem bloquear funcionalidades gerais não relacionadas.
- **Evidência:** _preencher_.

### F6-004 — Fechar Crafting real

- [ ] **Status:** `TODO`
- **Aceite:** proximidade da estação, decisão sobre `requires_perk`, receitas com FormIDs confirmados, XP e assinatura do artesão.
- **Evidência:** _preencher_.

### F6-005 — Contratos como saída do loop

- [ ] **Status:** `TODO`
- **Aceite:** publicação, escrow, entrega, revisão, disputa e acerto exercitados por jogadores reais.
- **Evidência:** _preencher_.

### Gate F6

- [ ] Cadeia exige cooperação entre personagens.
- [ ] Produção e consumo por hora são mensuráveis.
- [ ] Nenhuma profissão cria ciclo autossuficiente ou dinheiro infinito.

---

## 11. F7 — Crime e proveniência

### F7-001 — Roubo e item `hot`

- [ ] **Status:** `TODO`
- **Aceite:** item fungível vira instância UUID; dono original não muda; roubo exige alvo vulnerável.
- **Evidência:** _preencher_.

### F7-002 — Combat-log e restituição

- [ ] **Status:** `TODO`
- **Aceite:** logout cria alerta; grace period funciona; restituição via depot não duplica nem some com item.
- **Evidência:** _preencher_.

### F7-003 — Revista e confisco institucionais

- [ ] **Status:** `TODO`
- **Aceite:** guarda vê proveniência como evidência, não culpa automática; confisco preserva estado roubado.
- **Evidência:** _preencher_.

### Gate F7

- [ ] Cadeia de posse reconstruível.
- [ ] Restart durante janela `hot` não perde contexto.
- [ ] Crime, governança e depot convergem.

---

## 12. F8 — Hardening

### F8-001 — Segurança dos serviços públicos

- [ ] **Status:** `TODO`
- **Aceite:** rate limits, replay, CORS/proxy, sessões, segredo interno, uploads e updates revisados e testados.
- **Evidência:** _preencher relatório_.

### F8-002 — Observabilidade

- [ ] **Status:** `TODO`
- **Métricas mínimas:** conexões, falhas de login, latência DB, eventos CEF, rejeições, transferências, reconciliações, polling, CPU e memória.
- **Aceite:** incidente de teste pode ser explicado por logs/métricas sem reproduzir localmente.
- **Evidência:** _preencher_.

### F8-003 — Rollback exercitado

- [ ] **Status:** `TODO`
- **Aceite:** rollback de gamemode, launcher/modpack e banco documentado e executado em staging.
- **Evidência:** _preencher_.

### F8-004 — Assinar e testar o launcher

- [ ] **Status:** `BLOQUEADO`
- **Bloqueio:** certificado/serviço de assinatura ainda não adquirido.
- **Aceite:** assinatura válida e timestamp; instalação testada em Windows limpo; comportamento do SmartScreen registrado.
- **Evidência:** _preencher_.

### F8-005 — Sessão de soak test

- [ ] **Status:** `TODO`
- **Aceite:** 6–8 horas com 5–10 jogadores, sem perda/duplicação, com relatório de carga e incidentes.
- **Evidência:** _preencher_.

---

## 13. F9 — Alfa fechada

### F9-001 — Preparar operação

- [ ] **Status:** `TODO`
- **Aceite:** calendário, janela de manutenção, canal de incidentes, responsáveis, backup pré-release e rollback definidos.
- **Evidência:** _preencher_.

### F9-002 — Operar por duas semanas

- [ ] **Status:** `TODO`
- **Aceite:** 10–20 jogadores convidados; duas semanas sem perda de dados; incidentes registrados; economia revisada semanalmente.
- **Evidência:** _preencher relatório final_.

### F9-003 — Decisão de abertura

- [ ] **Status:** `TODO`
- **Aceite:** revisão explícita `GO`, `GO COM RESTRIÇÕES` ou `NO-GO`, baseada nos gates e incidentes, não em percepção informal.
- **Evidência:** _preencher decisão e responsáveis_.

---

## 14. Backlog pós-alfa

| Item | Estado | Condição para entrar |
|---|---|---|
| Clima e estações | `PROJETO` | F9 concluída + orçamento de performance |
| Voz definitiva/LiveKit | `POC` | Transporte, captura e capacidade homologados |
| Housing | `PARKED` | Economia e objetos físicos estáveis |
| Cavalos | `PARKED` | Política de atores/polling medida |
| Economia regional | `PARKED` | Loop econômico real com telemetria |
| Dívidas | `PARKED` | Contratos operados em alfa |
| Disfarce | `PROJETO` | Identidade/nametag homologadas |
| Magia institucional | `PROJETO` | Soul + economia + governança estáveis |
| Vampirismo/licantropia | `PROJETO` | Estado autoritativo e conteúdo aprovados |
| Mundo vivo/tick externo | `PROJETO` | Staging e observabilidade maduros |
| MO2 | `PESQUISA` | SkyrimPlatform comprovado sob USVFS |

---

## 15. Registro de execução

Adicionar uma linha a cada mudança de status relevante.

| Data | Tarefa | De → Para | Evidência | Observação |
|---|---|---|---|---|
| 24/08/2026 | Baseline | — → registrado | 1.331 testes de produto; 46 de patches; 13/13 checks | Documento criado a partir da auditoria geral do repositório |
| 24/08/2026 | F0-001 | `TODO` → `CONCLUÍDO` | Meta e fora de escopo registrados neste plano | Expansão deve aguardar a fatia vertical |
| 24/08/2026 | F1-003 | `TODO` → `PARCIAL` | 2 testes novos; guard limpo | Código em G1; spawn real ainda precisa de G2 |
| 24/08/2026 | F1-004 | `TODO` → `CONCLUÍDO` | `npm run typecheck` = 0 | Dois erros JSDoc corrigidos |
| 24/08/2026 | F1-005 | `TODO` → `CONCLUÍDO` | 13 contratos de migration; guard = 0 | Dívida histórica quitada |
| 24/08/2026 | F1-006 | `TODO` → `CONCLUÍDO` | Docs reconciliados; 34 testes focados; launcher 61/61; schema 72 tabelas | Versões futuras do check de schema não dependem de texto fixo |
| 24/08/2026 | F1-007 | `TODO` → `CONCLUÍDO` | Gate fail-closed no fluxo JOGAR; 2 testes; código morto removido | Cliente e launcher têm fontes de versão distintas e explícitas |
| 24/08/2026 | Verificação F1 | — → atualizada | 1.348 testes de produto; 46 de patches; 13/13 checks; guards limpos | Todas as suítes automatizadas disponíveis estão verdes |
| 24/08/2026 | F1-001 | `EM ANDAMENTO` → `BLOQUEADO NO AMBIENTE LOCAL` | SkyMP carregou; TCP 3000 e UDP 7777; MariaDB 3306 e Master API 3001 recusaram | MariaDB está parado e exige privilégio administrativo para iniciar |
| 24/08/2026 | F0-002 | `PARCIAL` → `PARCIAL` | `BUILD_INFO.json` com pin e hashes; `commitVerified=false` | Identidade reproduzível criada; commit do artefato atual continua não comprovado |
| 24/08/2026 | F0-003 | `PARCIAL` → `PARCIAL` | Manifesto SHA-256 dos cinco masters; Game API fail-closed | Falta validar em segunda instalação limpa |
| 24/08/2026 | F1-002 | `TODO` → `PARCIAL` | UI embutida; reparo automático; build NSIS aprovado | Código em G1; renderização CEF real permanece G2 |

---

## 16. Checklist de atualização deste documento

- [ ] Status e checkbox contam a mesma história.
- [ ] Toda conclusão possui evidência.
- [ ] Gate do módulo foi atualizado no dashboard.
- [ ] Dependências desbloqueadas foram revisadas.
- [ ] Novo risco ganhou tarefa ou justificativa explícita.
- [ ] Mudança de comportamento atualizou documentação técnica relacionada.
- [ ] Se houve teste real, o roteiro/log da sessão foi anexado ou referenciado.
