# Plano de Ação — Alfa Fechada e Prontidão de Produção

> **Documento operacional vivo.** Este é o quadro principal para acompanhar a promoção do SkyMP Heavy RP de código em laboratório até uma alfa fechada confiável.
>
> **Baseline inicial:** 24/08/2026, `main` em `90dfbc9`.
> **Última atualização:** 26/08/2026. Revisão local parcial: gamemode, migrations
> e schema; totais dos demais produtos não foram reexecutados.
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
| F1 | Remover bloqueadores do caminho crítico | `PARCIAL` | Login, UI instalada e checks limpos | F0 |
| F2 | Staging reproduzível | `PARCIAL` | Stack completa + backup/restore | F1 |
| F3 | Primeira fatia multiplayer | `PARCIAL` | Identidade/chat/painel com 2 clientes | F2 |
| F4 | Economia e inventário | `PARCIAL` | Sem perda/duplicação sob concorrência | F3 |
| F5 | Morte e governança | `PARCIAL` | Cena completa, durável e auditada | F4 |
| F6 | Loop econômico jogável | `PARCIAL` | Cadeia Minerador→Ferreiro→Venda | F5 |
| F7 | Crime e proveniência | `PARCIAL` | Roubo/restituição/confisco rastreáveis | F6 |
| F8 | Hardening | `PARCIAL` | Segurança, métricas, rollback, assinatura | F7 |
| F9 | Alfa fechada | `BLOQUEADO — NO-GO` | 2 semanas sem perda de dados | F8 |

### Baseline de verificação em 26/08/2026

- [ ] Total agregado de testes de produto: o número **1.457** pertence ao
  snapshot de 24/08 e não foi recalculado nesta revisão.
- [ ] Gamemode: **1.262 testes; 1.261 aprovados e 1 falha conhecida** (`work`
  ausente da allowlist de Safe Zones).
- [x] Painel web: **59 testes**, 0 falhas.
- [x] Game API: **50 testes**, 0 falhas.
- [x] Bot Discord: **45 testes**, 0 falhas.
- [x] Launcher: **70 testes**, 0 falhas.
- [x] Registro de patches: **46 testes**, 0 falhas.
- [x] Checks de sistema: **14/14**.
- [x] Schema declarado legível: **80 tabelas**, migrations até **v29**.
- [x] Migration dry-run: **27 arquivos, 162 instruções**, sem conexão ao banco.
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
- **Evidência parcial (24–26/08/2026):** boot curto do SkyMP aprovou artefato/assets, carregou o gamemode e abriu TCP 3000/UDP 7777. A governança falhou porque MariaDB recusou 127.0.0.1:3306; o Master API recusou 127.0.0.1:3001. Em 26/08, o bootstrap do launcher passou a validar/reler os dois contratos, remover identidade legada, gravar `server-info-ignore:true` e só confirmar o SKSE após `spawn` + PID; 15 testes novos, launcher 85/85 e build NSIS aprovado ([ADR-012](../technical/ADR_012_LAUNCHER_CONNECTION_BOOTSTRAP.md)). Isso fecha a preparação local, não o aceite de F1-001. Falta executar em outra máquina/ambiente com MariaDB, subir o painel/Master API e realizar login/reconexão com dois clientes pelo botão JOGAR.

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
- **Evidência:** guias operacionais e suas traduções reconciliados com SHA-256; migrations disponíveis até v29; o check de schema informa dinamicamente a última migration; inventário local atual de 80 tabelas conferido em 26/08/2026. A aplicação no banco continua pendente.

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

- [ ] **Status:** `PARCIAL` (stack versionada e validada estaticamente; daemon/credenciais ausentes)
- **Serviços:** MariaDB, painel, bot, Game API, SkyMP e launcher.
- **Aceite:** um procedimento versionado sobe a stack; health checks confirmam cada serviço; `offlineMode=false`.
- **Evidência:** `deploy/staging/compose.yaml`, `Start-Staging.ps1`, `Stop-Staging.ps1` e README; Compose validado por `docker compose config`; painel, Game API, bot e MariaDB têm health checks. SkyMP/launcher ficam no host Windows. Docker CLI 29.6.2 presente, Engine indisponível em 24/08/2026, então o boot real segue pendente.

### F2-002 — Migrar banco limpo até v29

- [ ] **Status:** `PARCIAL` (aplicador seguro e dry-run concluídos; execução real depende de MariaDB)
- **Aceite:** instalação vazia aplica schema + migrations em ordem; `npm run check:schema` não encontra faltas.
- **Evidência:** `npm run migrate:dry-run` encontra 27 arquivos/162 instruções em ordem até v29; os testes cobrem ordenação, banco não vazio, nome divergente, configuração por ambiente, execução sequencial e erro sem vazamento. Falta executar `migrate:clean` + `check:schema` em MariaDB real e registrar a versão.

### F2-003 — Backup e restore exercitados

- [ ] **Status:** `PARCIAL` (scripts/runbook implementados; exercício depende da staging ativa)
- **Aceite:** backup restaurado em banco vazio permite login e leitura do personagem de teste.
- **Evidência:** `Backup-Staging.ps1` cria dump consistente comprimido + SHA-256; `Restore-Staging.ps1` valida caminho/hash, exige confirmação, para escritores, restaura e exige schema estrito antes de reiniciar. [`ROLLBACK_RUNBOOK.md`](../operations/ROLLBACK_RUNBOOK.md). Falta exercício real e leitura do personagem.

### F2-004 — Persistir sessões web

- [ ] **Status:** `PARCIAL` (store e migration implementadas; restart real depende de MariaDB)
- **Contexto:** `express-session` usa a store padrão em memória.
- **Aceite:** sessão sobrevive a restart controlado e funciona com a arquitetura prevista de staging.
- **Evidência:** `apps/web/mysqlSessionStore.js`; `migration-v26-web-sessions.sql`; 5 testes sem banco cobrem get/set/touch/destroy/poda, expiração, SQL parametrizado e JSON inválido. Falta aplicar v26 e testar restart/duas instâncias em staging.

### F2-005 — Segredos e TLS

- [ ] **Status:** `PARCIAL` (`auditor implementado; ambiente ainda não aprovado`)
- **Aceite:** nenhum placeholder; segredos separados por ambiente; serviços públicos usam TLS; rotação documentada.
- **Evidência:** `scripts/check-production-config.js` valida sem imprimir valores e possui 6 testes no CI. Execução local com `--skip-db` encontrou pendências nomeadas em credenciais Discord, URLs HTTPS, `NODE_ENV`, `TRUST_PROXY` e repositório de distribuição; nenhuma foi mascarada como pronta.

### Gate F2

- [ ] Stack sobe de modo reproduzível.
- [ ] Schema real alinhado.
- [ ] Backup/restore comprovado.
- [ ] Procedimento de rollback escrito antes do primeiro teste multiplayer.

---

## 7. F3 — Primeira fatia multiplayer

Flags candidatas desta fase: Interaction Framework, Player Panel, Interaction Prompt e Player Shortcuts. Ligar apenas as dependências necessárias.

### F3-001 — Dois clientes conectados

- [ ] **Status:** `BLOQUEADO PELO RUNTIME EXTERNO`
- **Aceite:** dois jogadores autenticados entram na mesma célula e permanecem conectados por 30 minutos.
- **Evidência:** requer dois clientes Skyrim autenticados e 30 minutos de sessão; não é reproduzível apenas com Node e sem MariaDB. Roteiro preservado para staging.

### F3-002 — Identidade contextual

- [ ] **Status:** `PARCIAL — domínio/testes prontos; persistência real pendente`
- **Aceite:** desconhecido → apresentação → nome conhecido → alias; tudo persiste após reconexão e não vaza nome civil.
- **Evidência:** `identity-service.test.js` e `identity-staff-reveal.test.js` cobrem apresentação, alias, desconhecido e firewall de identidade; reconexão com MariaDB/jogo continua pendente.

### F3-003 — Chat por proximidade

- [ ] **Status:** `PARCIAL — regras automatizadas; dois clientes pendentes`
- **Aceite:** local, sussurro e grito respeitam célula/alcance; flood é limitado; logs não vazam dados indevidos.
- **Evidência:** `rp-chat-service.test.js` cobre alcance, célula, modos e flood; falta confirmar entrega/visual/log em dois clientes reais.

### F3-004 — Painel e atalhos

- [ ] **Status:** `PARCIAL — bridge e CEF testados fora do jogo`
- **Aceite:** `/painel`, F2, abas e refresh funcionam dentro da CEF real; fechar/reabrir não prende foco ou movimento.
- **Evidência:** `player-panel-service.test.js`, `player-shortcuts-service.test.js` e `character-dashboard-bridge.test.js`; foco/movimento e renderização exigem CEF real.

### F3-005 — Interaction Framework `[E]`

- [ ] **Status:** `PARCIAL — pipeline autoritativo coberto; runtime `[E]` pendente`
- **Aceite:** alvo correto, distância validada no servidor, ação some quando não autorizada e payload forjado é recusado.
- **Evidência:** `interaction-*` testa alvo, schema, permissão, política, distância, dedupe e payload forjado; `ui-event-gateway` usa o bridge real documentado, ainda sem sessão in-game.

### F3-006 — Desconexão, reconexão e restart

- [ ] **Status:** `PARCIAL — limpeza e corrida cobertas; restart real pendente`
- **Aceite:** caches de personagem/staff são removidos; identidade e estado durável retornam; resposta antiga de whitelist não afeta reconexão.
- **Evidência:** testes de `commands`, admin, trade, soul, VOIP e `connection-monitor` cobrem limpeza por `characterId` e invalidam resposta antiga; estado durável/restart exige MariaDB.

### Gate F3

- [ ] Roteiro completo com dois clientes.
- [ ] Nenhum erro silencioso da CEF.
- [ ] Nenhum vazamento de identidade.
- [ ] Métricas básicas de login, CEF, CPU e memória registradas.

---

## 8. F4 — Economia e inventário

Ordem de promoção: Economy Physical Sync → Trade → Market Stalls → Depot.

### F4-001 — Economia concorrente em MariaDB real

- [ ] **Status:** `PARCIAL — contratos transacionais em mock; concorrência real bloqueada`
- **Aceite:** saldo insuficiente, retry idempotente, duas transferências simultâneas, rollback e auditoria de valor alto comprovados.
- **Evidência:** `economy-service`, tesouro e mercado regional cobrem saldo, idempotência, rollback e auditoria; `SELECT ... FOR UPDATE` só será provado sob duas conexões MariaDB.

### F4-002 — Inventário e projeção no cliente

- [ ] **Status:** `PARCIAL — autoridade/ledger cobertos; projeção real pendente`
- **Aceite:** banco é autoridade; reconexão converge inventário; falha após commit não duplica nem perde item.
- **Evidência:** `core/inventory.test.js` e `transaction-service.test.js` cobrem conservação, ledger, rollback e pós-commit; reconexão contra cliente real não executada.

### F4-003 — Trade com dois jogadores

- [ ] **Status:** `PARCIAL — fluxo completo automatizado; dois jogadores pendentes`
- **Aceite:** convite, ofertas, confirmação bilateral, cancelamento, timeout e desconexão sem item em limbo.
- **Evidência:** `trade-service.test.js` cobre convite, ofertas, confirmação bilateral, commit atômico, distância, cancelamento, TTL e desconexão.

### F4-004 — Barracas concorrentes

- [ ] **Status:** `PARCIAL — concorrência lógica e idempotência cobertas; MariaDB pendente`
- **Aceite:** duas compras do último item resultam em uma venda; retry não cobra duas vezes; imposto e vendedor recebem exatamente o devido.
- **Evidência:** suítes `market-stalls-*` cobrem última unidade, retry, imposto, vendedor, permissões e interações; falta disputa simultânea em InnoDB/jogo.

### F4-005 — Depot regional

- [ ] **Status:** `PARCIAL — domínio e interação cobertos; terminal físico/DB pendentes`
- **Aceite:** capacidade, hold, depósito/retirada concorrentes e terminal físico real validados.
- **Evidência:** `core/depot-service.test.js` cobre hold, capacidade, depósito/retirada atômicos e isolamento regional; terminal real e concorrência MariaDB não executados.

### Gate F4

- [ ] Nenhum ouro duplicado ou perdido.
- [ ] Nenhum item duplicado ou perdido.
- [ ] Todo movimento valioso possui ledger/auditoria.

---

## 9. F5 — Morte e governança

### F5-001 — Confirmar `mp.onDeath` e reduzir polling

- [ ] **Status:** `PARCIAL — barramento/hook cobertos; evento SkyMP real pendente`
- **Aceite:** hook real dispara, bloqueia respawn nativo e produz `DOWNED`; polling é removido ou reduzido com justificativa medida.
- **Evidência:** `death-events.test.js` prova posse única do hook, múltiplos assinantes e bloqueio do respawn; confirmação do callback nativo e medição do polling exigem jogo.

### F5-002 — Socorro, bleed-out e restart

- [ ] **Status:** `PARCIAL — estados e consequências testados; restart pendente`
- **Aceite:** `/socorrer` e `[E]`; bleed-out; penalidade; desconexão/restart durante `DOWNED`; sem duplicação de consequência.
- **Evidência:** `death-service.test.js` cobre `DOWNED`, socorro por comando/`[E]`, bleed-out, penalidade, hijack de slot e dedupe; restart em MariaDB não executado.

### F5-003 — Permadeath administrativo

- [x] **Status:** `CONCLUÍDO NO CÓDIGO — runtime coberto pelo gate F5`
- **Aceite:** motivo obrigatório, permissão correta, soft-delete, auditoria e impossibilidade de respawn/aprovação acidental.
- **Evidência:** `admin-service.test.js` exige capability e motivo, usa soft-delete, audita e limpa sessão; whitelist/seleção recusam personagem aposentado.

### F5-004 — Cena completa de governança

- [ ] **Status:** `PARCIAL — ações isoladas/integradas testadas; cena real pendente`
- **Fluxo:** plantão → abordagem → revista → mandado/multa → prisão → liberação.
- **Aceite:** escopo, distância, consentimento e estados duráveis revalidados; toda ação forte auditada.
- **Evidência:** `governance-service*`, busca e integrações de crime/crafting cobrem plantão, escopo, consentimento, distância e ações persistentes; falta executar a cena com dois jogadores e guarda.

### Gate F5

- [ ] Cena completa com dois jogadores e um guarda.
- [ ] Estados de morte/custódia sobrevivem a restart.
- [ ] Autoridade vem do servidor, nunca do payload cliente.

---

## 10. F6 — Primeiro loop econômico jogável

Loop alvo: **Minerador → Depot → Fundidor → Ferreiro → item assinado → barraca/contrato**.

### F6-001 — Resource Node Framework mínimo

- [ ] **Status:** `PARCIAL — motor implementado e testado; nó físico ainda exige homologação no jogo`
- **Aceite:** node físico confirmado, cooldown autoritativo, recompensa via Inventory Framework e defesa contra repetição.
- **Evidência:** `resource-node-service.js`, `mining-service.js`, migration v27 e 71 testes focados cobrem capacidade/regeneração, `SELECT ... FOR UPDATE`, recompensa atômica, profissão/rank, cooldown persistente e replay por `requestId`. Falta confirmar um objeto físico, alcance e Papyrus no Skyrim/SkyMP real.

### F6-002 — Integrar Jobs ao Profession Core

- [x] **Status:** `CONCLUÍDO NO CÓDIGO — runtime coberto pelo gate F6`
- **Aceite:** profissão/rank influenciam o loop por regra documentada; FormID provisório da pesca removido ou a pesca fica fora da alfa.
- **Evidência:** Minerador é o único builtin com `gameplayImplemented=true`; nó aplica `required_profession`/`required_rank`; `/garimpar` foi retirado por contornar o framework e `/pescar` ficou fora da alfa enquanto a vara mantiver FormID provisório. `jobs-service` expõe somente `/cortarlenha`.

### F6-003 — Integrar Profissão ao Depot

- [ ] **Status:** `BLOQUEADO POR DECISÃO DE DESIGN`
- **Aceite:** regra “rank acessa recurso raro” implementada sem bloquear funcionalidades gerais não relacionadas.
- **Evidência:** o Depot já aplica capacidade, hold, autoridade e interação física, mas “acesso raro” não define se o rank deve liberar capacidade, aba, depósito, retirada ou estoque institucional. Bloquear retirada por profissão também impediria o Fundidor de receber minério do Minerador e quebraria a cooperação do próprio loop. A regra precisa ser decidida antes de virar código.

### F6-004 — Fechar Crafting real

- [ ] **Status:** `PARCIAL — runtime autoritativo pronto; conteúdo e jogo real pendentes`
- **Aceite:** proximidade da estação, decisão sobre `requires_perk`, receitas com FormIDs confirmados, XP e assinatura do artesão.
- **Evidência:** `crafting-service.test.js`, migrations v23/v24/v28 e `seed-forging.sql`; interação `[E]` resolve estação cadastrada no servidor, revalida distância e usa `requestId`; `/craft` e `/receitas` foram removidos por contornarem o alvo físico. `requires_perk` foi deliberadamente substituído por profissão/rank, e a receita placeholder `999999` foi removida. Ainda faltam cadastrar FormDescs reais, confirmar uma receita de Ferreiro no modpack e executar no Skyrim/SkyMP.

### F6-005 — Contratos como saída do loop

- [ ] **Status:** `PARCIAL — domínio completo em testes; jogadores reais pendentes`
- **Aceite:** publicação, escrow, entrega, revisão, disputa e acerto exercitados por jogadores reais.
- **Evidência:** `contracts-service.test.js` cobre publicação com escrow, aceite, entrega, revisão, disputa, expiração, cancelamento e acerto idempotente.

### Gate F6

- [ ] Cadeia exige cooperação entre personagens.
- [ ] Produção e consumo por hora são mensuráveis.
- [ ] Nenhuma profissão cria ciclo autossuficiente ou dinheiro infinito.

---

## 11. F7 — Crime e proveniência

### F7-001 — Roubo e item `hot`

- [ ] **Status:** `PARCIAL — domínio/interação cobertos; cena real pendente`
- **Aceite:** item fungível vira instância UUID; dono original não muda; roubo exige alvo vulnerável.
- **Evidência:** `core/crime-service.test.js` cria UUID, preserva dono original, exige alvo rendido/algemado/abatido e conserva item.

### F7-002 — Combat-log e restituição

- [ ] **Status:** `PARCIAL — alerta/grace/restituição cobertos; restart pendente`
- **Aceite:** logout cria alerta; grace period funciona; restituição via depot não duplica nem some com item.
- **Evidência:** `core/crime-service.test.js` cobre logout, janela hot, retorno online e restituição via depot sem resolver quando o depot falha/desliga.

### F7-003 — Revista e confisco institucionais

- [ ] **Status:** `PARCIAL — evidência/confisco cobertos; guarda real pendente`
- **Aceite:** guarda vê proveniência como evidência, não culpa automática; confisco preserva estado roubado.
- **Evidência:** buscas retornam proveniência sem culpa automática; confisco muda `hot→stolen` e preserva origem, coberto por `crime-governance-integration.test.js` e `crafting-governance-integration.test.js`.

### Gate F7

- [ ] Cadeia de posse reconstruível.
- [ ] Restart durante janela `hot` não perde contexto.
- [ ] Crime, governança e depot convergem.

---

## 12. F8 — Hardening

### F8-001 — Segurança dos serviços públicos

- [ ] **Status:** `PARCIAL` (revisão sem banco concluída; sessões persistentes, replay e staging pendentes)
- **Aceite:** rate limits, replay, CORS/proxy, sessões, segredo interno, uploads e updates revisados e testados.
- **Evidência:** [`PUBLIC_SERVICES_SECURITY_REVIEW_2026-08-24.md`](../security/PUBLIC_SERVICES_SECURITY_REVIEW_2026-08-24.md); rate limiter com memória limitada nos três serviços; 156 testes de serviço sem MariaDB.

### F8-002 — Observabilidade

- [ ] **Status:** `PARCIAL` (serviços Node + núcleo do gamemode instrumentados; collector/incidente e pollers restantes pendentes)
- **Métricas mínimas:** conexões, falhas de login, latência DB, eventos CEF, rejeições, transferências, reconciliações, polling, CPU e memória.
- **Aceite:** incidente de teste pode ser explicado por logs/métricas sem reproduzir localmente.
- **Evidência:** [`OBSERVABILITY_BASELINE_2026-08-24.md`](../operations/OBSERVABILITY_BASELINE_2026-08-24.md); `apps/shared/runtimeMetrics.js`; `core/runtime-telemetry.js`; endpoints protegidos; conexão/polling, módulos, CEF, CPU/memória, cardinalidade e privacidade cobertos por testes.

### F8-003 — Rollback exercitado

- [ ] **Status:** `PARCIAL` (procedimento e ferramentas escritos; exercício externo pendente)
- **Aceite:** rollback de gamemode, launcher/modpack e banco documentado e executado em staging.
- **Evidência:** [`ROLLBACK_RUNBOOK.md`](../operations/ROLLBACK_RUNBOOK.md) cobre gatilhos, preservação de evidência, código/gamemode, banco forward-only e release/manifesto; scripts de backup/restore validam hash e schema. Falta executar em staging.

### F8-004 — Assinar e testar o launcher

- [ ] **Status:** `BLOQUEADO`
- **Bloqueio:** certificado/serviço de assinatura ainda não adquirido.
- **Aceite:** assinatura válida e timestamp; instalação testada em Windows limpo; comportamento do SmartScreen registrado.
- **Evidência:** workflow/configuração de assinatura e verificação de timestamp estão documentados em `LAUNCHER_DISTRIBUTION.md`; falta adquirir/configurar o certificado e executar instalação em Windows limpo. Nenhuma assinatura foi alegada localmente.

### F8-005 — Sessão de soak test

- [ ] **Status:** `PARCIAL — runner/runbook prontos; sessão real bloqueada`
- **Aceite:** 6–8 horas com 5–10 jogadores, sem perda/duplicação, com relatório de carga e incidentes.
- **Evidência:** [`SOAK_TEST_PLAN.md`](../operations/SOAK_TEST_PLAN.md) e `scripts/run-service-soak.js`; 3 testes cobrem validação, privacidade/agregação e gate por taxa de erro. A execução de 6–8h ainda exige staging/MariaDB e jogadores reais.

---

## 13. F9 — Alfa fechada

### F9-001 — Preparar operação

- [ ] **Status:** `PARCIAL — runbook/checklists prontos; responsáveis externos pendentes`
- **Aceite:** calendário, janela de manutenção, canal de incidentes, responsáveis, backup pré-release e rollback definidos.
- **Evidência:** [`CLOSED_ALPHA_RUNBOOK.md`](../operations/CLOSED_ALPHA_RUNBOOK.md) define ficha da janela, papéis, gates, severidades, rotina e ata. Datas, nomes, canal e backup dependem da equipe/infraestrutura.

### F9-002 — Operar por duas semanas

- [ ] **Status:** `BLOQUEADO POR OPERAÇÃO EXTERNA`
- **Aceite:** 10–20 jogadores convidados; duas semanas sem perda de dados; incidentes registrados; economia revisada semanalmente.
- **Evidência:** roteiro e critérios estão no runbook; não há como produzir duas semanas de horas-jogador, incidentes e economia por teste unitário/local.

### F9-003 — Decisão de abertura

- [x] **Status:** `CONCLUÍDO PARA ESTE SNAPSHOT — NO-GO`
- **Aceite:** revisão explícita `GO`, `GO COM RESTRIÇÕES` ou `NO-GO`, baseada nos gates e incidentes, não em percepção informal.
- **Evidência:** [`PRODUCTION_BLOCKERS_2026-08-24.md`](../operations/PRODUCTION_BLOCKERS_2026-08-24.md) registra `NO-GO` por MariaDB/staging, clientes reais, assinatura, conteúdo físico, soak e alfa ainda sem evidência. A decisão deve ser reaberta após F8-005/F9-002.

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
| 24/08/2026 | F1-001 | `EM ANDAMENTO` → `BLOQUEADO NO AMBIENTE LOCAL` | SkyMP carregou; TCP 3000 e UDP 7777; MariaDB 3306 e Master API 3001 recusaram | MariaDB não está disponível e não pode ser instalada neste ambiente |
| 24/08/2026 | F0-002 | `PARCIAL` → `PARCIAL` | `BUILD_INFO.json` com pin e hashes; `commitVerified=false` | Identidade reproduzível criada; commit do artefato atual continua não comprovado |
| 24/08/2026 | F0-003 | `PARCIAL` → `PARCIAL` | Manifesto SHA-256 dos cinco masters; Game API fail-closed | Falta validar em segunda instalação limpa |
| 24/08/2026 | F1-002 | `TODO` → `PARCIAL` | UI embutida; reparo automático; build NSIS aprovado | Código em G1; renderização CEF real permanece G2 |
| 24/08/2026 | F2-005 | `TODO` → `PARCIAL` | Auditor sem vazamento + 6 testes; execução `--skip-db` | Pendências externas de credenciais, URLs públicas e distribuição foram nomeadas |
| 24/08/2026 | F6-001/002 | `TODO` → `PARCIAL/CONCLUÍDO NO CÓDIGO` | Resource Node Framework, mineração autoritativa, migration v27 e testes | Homologação física continua externa |
| 24/08/2026 | F6-004 | `TODO` → `PARCIAL` | Estação física, migration v28, placeholder removido; 1.233 testes verdes | Conteúdo confirmado e jogo real pendentes |
| 24/08/2026 | F8-005 | `TODO` → `PARCIAL` | Runner JSON, 3 testes e plano de 6–8h | Execução depende de staging e jogadores |
| 26/08/2026 | F1-001 / bootstrap | `BLOQUEADO` → `BLOQUEADO COM PREPARAÇÃO LOCAL CONCLUÍDA` | 15 testes novos; launcher 85/85; typecheck/lint; build NSIS | Writer fail-closed e spawn confirmado implementados; MariaDB, Master API e dois clientes continuam externos |
| 24/08/2026 | F9-001/002/003 | `TODO` → `PARCIAL/BLOQUEADO/NO-GO` | Runbook de alfa e parecer de bloqueios | Decisão atual é não promover |

---

## 16. Checklist de atualização deste documento

- [x] Status e checkbox contam a mesma história.
- [x] Toda conclusão possui evidência.
- [x] Gate do módulo foi atualizado no dashboard.
- [x] Dependências desbloqueadas foram revisadas.
- [x] Novo risco ganhou tarefa ou justificativa explícita.
- [x] Mudança de comportamento atualizou documentação técnica relacionada.
- [x] Se houve teste real, o roteiro/log da sessão foi anexado ou referenciado; quando não houve, o bloqueio foi explicitado.
