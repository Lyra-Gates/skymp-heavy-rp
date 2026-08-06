# Fase 0 — Roteiro de teste in-game

**O único bloqueio real do projeto.** 325 testes automatizados passam, e nada nunca rodou numa sessão com jogador. Enquanto este roteiro não for executado, tudo o mais é qualidade sobre código não validado.

> Substitui o `GOVERNANCE_MARKET_STALLS_TEST_PLAN.md` (13/07/2026), que cobria governança e barracas. Desde então entraram `death-service`, `/painel`, VOIP, master API de sessão e a fila — e o gamemode passou de ~15 para **mais de 60 comandos**. Aquele plano descrevia camadas; este descreve **passos, o que observar, e o que significa falhar**.

**Quem precisa:** 2 pessoas (A e B) com Skyrim SE/AE. Uma terceira (C) só na etapa 6.
**Tempo:** ~50 minutos se nada quebrar. Se quebrar, você para e anota — é para isso que serve.

---

## Como usar

Vá em ordem. **Cada etapa depende da anterior ter passado.** Não pule para "o que interessa": se a etapa 2 falha, o resultado da etapa 7 não significa nada.

Cada passo tem:
- **Faça** — a ação exata
- **Espere** — o que tem de acontecer
- **Se falhar** — o que isso significa e onde olhar

Copie o [registro em branco](#registro) para um arquivo novo antes de começar e preencha **enquanto testa**, não depois.

---

## Etapa 0 — Antes de ligar qualquer coisa (10 min, sozinho)

| # | Faça | Espere | Se falhar |
|---|---|---|---|
| 0.1 | `cd skymp/gamemode && npm test` | 218 passando | Não comece. Conserte antes. |
| 0.2 | `npm run test:systems` | 9/9 | Comando, permissão ou flag fora do lugar |
| 0.3 | `npm run check:schema` | `[OK] banco e migrations estao alinhados` | **Aplique as migrations pendentes.** Banco meio-migrado não quebra o boot — quebra a query que toca a coluna faltante, no meio de uma cena |
| 0.4 | Confira `apps/game-api/mods.json` | Existe e tem `mods` e `loadOrder` | `/mods.json` responde 503 e **ninguém entra**. Gere com `node scripts/generate-mods-manifest.js` |
| 0.5 | `.\scripts\phase0\Start-AllServices.ps1` | Nenhum aviso vermelho | O script diz o que não vai subir. Ele não mente por otimismo |

**Flags no `.env` do gamemode:**
```
ENABLE_GOVERNANCE_SERVICE=true
ENABLE_MARKET_STALLS_SERVICE=true
ENABLE_DEATH_SERVICE=true
ENABLE_PLAYER_PANEL_SERVICE=true
```
Deixe `ENABLE_VOIP_SERVICE=false` — o VOIP depende de um patch de client que não existe (`VOICE_CLIENT_PATCH.md`). Ele é a etapa 8, opcional.

⚠️ **`offlineMode: false` no `server-settings.json`.** Com `true` o cliente declara a própria identidade e o servidor acredita — a etapa 2 passaria sem provar nada.

---

## Etapa 1 — O jogador A entra (10 min)

Esta é a cadeia inteira: launcher → paridade → fila → sessão → master API → spawn. **É a etapa mais provável de falhar, e a mais importante.**

| # | Faça | Espere | Se falhar |
|---|---|---|---|
| 1.1 | Abrir o launcher, logar com Discord | Perfil aparece | O launcher só captura o `code`; a troca é no painel (`/api/launcher/oauth/exchange`). Veja o log do `apps/web` |
| 1.2 | Verificação de mods | Passa | **Anote o texto exato do erro.** "Plugin extra na load order" é o caso novo — significa que você tem um `.esp` que o servidor não conhece, e ele desloca os FormIDs |
| 1.3 | Entrar na fila | Admitido | Fila exige ticket do painel, não `discordId` |
| 1.4 | Confira `skymp_config.json` | Tem `session` preenchido | Sem isso o servidor não resolve identidade |
| 1.5 | O jogo abre e conecta | A entra no mundo | Porta 7777. Se a UI não aparecer, veja `localhost:9000` |
| 1.6 | No banco: `SELECT * FROM game_sessions ORDER BY id DESC LIMIT 1` | Linha com `resolve_count >= 1` | **Se `resolve_count` for 0, o master API não foi chamado** — o servidor está em `offlineMode` ou o `master` não aponta para o painel |

> **1.6 é o teste mais importante do roteiro.** Ele prova que a identidade veio do servidor e não do cliente. Se falhar, todo o resto roda sobre identidade forjável.

---

## Etapa 2 — O painel do jogador (5 min)

| # | Faça | Espere | Se falhar |
|---|---|---|---|
| 2.1 | `/painel` | HUD abre com 4 abas | Veja o console em `localhost:9000` |
| 2.2 | Ver a aba Status | Vida, magicka, stamina e ouro com valores reais | Valor zerado = o Papyrus não respondeu. **É o teste do formato `self`** (2.13 do QA) |
| 2.3 | Perder vida (queda) e olhar de novo | Vida atualiza em ~2 s | Polling parado |
| 2.4 | Abas Governança, Economia, Social | Abrem sem erro, mesmo vazias | — |

---

## Etapa 3 — Identidade e disfarce (5 min, A e B)

| # | Faça | Espere | Se falhar |
|---|---|---|---|
| 3.1 | A olha B pela primeira vez | B aparece como **Desconhecido** | **Falha grave.** O sistema de disfarce inteiro depende disso |
| 3.2 | B usa `/apresentar` para A | A passa a ver o nome de B | — |
| 3.3 | A ainda é Desconhecido para B | Sim | Conhecimento **não é recíproco** — é o caso do informante e do espião |
| 3.4 | A dá um apelido em B (`/apelido`) | A vê o apelido, não o nome civil | — |

---

## Etapa 4 — Chat por proximidade (5 min)

| # | Faça | Espere | Se falhar |
|---|---|---|---|
| 4.1 | Colados: `/sussurrar` | B lê | — |
| 4.2 | B se afasta bem e A sussurra | B **não** lê | Raio errado |
| 4.3 | `/gritar` da mesma distância | B lê | — |
| 4.4 | `/me` e `/do` | Aparecem como ação, não fala | — |

---

## Etapa 5 — Morte com consequência (10 min) 🔴

A parte mais nova e menos verificada do gamemode.

| # | Faça | Espere | Se falhar |
|---|---|---|---|
| 5.1 | B mata A (combate ou queda) | A vai para `DOWNED`, **não respawna** | Se respawnar direto, o `death-service` não está ligado ou o hook não disparou |
| 5.2 | `SELECT * FROM audit_logs WHERE action='death:killer' ORDER BY id DESC LIMIT 1` | Linha com o `killerId` de B | **Se estiver vazio, `mp.onDeath` não disparou** — o polling pegou a morte, e o item 1.8 do QA continua bloqueado |
| 5.3 | A tenta andar/atacar/falar | Bloqueado | `action-policy` não aplicou |
| 5.4 | B usa `/socorrer <actorId de A>` perto | A volta a `NORMAL` com vida parcial | — |
| 5.5 | Repita 5.1 e **espere 4 minutos** | A vira `DEAD`, perde ouro, respawna | — |
| 5.6 | Confira `gold_transactions` | Linha da penalidade, saldo nunca negativo | — |
| 5.7 | `action='death:context'` | Lista quem estava por perto | Evidência anti-RDM |

**Anote o tempo real entre 5.1 e o `DOWNED` aparecer.** Se passar de 2 s, o hook nativo não está sendo usado.

---

## Etapa 6 — Governança e mercado (10 min, precisa de C)

| # | Faça | Espere | Se falhar |
|---|---|---|---|
| 6.1 | Staff dá cargo de guarda a A e licença a B | — | — |
| 6.2 | A: `/guardduty` | Entra de serviço | — |
| 6.3 | B: `/stallplace` e `/stalladd` | Barraca aparece, item anunciado | — |
| 6.4 | C compra com `/stallbuy` | Ouro sai de C, entra em B, imposto retido | Confira `gold_transactions`: **três linhas, nenhum saldo negativo** |
| 6.5 | C desconecta e reconecta | O item continua no inventário | Persistência quebrada |
| 6.6 | A: `/stallinspect` e `/fine` em B | Multa registrada | — |
| 6.7 | A: `/arrest` em B | B fica preso, sem poder agir | — |
| 6.8 | B reconecta preso | **Continua preso** | Estado durável não sobreviveu ao reconnect |

---

## Etapa 7 — Staff e permissão (5 min)

| # | Faça | Espere | Se falhar |
|---|---|---|---|
| 7.1 | Um moderador tenta `/setgold` | **Negado**, com aviso | Escalação de privilégio |
| 7.2 | Um moderador tenta `/permakill` | **Negado** | Morte permanente nunca é linha de frente |
| 7.3 | Um admin usa `/permakill` com motivo | Personagem vira `retired` | — |
| 7.4 | `SELECT status FROM characters WHERE id=...` | `retired`, **linha existe** | Se sumiu, alguém fez `DELETE` — bug grave |
| 7.5 | Tentar entrar com o personagem aposentado | Bloqueado | — |

---

## Etapa 8 — VOIP (opcional)

Só se o patch de client de `VOICE_CLIENT_PATCH.md` tiver sido aplicado. Sem ele, `/voz` não conecta e **isso é esperado, não é bug**.

---

## Registro

Copie para um arquivo novo (`docs/roadmap/FASE_0_LOG_<data>.md`) e preencha durante o teste.

```markdown
# Fase 0 — execução de <data>

Testadores: A=___ B=___ C=___
Build/commit: ___
offlineMode: false ☐    Flags ENABLE_* ligadas: ___

| Etapa | Passou | Observação / erro exato |
|---|---|---|
| 0 Pré-boot        | ☐ |  |
| 1 Entrada         | ☐ |  |
| 1.6 resolve_count | ☐ | valor: ___ |
| 2 Painel          | ☐ |  |
| 3 Identidade      | ☐ |  |
| 4 Chat            | ☐ |  |
| 5 Morte           | ☐ | tempo até DOWNED: ___ s |
| 5.2 death:killer  | ☐ | killerId: ___ |
| 6 Governança      | ☐ |  |
| 7 Staff           | ☐ |  |

## O que quebrou
(erro exato, o que estava fazendo, o que o log disse)

## Decisões desbloqueadas
- [ ] QA 1.8 — tirar o polling do death-service (se 5.2 passou)
- [ ] QA 1.6 — confirmar master API (se 1.6 passou)
- [ ] Remover `/internal/session/resolve` (se 1.6 passou)
- [ ] Liberar Fase 1 da integração com a Chancelaria
- [ ] Liberar o `soul-service`
```

---

## O que este teste decide

Não é cerimônia. Cinco coisas estão **explicitamente esperando** o resultado:

| Se passar | Desbloqueia |
|---|---|
| 5.2 (`death:killer`) | Tirar o polling de 2 s do `death-service` — com 40 jogadores ele come ~600 ms de cada janela |
| 1.6 (`resolve_count`) | Confirmar o master API e apagar o `/internal/session/resolve`, que já é redundante |
| 2.2 (vitais reais) | Confirmar o formato do `self` em Papyrus in-game |
| Tudo | Fase 1 da integração com a Chancelaria Real |
| Tudo | O `soul-service` da Afinidade da Alma |

**Falhar aqui é resultado bom.** O que não pode acontecer é continuar sem saber.
