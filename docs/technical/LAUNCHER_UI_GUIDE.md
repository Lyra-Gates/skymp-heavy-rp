# Guia de UI do Launcher

Como o visual do `apps/launcher` é montado, onde mexer, e como testar sem
precisar do ambiente inteiro (painel + banco + Discord) rodando. Criado em
23/08/2026, no redesign que levou a Home de uma tela de login centralizada
pra um dashboard — registra as decisões e as armadilhas encontradas no
processo, não só o resultado.

## 1. Sistema de design

### Tipografia
Duas fontes, dois papéis:
- **Cinzel** (`var(--font-display)`) — títulos e wordmark da marca. Serifada,
  "esculpida em pedra", combina com o brasão do dragão nórdico
  (`public/logo.png`). Self-hospedada em `src/assets/fonts/` (SIL OFL, ver
  `LICENSE.txt` na mesma pasta) — **não** carrega de `fonts.gstatic.com` em
  runtime, de propósito: o launcher empacotado não deveria depender de rede
  só pra desenhar a própria UI.
- **Inter** (`var(--font-body)`) — todo o resto: texto de corpo, botões,
  labels da sidebar. Já era a fonte usada antes do redesign, mantida.

Pra adicionar um peso novo de Cinzel: baixar de
`https://fonts.googleapis.com/css2?family=Cinzel:wght@<peso>` com um
User-Agent de Chrome moderno (senão o Google devolve `.ttf` em vez de
`.woff2`), salvar em `src/assets/fonts/`, declarar um `@font-face` novo em
`index.css`.

### Cores
Tokens em `:root` (`src/index.css`). `--accent-gold` é o acento primário
(bate com o brasão); `--accent-frost` é a segunda voz da paleta — usar com
moderação, só em detalhes frios (glow do card de status, nunca em texto
grande ou botão primário). Não introduza uma terceira cor de acento sem
motivo — a paleta já tem tensão suficiente entre ouro e gelo.

### O motivo assinatura: `.hud-panel`
Cantos com traço dourado nos quatro vértices (`::before`/`::after` com
`border` em duas bordas cada), aplicado em `.status-card` e `.info-sidebar`.
Vem do vocabulário de HUD de RPG (mira, inventário) — reforça "painel de
controle", não "cartão de site". Se for criar um painel novo, reuse esta
classe em vez de inventar outro tratamento de borda.

### `.hero-shell` e a vinheta
Container de fundo cheio (usado no Login inteiro e atrás do dashboard da
Home). A imagem entra via variável CSS inline (`--hero-image`), não
`background-image` direto na classe — permite trocar a arte sem recompilar
CSS. Tem uma vinheta (`::before` com gradiente radial + linear) por cima:
sem ela, texto sobre a parte clara da imagem (neve, aurora) fica ilegível.
Se trocar a arte de fundo, teste com uma imagem clara pra garantir que a
vinheta ainda segura a legibilidade.

## 2. Layout da Home: por que é assimétrico

A primeira versão deste redesign empilhava tudo centralizado — título, card
de status, botão — e o feedback foi "ainda não tem a pegada" de launchers de
referência (Keizaal Online / Skyland Roleplay). A diferença real não era cor
nem fonte: era estrutura. Referências de launcher de jogo tendem a ter uma
**nav flutuando sobre a imagem inteira** (não uma barra sólida acima dela) e
uma **sidebar com informação real** ao lado do botão principal — a sensação
de painel de controle, não de tela de autenticação.

`.dashboard-nav` (overlay transparente, `position: relative` com gradiente
que desaparece) + `.dashboard-body` (`display: flex`, sidebar de 260px +
área central `flex: 1`) é essa estrutura. Não é subjetivo — dá pra confirmar
com `getBoundingClientRect()`: sidebar e conteúdo central devem ter o mesmo
`top`/`height` e ficar lado a lado, nunca um `y` diferente (empilhado).

### A sidebar mostra dado real, nunca decorativo
`ipcMain.handle('get-app-info', ...)` em `electron/main.ts` devolve
`launcherVersion` (`app.getVersion()`), `clientVersion`/`modsVersion` (via
`readStamp()`, os mesmos stamps que os handlers de update já liam) e
`gamePath`. Tudo local e síncrono — nenhuma chamada de rede nova. Isso é
deliberado: uma versão anterior deste projeto já teve UI decorativa sem dado
real por trás mais de uma vez (trade-overlay, atalhos de voz, o "Online"
fixo que existia antes do `check-server-status`) — sempre descoberto tarde,
sempre confuso pra quem via a UI e assumia que ela fazia algo. **Antes de
adicionar uma seção nova na sidebar (ex: notícias, lista de servidores),
confirme que existe handler/dado real por trás — se não existir, essa é uma
tarefa de backend primeiro, não só de CSS.**

## 3. Rodando e testando a UI

### `npm run dev` vs `npm start` vs `npm run build`
- `npm run dev` — o único que orquestra tudo sozinho: sobe o Vite, que
  compila `main.ts`/`preload.ts` via `vite-plugin-electron` e **abre o
  Electron automaticamente** quando o build termina. É o comando certo pra
  iterar em UI — HMR recarrega o renderer sem reabrir a janela.
- `npm start` (`electron .`) — só abre o Electron apontando pro
  `dist-electron/main.mjs` que já existir. Não builda nada sozinho; se
  `dist/`/`dist-electron/` estiverem ausentes ou desatualizados, abre uma
  janela preta/quebrada. Rodar só depois de um `npm run build` (ou de já ter
  passado por `npm run dev` uma vez).
- `npm run build` — pipeline completo (`tsc -b && vite build &&
  electron-builder`), gera o instalador. Não é pra iteração — é lento e
  gera artefato de produção.

### Testar visual sem o ambiente inteiro (painel + banco + Discord)
`window.electronAPI` só existe dentro do Electron de verdade — é o
`contextBridge` do `preload.ts` que o cria. Rodar o React puro num navegador
comum (`http://localhost:5173`, com `npm run dev` de pé) quebra na hora,
porque `App.tsx` chama `window.electronAPI.getAuthStatus()` sem guarda
nenhuma.

Pra iterar só na UI sem precisar logar de verdade: adicionar um `<script>`
temporário em `index.html`, **antes** do `<script type="module"
src="/src/main.tsx">`, definindo um `window.electronAPI` mockado com as
funções que a tela em questão usa (todas retornando `Promise`, no formato
que os handlers reais devolvem — conferir `src/types/electron.ts`).
Verificar por `document.querySelector` + `getComputedStyle`/
`getBoundingClientRect()` em vez de depender só de screenshot, que nem
sempre está disponível dependendo do ambiente.

**Sempre reverter o `index.html` antes de commitar.** Esse mock nunca deve
ir pro repositório — é ferramenta de inspeção, não parte do app. `git diff
apps/launcher/index.html` vazio é o sinal de que está limpo.

## 4. Credenciais do Discord: as três coisas que se parecem e não são a mesma

Confusão real, encontrada ajudando alguém a configurar isto pela primeira
vez — o Developer Portal mostra os três valores próximos um do outro:

| O que o Portal chama | Vai em | É segredo? |
|---|---|---|
| **Application ID** (= Client ID) | `VITE_DISCORD_CLIENT_ID` (`apps/launcher/.env`) **e** `DISCORD_CLIENT_ID` (`apps/web/.env`) — os dois precisam do mesmo valor | Não — vai embutido no instalador, qualquer jogador pode extrair |
| **Chave pública** (Public Key) | Nenhum `.env` deste projeto usa isso hoje | Não, mas também **não é o Client ID** — é a chave Ed25519 pra verificar assinatura de interação de bot/slash command. Usá-la como `client_id` derruba o login com `client_id: Valor "..." não é snowflake` |
| **Client Secret** (aba OAuth2, "Reset Secret") | `DISCORD_CLIENT_SECRET`, **só** em `apps/web/.env` — nunca em `apps/launcher` | **Sim.** Nunca cola num chat, nunca embute no launcher — é o painel que troca `code` por token, exatamente pra manter isso longe do instalador |

Armadilha adicional: `apps/launcher/.env.example` vem com
`VITE_DISCORD_CLIENT_ID=SEU_CLIENT_ID_AQUI` como placeholder. Um script (ou
uma pessoa apressada) que só confere "a variável está vazia?" passa batido —
o placeholder não é vazio, é só errado. O sintoma no Discord é
`Formato de formulário inválido` (client_id ausente/malformado) na tela de
autorização. Confira o **valor**, não só a presença.

Depois de trocar `VITE_*` em `apps/launcher/.env`, é preciso reiniciar
`npm run dev` — o Vite injeta essas variáveis em tempo de build (`define`
em `vite.config.ts`), não recarrega sozinho quando o `.env` muda.

Login completo local também exige `apps/web` rodando (`POST
/api/launcher/oauth/exchange` mora lá) — sem isso, mesmo com credenciais
certas, para em "Erro ao concluir o login. Verifique se o painel do
servidor está acessível."
