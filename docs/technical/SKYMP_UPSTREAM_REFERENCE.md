# SkyMP upstream: o que existe e o que dá pra aproveitar

Levantamento feito em 05/08/2026 direto do repositório oficial (`github.com/skyrim-multiplayer/skymp`, C++, 313 estrelas, último push 25/07/2026).

O objetivo é que ninguém aqui reinvente o que o SkyMP já entrega — e que ninguém tente usar o que ele não entrega.

---

## 1. Onde está a documentação oficial

Não é o wiki do GitHub e não é o `README`: é a pasta **`docs/`** do repositório. Os arquivos que valem:

| Arquivo | Sobre |
|---|---|
| `docs_serverside_scripting_reference.md` | A API `mp` do gamemode |
| `docs_events_system.md` | `mp.makeEventSource` — eventos cliente→servidor |
| `docs_properties_system.md` | Properties e sincronização |
| `docs_clientside_scripting_reference.md` | O objeto `ctx` dentro dos snippets de cliente |
| `docs_onhit_and_damage.md` | Pacote OnHit e fórmula de dano |
| `docs_server_ports_usage.md` | Portas e ferramentas de debug |
| `docs_database_drivers.md` | `file`, `mongodb`, `zip` |
| `docs_server_configuration_reference.md` | `server-settings.json` |

Para ler sem clonar (o `raw.githubusercontent.com` dá 404 via ferramentas de fetch):

```bash
gh api repos/skyrim-multiplayer/skymp/contents/docs/docs_events_system.md --jq '.content' | base64 -d
```

---

## 2. A descoberta que mais muda nosso código: `mp.makeEventSource`

Hoje **três serviços nossos fazem polling de 2 em 2 segundos** — `death-service.js` (detecta HP≤0 e picos de dano), `player-panel-service.js` (vitais do painel) e `voip-service.js` (volume por distância). Isso foi escrito assumindo que não havia alternativa.

Há. `mp.makeEventSource(nome, corpoDaFuncao)` injeta um trecho de JS no cliente que roda no loop do jogo e chama `ctx.sendEvent()` quando quiser; o servidor recebe via `mp._nomeDoEvento = (pcFormId) => {}`.

```js
// Nome customizado TEM que começar com underscore.
mp.makeEventSource("_onLocalDeath", `
  ctx.sp.on("update", () => {
    const pl = ctx.sp.Game.getPlayer();
    const isDead = pl.getActorValuePercentage("health") === 0;
    if (ctx.state.wasDead !== isDead) {
      if (isDead) ctx.sendEvent();
      ctx.state.wasDead = isDead;
    }
  });
`);
mp._onLocalDeath = (pcFormId) => { /* ... */ };
```

Esse exemplo é literalmente o da documentação oficial — e é exatamente o caso do nosso `death-service`.

**O que isso resolveria:**
- Morte detectada no frame em que acontece, em vez de até 2s depois. Numa cena de RP, 2s de atraso pra entrar em `DOWNED` é a diferença entre a cena funcionar e não funcionar.
- Fim do `checkDamageSpike` como heurística: em vez de inferir dano por queda de HP entre ticks, o cliente reporta o evento.
- Custo de CPU do servidor deixa de crescer linearmente com o número de jogadores conectados.

**A ressalva honesta:** o snippet roda no cliente, que é território não confiável (ver `MODS_AND_GAMEMODE_CONTRACT.md`). Um evento vindo dali é uma *dica*, não uma prova — o servidor continua tendo que validar. Para morte isso é aceitável (o pior caso é alguém forjar a própria morte). Para conceder item ou ouro, não é.

---

## 3. Ferramentas de desenvolvimento que já existem e não usamos

Estas três são as que mais economizam tempo, e nenhuma exige escrever código:

### DevTools do Chromium na porta 9000
O navegador embutido expõe DevTools remoto. Abra **`localhost:9000`** no Chrome de verdade e você tem console, inspetor e breakpoints da nossa UI in-game.

Hoje `skymp/ui/index.html`, `player-panel.js` e `player-panel.css` são depurados **às cegas**. Isso muda com uma URL.

### Live reload da UI pela porta 1234
Se um WebPack dev server estiver rodando na porta 1234 na mesma máquina, o servidor SkyMP **faz proxy das requisições de UI pra ele**. Ou seja: dá pra iterar CSS e JS da UI sem reiniciar o servidor nem reconectar o cliente.

### Driver de banco `file` para teste
`databaseDriver: "file"` guarda o mundo num diretório, sem precisar de MongoDB. Já é o que nosso `server-settings.local.example.json` usa — vale saber que existe também `zip` (mesma coisa num arquivo só, prático pra snapshot antes de um teste destrutivo) e `mongodb` para produção.

---

## 4. Combate: correção de um entendimento anterior

Uma conclusão registrada antes neste projeto foi que "não existe hook confiável de quem atacou quem". Isso precisa de nuance:

**O pacote OnHit existe** e é rico (`docs_onhit_and_damage.md`):

```c++
uint32_t aggressor;   bool isBashAttack;   bool isHitBlocked;
bool isPowerAttack;   bool isSneakAttack;  uint32_t projectile;
uint32_t source;      uint32_t target;
```

O que **não** existe é exposição dele ao gamemode JS — a issue #1338 pediu isso e foi fechada como won't fix. O dado está no C++, não na nossa camada.

Duas saídas, ambas viáveis:
1. **`makeEventSource` no cliente**, escutando o evento de hit do Skyrim Platform e mandando `{aggressor, target}` pro servidor. Barato, e melhor que a proximidade que usamos hoje — mas continua sendo o cliente falando.
2. **`IDamageFormula` em C++** — o SkyMP expõe uma interface justamente pra servidores customizados redefinirem a fórmula de dano. É onde o dado é confiável de verdade, mas exige build C++ do servidor.

Enquanto nenhuma das duas for feita, o `/iniciar` + `checkDamageSpike` continua sendo o que temos: evidência por proximidade, não atribuição.

---

## 5. Cuidado com as portas

| Porta | Quem usa |
|---|---|
| 7777/UDP | SkyMP, sincronização (padrão) |
| 3000/HTTPS | UI do navegador embutido — **não configurável** |
| 9000 | DevTools do Chromium embutido |
| 1234 | WebPack dev server (live reload da UI) |
| 3001 | `apps/web` |
| 3002 | `apps/bot-discord` |
| 7758 | `apps/game-api` |
| 7778 | VOIP (`VOIP_PORT`) |

⚠️ **A porta de UI é `porta principal + 1` quando a principal é não-padrão.** Nosso `apps/launcher/.env.example` traz `VITE_SERVER_PORT=7757`, enquanto `skymp/config/server-settings.*.example.json` traz `"port": 7777`. Dois problemas nisso:

1. Os defaults **não batem** — o cliente tentaria 7757 enquanto o servidor escuta 7777.
2. Se alguém padronizar em 7757, a UI vai pra **7758 e colide com o `apps/game-api`**.

**Resolvido em 05/08/2026:** o launcher passou a usar 7777 (default e nos exemplos), alinhado com o `server-settings`. Fica o aviso no `.env.example`: mudar a porta principal pra um valor não-padrão desloca a UI e pode colidir com o `game-api`.

---

## 6. O que procuramos e não existe

- **Não há tipagem TypeScript pública da API `mp`.** O `skymp5-functions-lib` do upstream importa de um `src/` que não está no repositório — só o `index.ts` é público. Escrever nossos próprios typings (um `mp.d.ts` com JSDoc) é trabalho nosso, e seria útil: hoje `mp` é `any` implícito em todo o gamemode.
- **`skymp-ui-components`** (biblioteca de UI da org) está parada desde 2020. Não vale adotar.
- **`sweettaffy-lib`** é o conjunto de regras de RP do servidor SweetTaffy (em russo), não código — mas serve como referência de *design* de regras de servidor RP.
- **Releases**: a última é `sp-v2.6-beta`, de 2022. O projeto se desenvolve na branch `main`, não por release. Fixar em commit, não em tag.

---

## 7. Sugestão de aproveitamento, em ordem de custo-benefício

| | Ação | Esforço | Ganho |
|---|---|---|---|
| 1 | Abrir `localhost:9000` na próxima sessão de teste da UI | Zero | Para de depurar UI às cegas |
| 2 | Alinhar as portas 7757/7777 nos exemplos | Minutos | Remove uma falha de conexão garantida no primeiro teste |
| 3 | Escrever `skymp/gamemode/types/mp.d.ts` com o que a doc oficial define | Horas | Autocomplete e checagem em todo o gamemode |
| 4 | Migrar `death-service` de polling pra `makeEventSource` | Um dia | Morte imediata em vez de até 2s; menos CPU |
| 5 | Subir o WebPack dev server na 1234 pro fluxo de UI | Um dia | Live reload da UI |
| 6 | Evento de hit por `makeEventSource` | Alguns dias | Troca proximidade por agressor/alvo declarado |

Os itens 1 e 2 valem fazer antes do teste in-game da Fase 1 (`QA_REPORT_2026-08.md`), porque afetam justamente esse teste.

---

## Fontes

- [skyrim-multiplayer/skymp](https://github.com/skyrim-multiplayer/skymp) — repositório oficial, pasta `docs/`
- [Game Mode Framework — DeepWiki](https://deepwiki.com/skyrim-multiplayer/skymp/5.1-game-mode-framework)
- [docs/docs_skyrim_platform.md](https://github.com/skyrim-multiplayer/skymp/blob/main/docs/docs_skyrim_platform.md)
- [Issue #1338 — onHit para gamemode](https://github.com/skyrim-multiplayer/skymp/issues/1338) (fechada como won't fix)
