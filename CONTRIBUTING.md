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

Banco: aplique `skymp/packages/database/schema.sql` e depois as migrations `v2` até `v9`, **em ordem**.

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

# Precisa de banco: confere se ele bate com as migrations versionadas
cd skymp/gamemode   && npm run check:schema
```

Usamos o test runner nativo do Node (`node --test`) — sem Jest, sem Vitest, sem configuração.

**Teste novo precisa entrar no script `test` do `package.json`.** Não há descoberta automática de arquivos; um teste que não está listado simplesmente não roda, e ninguém percebe.

---

## 3. As regras que não são óbvias

Esta seção é o coração do documento. Cada item existe porque quebrou de verdade.

### 3.1 Dinheiro: só pelo `core/economy-service.js`

**Nunca** escreva `UPDATE characters SET gold = ...`, `UPDATE cities SET treasury = ...` nem equivalente. E, desde 13/08/2026, também não chame as primitivas `tx.*` do `transaction-service` a partir de um módulo de domínio.

A porta é [`core/economy-service.js`](skymp/gamemode/core/economy-service.js) ([framework](docs/framework/ECONOMY_FRAMEWORK.md), [ADR 004](docs/technical/ADR_004_ECONOMY_ACCOUNTS_AND_LEDGER.md)). Ele valida o valor, trava as duas contas em ordem canônica, confere idempotência **dentro** da transação e grava as **duas pernas** no ledger com o mesmo `transfer_id`.

O `core/transaction-service.js` continua existindo e continua sendo o único arquivo que escreve `characters.gold` — ele é o motor, não a API. Um `economy-service.js` anterior, apagado em 06/08/2026, fazia `UPDATE` solto e `removeGold` seguido de `addGold` sem transação; o de hoje é o oposto disso, e o nome voltou porque o papel voltou.

```js
// certo
await economy.transfer({
  from: { type: 'character', ref: pagadorId },
  to:   { type: 'city', ref: 'whiterun' },
  amount, reason: 'guard_fine', module: 'governance',
  actorCharacterId: guardaId, idempotencyKey: requestId
});

// errado — sem ledger do outro lado, tesouro sem história
await conn.query('UPDATE cities SET treasury = treasury + ? WHERE id = ?', [amount, cityId]);
```

**Recusa não é falha.** `{ok:false, code}` é decisão de regra; falha de infraestrutura **lança**. Nunca trate as duas do mesmo jeito — era o que fazia um timeout de banco virar mandado de prisão na multa da guarda ([auditoria, Achado 7](docs/research/ECONOMY_FRAMEWORK_AUDIT.md)).

Para **item**, a porta é [`core/inventory.js`](skymp/gamemode/core/inventory.js) ([framework](docs/framework/INVENTORY_FRAMEWORK.md)). Nunca mexa em `character_inventory` direto.

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

### 3.10 O segredo da alma nunca sai do servidor — e o domínio não lê ambiente

`core/soul.js` deriva a alma de um personagem da **ficha aprovada dele**, assinada com um segredo do servidor. Duas regras saem daí, e as duas já foram desenhadas para serem fáceis de quebrar sem perceber.

**O segredo é passado como argumento, nunca lido de `process.env` dentro do módulo.** Domínio não conhece infraestrutura — é isso que mantém o arquivo testável sem servidor, sem banco e sem `mp`. Um `require('dotenv')` ali dentro derruba a propriedade inteira.

**O segredo não pode vazar em lugar nenhum**: nem log, nem payload, nem resposta de API. A ficha do personagem é pública. Com o segredo, qualquer pessoa calcula a alma de qualquer personagem a partir do que está escrito no painel — e o sistema inteiro deixa de ser oculto, de uma vez, sem erro nenhum aparecer.

Pelo mesmo motivo: **nenhum número de afinidade pode chegar ao cliente.** O jogador recebe sinais e consequências, nunca valores. Ver [`docs/design/SOUL_AFFINITY.md`](docs/design/SOUL_AFFINITY.md) §III.12.7 — é o teste que protege o sistema inteiro.

### 3.11 Caractere invisível no fonte é sempre escape, nunca o byte cru

Escreva `'\u0000'`, `[\u0300-\u036f]`, `'\t'`. Nunca cole o caractere.

O `core/soul.js` carregava dois: a classe de marcas combinantes do `normalize()` e — o pior — um NUL como separador dos campos que entram no HMAC da alma. O NUL é a escolha certa ali, porque ele não sobrevive ao `normalize()` e portanto nenhum jogador consegue escrevê-lo na ficha; sem um separador impossível de digitar, `'ab'+'c'` e `'a'+'bc'` assinariam o mesmo material e duas fichas diferentes nasceriam com a mesma alma.

O problema não era a escolha, era ela ser invisível. Três consequências, todas silenciosas:

- **A linha mente para quem lê.** `].join('<NUL>')` aparece na tela como `].join('')` — o revisor entende "concatena sem separador", que é o oposto do que acontece.
- **O arquivo vira binário.** `grep` responde `Binary file matches` em vez do trecho, e `file` diz `data`. A ferramenta que todo mundo usa para achar código para de funcionar naquele arquivo.
- **Um editor pode apagá-lo ao salvar.** Muitos limpam caracteres de controle. Naquele arquivo isso reescreveria a semente de **toda alma já derivada**, sem erro nenhum aparecer.

Se um valor invisível for carregar significado, ele merece uma constante com nome e um comentário dizendo por que é aquele valor. `core/soul.test.js` tem um guard estático contra os dois casos.

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
