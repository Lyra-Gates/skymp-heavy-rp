# Como contribuir

***Português** · [English](CONTRIBUTING.en.md) · [Русский](CONTRIBUTING.ru.md) · [Español](CONTRIBUTING.es.md)*

Obrigado pelo interesse. Este projeto é uma build pública de servidor RP para SkyMP, sob AGPL-3.0 — o que você contribuir fica disponível para toda a comunidade.

Este documento tem duas partes: como rodar e enviar mudanças, e **as regras que não são óbvias lendo o código**. A segunda parte é a que importa mais — quase toda ela existe porque alguém já quebrou aquilo.

---

## 1. Subindo o ambiente

Precisa de: **Node.js 20+**, **MariaDB/MySQL**, e o **Skyrim SE/AE** se for testar em jogo.

```bash
git clone https://github.com/vinicius3232/skymp-heavy-rp.git
cd skymp-heavy-rp

# Cada serviço tem suas dependências
cd skymp/gamemode   && npm ci && cd ../..
cd apps/web         && npm ci && cd ../..
cd apps/game-api    && npm ci && cd ../..
cd apps/bot-discord && npm ci && cd ../..
cd apps/launcher    && npm ci && cd ../..
```

Copie cada `.env.example` para `.env` e preencha. Os comentários dentro deles dizem de onde vem cada valor.

Banco: aplique `skymp/packages/database/schema.sql` e depois as migrations `v2` até `v8`, **em ordem**.

```powershell
# Sobe painel, bot, API do jogo e servidor SkyMP
.\scripts\phase0\Start-AllServices.ps1
```

O script confere `.env` e `node_modules` de cada serviço antes e diz o que não vai subir. Se ele reclamar, resolva o que ele apontou — ele não mente por otimismo.

### Depurando

Duas coisas que existem e quase ninguém usa:

- **`localhost:9000`** no seu navegador abre o **DevTools do navegador embutido do jogo**. É como se depura a UI de `skymp/ui/`. Sem isso, você está trabalhando às cegas.
- O servidor faz **proxy da UI para um dev server na porta 1234**, então dá para iterar CSS/JS da interface sem reiniciar nada.

---

## 2. Rodando os testes

Todo serviço com lógica tem teste, e o CI roda todos em cada PR.

```bash
cd skymp/gamemode   && npm test && npm run test:systems && npm run typecheck
cd apps/web         && npm test
cd apps/game-api    && npm test
cd apps/bot-discord && npm test
cd apps/launcher    && npm run typecheck
```

Usamos o test runner nativo do Node (`node --test`) — sem Jest, sem Vitest, sem configuração.

**Teste novo precisa entrar no script `test` do `package.json`.** Não há descoberta automática de arquivos; um teste que não está listado simplesmente não roda, e ninguém percebe.

---

## 3. As regras que não são óbvias

Esta seção é o coração do documento. Cada item existe porque quebrou de verdade.

### 3.1 Ouro e itens: só pelo `core/transaction-service.js`

**Nunca** escreva `UPDATE characters SET gold = ...` nem mexa em `character_inventory` direto.

O `transaction-service` faz `BEGIN` / `SELECT ... FOR UPDATE` / `COMMIT`, grava em `gold_transactions` e aceita chave de idempotência. Existia um `economy-service.js` que fazia `UPDATE` solto — o `transfer` dele fazia `removeGold` seguido de `addGold` sem transação, então se a segunda falhasse o ouro sumia. Foi apagado em 06/08/2026 justamente para que o caminho fácil deixe de ser o errado.

```js
// certo
await transactionService.addGold({ characterId, amount, reason: 'quest_reward', module: 'quests' });

// errado — sem atomicidade, sem ledger, sem rastro
await db.query('UPDATE characters SET gold = gold + ? WHERE id = ?', [amount, characterId]);
```

### 3.2 Papyrus: `self` é objeto, nunca FormID

Use os helpers de `core/papyrus.js`:

```js
const { actorRef, baseRef } = require('./core/papyrus');
mp.callPapyrusFunction('method', 'Actor', 'Resurrect', actorRef(actorId), []);
```

O gamemode já misturou as duas formas em 22 lugares. Os nove testes oficiais do SkyMP (`misc/tests/` upstream) usam **exclusivamente** a forma de objeto, inclusive para argumentos que sejam referências. `type: 'form'` para o que existe no mundo, `type: 'espm'` para registro base de plugin.

### 3.3 Módulos: sempre pelo `core/module-registry.js`

Serviço novo se registra em `phase0-basic.js` com `id`, `enabledBy` (uma flag `ENABLE_*`), `dependencies`, `commands` e `initialize()`. O registry resolve dependências e registra/remove comandos sozinho.

**Nunca importe um módulo PARKED direto.** Sete serviços existem no disco e não rodam (`economy-regional`, `crafting`, `jobs`, `housing`, `horse`, `trade`, `disguise`). Importá-los no boot os faria rodar contornando as flags — que é exatamente o que o registry existe para impedir.

### 3.4 `server-options.json`: só entra o que funciona

`core/server-options.js` tem duas listas: `SPEC` (opções que realmente mudam comportamento) e `DECLARED_BUT_UNWIRED` (as que ainda não fazem nada).

Ao implementar uma opção, **mova-a de uma lista para a outra**. Há um teste que impede o arquivo de exemplo de ganhar chave nova sem alguém classificá-la.

Isso existe porque o schema tinha 24 opções documentadas e **nenhuma era lida** — alguém ajustava `permadeathEnabled`, nada acontecia, e concluía que o servidor estava bugado. Configuração que parece existir e não faz nada é pior que configuração ausente.

### 3.5 Permissões: nome, nunca número

`admin-service.hasPermission(actorId, 'retire_character')`. A função recusa número e nome inexistente, registrando erro no log — mas não conte com isso, escreva certo.

Havia doze chamadas passando nível numérico (`hasPermission(id, 20)`) num `Set` de strings. `Set.has(20)` é sempre `false`, então elas negavam tudo em silêncio.

### 3.6 O cliente não é confiável

Regra de ouro do projeto (`docs/MODDING_GUIDELINES.md`): **o servidor decide, o cliente exibe.**

Eventos vindos de `mp.makeEventSource` rodam no cliente. São uma **dica**, não uma prova. Aceitável para detectar morte; inaceitável para conceder item ou ouro.

Mesma lógica no `apps/web`: `discordId` é público e não prova identidade. Autenticação é por ticket emitido por quem tem o segredo.

### 3.7 Nunca `DELETE` em personagem

Personagem sai de jogo com `status = 'retired'`. O histórico — audit logs, transações, ficha criminal — precisa sobreviver. `whitelist.js` só libera spawn com `status = 'approved'`, então `retired` já basta para tirar de jogo.

Cuidado com `UPDATE ... JOIN` por conta: já aconteceu de aprovar uma whitelist e ressuscitar um personagem que tinha levado `/permakill`. Filtre por status.

### 3.8 Chamada Papyrus é cara

Cada ida e volta ao Papyrus custa **dezenas de milissegundos** — o servidor RP Red House mediu 13 a 35 ms por chamada. Não é microssegundo.

Isso torna polling caro rápido. Prefira hooks nativos (`mp.onDeath`, `mp.onActivate`) e `mp.makeEventSource` a laços de `setInterval` lendo `getActorValue`. Onde o polling ainda existe, está marcado como dívida.

### 3.9 Segredo nunca vai em variável `VITE_`

Tudo que é `VITE_*` no launcher é **embutido no instalador em tempo de build** e distribuído aos jogadores. O client secret do Discord já esteve lá — hoje vive só no `apps/web`, que faz a troca de token.

---

## 4. Estilo de código

- **Português** em comentários, documentação e mensagens ao jogador. Nomes de identificador em inglês, seguindo o que já existe no arquivo.
- **Comentário explica o porquê, não o quê.** `// incrementa i` não ajuda ninguém; `// FOR UPDATE aqui porque duas compras simultâneas duplicavam o item` ajuda muito.
- **Sem passo de build no gamemode.** Ele é JS puro carregado direto pelo SkyMP. O `npm run typecheck` usa `types/mp.d.ts` e é informativo — não introduza compilação, isso adicionaria uma etapa no ciclo mais lento do projeto (editar → testar em jogo).
- Siga o estilo do arquivo que você está editando, mesmo que você faria diferente.

### Tipando a API `mp`

`skymp/gamemode/types/mp.d.ts` marca a procedência de cada assinatura: `[DOC]` para o que está na documentação oficial do SkyMP, `[USO]` para o que foi inferido do nosso uso.

Ao descobrir algo novo em teste real, adicione com `[USO]` e diga onde foi observado. A distinção importa: `[USO]` pode mudar sem aviso numa atualização do SkyMP.

---

## 5. Commits e Pull Requests

Usamos [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(gamemode): adiciona zona segura por celula
fix(web): valida redirect_uri antes de trocar o code
docs: documenta o contrato de FormID
refactor(game-api): extrai a fila pra modulo testavel
test(gamemode): cobre o caminho de bleed-out
chore: atualiza dependencias
```

Escopos em uso: `gamemode`, `web`, `game-api`, `bot-discord`, `launcher`, `schema`.

**No corpo do commit, diga o porquê.** O histórico deste projeto é uma fonte de contexto real — vários commits explicam decisões que não cabem no código. Vale ler alguns antes de escrever o seu.

### Antes de abrir o PR

- [ ] Testes passam nos serviços que você tocou
- [ ] `npm run typecheck` limpo, se mexeu no gamemode ou no launcher
- [ ] Teste novo para comportamento novo — e olhando o **argumento**, não só o resultado (ver 6)
- [ ] Documentação atualizada se mudou comportamento ou arquitetura
- [ ] Nenhum segredo, `.env` real ou asset da Bethesda no diff

---

## 6. Sobre testes que dão falsa segurança

Vale um aviso próprio, porque já custou caro aqui.

O `mp` global é mockado nos testes. **Um mock aceita qualquer coisa** — foi assim que 22 chamadas Papyrus com o argumento errado passaram meses com a suíte verde. Pior: os guards `if (typeof mp === 'undefined') return;` faziam os testes nem chegarem naquele código.

Ao testar algo que fala com o servidor SkyMP ou com o banco, **verifique o argumento que foi passado**, não só o valor de retorno:

```js
// fraco: passa mesmo se o formato estiver errado
assert.equal(await service.giveItem(...), true);

// forte: pega erro de contrato
assert.equal(typeof call.self, 'object', 'self precisa ser objeto, nao FormID');
assert.match(query.sql, /FOR UPDATE/, 'sem lock, duas compras duplicam o item');
```

`core/papyrus.test.js` e `apps/web/server.test.js` têm exemplos.

---

## 7. Reportando problemas

- **Dúvida, ideia solta ou pedido de ajuda**: [Discussions](https://github.com/vinicius3232/skymp-heavy-rp/discussions). É onde a resposta fica visível pra quem vier depois.
- **Bug ou proposta concreta**: abra uma issue. Diga qual serviço, o que esperava e o que aconteceu.
- **Falha de segurança**: **não abra issue pública** — ver [SECURITY.md](SECURITY.md).
- **Dúvida sobre um mod**: `docs/technical/MODS_AND_GAMEMODE_CONTRACT.md` §4 tem um teste de quatro perguntas que resolve a maioria dos casos.

---

## 8. Por onde começar a ler

1. [`docs/README.md`](docs/README.md) — o mapa da documentação
2. [`docs/technical/QA_REPORT_2026-08.md`](docs/technical/QA_REPORT_2026-08.md) — o estado real de cada componente, incluindo o que **não** está pronto
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — como as peças conversam

O QA report é o mais honesto sobre onde o projeto está. Se algo parecer estranho no código, é bem provável que já esteja documentado lá.
