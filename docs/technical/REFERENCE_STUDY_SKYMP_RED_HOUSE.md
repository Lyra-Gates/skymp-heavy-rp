# Estudo de Referencias - SkyMP, Keizaal e Red House

## 1. Fontes Estudadas

- Organizacao `skyrim-roleplay`: fork/organizacao ligada ao Keizaal Online.
- Repositorio `skyrim-roleplay/skymp`: fork atual do SkyMP usado como referencia de core.
- Repositorio `skyrim-roleplay/launcher`: publico, mas no momento contem apenas README minimo.
- Repositorio `alekcey0211/red-house-public`: build publica antiga do Red House, baseada em SkyMP.
- Pagina Nexus `Red House - Public Server Build (SkyMP)`: descricao publica, imagens e pacote historico.

## 2. Conclusao Geral

As referencias ajudam bastante, mas de formas diferentes:

- O fork atual do SkyMP ajuda a definir arquitetura, configuracao, portas, scripting, persistencia nativa e licenca.
- O Red House ajuda como estudo pratico de servidor RP antigo: estrutura de pastas, UI in-game, chat por proximidade, comandos, opcoes de servidor, spawn e pipeline de build.
- O launcher publico da organizacao `skyrim-roleplay` ainda nao serve como base tecnica, porque o repositorio publico contem pouco conteudo.

Para o nosso servidor Heavy RP, a melhor decisao e usar essas referencias como mapa, nao como copia direta. Red House e antigo e tem escolhas inseguras para producao publica, especialmente admin por senha e comandos perigosos expostos.

## 3. Achados do SkyMP Atual

### Configuracao

O servidor usa `server-settings.json` como fonte principal. A documentacao atual indica que CLI antiga nao e mais suportada para configuracao.

Campos importantes para o nosso plano:

- `name`: nome publicado.
- `masterKey`: chave usada com a Master API; cliente deve usar a mesma chave.
- `listenHost`: bind do trafego UDP principal.
- `uiListenHost`: bind do servidor HTTP/HTTPS usado pela UI.
- `port`: porta principal, normalmente UDP.
- `maxPlayers`: limite divulgado e aplicado.
- `dataDir`: pasta exposta para dados, UI e manifestos.
- `loadOrder`: ordem de `.esm` e `.esp`.
- `archives`: BSAs usados, especialmente para scripts Papyrus.
- `lang` e `locale`: idioma/localizacao.
- `offlineMode`: modo que permite cliente escolher profile id; nao deve ser usado em producao publica.
- `databaseDriver`: driver nativo do estado de mundo.
- `reloot` e `forbiddenReloot`: controle de reset de objetos.
- `gamemodePath`: caminho do gamemode.
- `startPoints`: pontos iniciais de spawn.
- `isPapyrusHotReloadEnabled`: util em desenvolvimento, perigoso em producao.

### Portas

O SkyMP usa mais de uma porta:

- Porta principal UDP, padrao `7777`.
- Porta de UI, padrao `3000` ou `port + 1` quando a porta principal muda.
- Webpack dev server em `1234` para desenvolvimento de UI.
- Chromium DevTools local em `9000` no cliente.

Impacto para o plano:

- A Fase 0 deve incluir teste de portas e firewall.
- Producao deve bloquear DevTools e dev server.
- Documentacao de infraestrutura precisa listar portas por ambiente.

### Persistencia

O SkyMP tem persistencia nativa de mundo e jogadores. Drivers vistos:

- `file`: padrao, salva em diretorio local.
- `zip`: salva em arquivo zip.
- `mongodb`: recomendado pela documentacao para servidores reais na internet.
- `migration`: migra de um driver para outro.

Impacto para o plano:

- PostgreSQL continua bom para whitelist, painel, staff, logs externos e economia web.
- O estado nativo do mundo SkyMP deve ser tratado separadamente.
- Precisamos decidir se o servidor usa MongoDB para estado SkyMP e PostgreSQL para plataforma RP, ou se simplificamos no MVP.

### Scripting

O servidor expoe o global `mp`.

Recursos importantes:

- `mp.makeProperty`: cria propriedades persistentes em atores e referencias.
- `mp.makeEventSource`: cria eventos customizados capturados do cliente.
- `mp.get` e `mp.set`: leem e alteram propriedades.
- Propriedades built-in modificaveis: `pos`, `angle`, `worldOrCellDesc`, `inventory`, `appearance`, `isOpen`, `isDisabled`.
- Propriedades readonly: `type`, `baseDesc`, `formDesc`, `equipment`, `isOnline`, `neighbors`.

Impacto para Heavy RP:

- Ferimentos, status de personagem, jail, flags de RP e estados visiveis podem ser modelados como propriedades.
- Eventos customizados podem capturar morte, interacoes e gatilhos de UI.
- Inventario e posicao precisam de regras server-side, porque sao superficies criticas de exploit.

### Licenca

SkyMP e distribuido principalmente sob GPLv3/AGPLv3. Mudancas distribuidas no software devem ter fonte disponibilizada conforme a licenca aplicavel.

Impacto:

- Qualquer fork/modificacao distribuida precisa de politica de codigo-fonte.
- O plano publico deve incluir aviso de nao afiliacao com Bethesda/ZeniMax.

## 4. Achados do Red House Public

### Estrutura

Pastas principais encontradas:

- `client`: client TypeScript.
- `front`: UI web/in-game.
- `server`: build pronta do servidor.
- `server-build`: codigo TypeScript do servidor.
- `modules`: sistema modular de scripts.
- `functions-lib`: biblioteca compartilhada de funcoes.
- `compiler`: Papyrus compiler e scripts.
- `parse-localization`: extracao/conversao de strings.
- `xelib`: tooling para ESP/localizacao.
- `docs`: admin, comandos, config e options.

Impacto:

- Nosso monorepo deve manter separacao clara entre `skymp/server`, `skymp/gamemode`, `apps/web`, `apps/launcher`, `packages/shared`, `packages/database` e `docs`.
- UI in-game deve ser tratada como app proprio, nao misturada com painel web da staff.

### Setup de Servidor

README do Red House orienta:

- Renomear `server-settings.example.json` para `server-settings.json`.
- Copiar `Skyrim.esm`, `Update.esm`, `Dawnguard.esm`, `HearthFires.esm`, `Dragonborn.esm` para o `data` do servidor.
- Extrair `scripts.zip` para `server/data/scripts`.
- Rodar `npm run server:start` ou `npm start` dentro de `server`.

Impacto:

- Nosso plano precisa ter checklist de arquivos oficiais do Skyrim.
- Scripts Papyrus e assets de UI devem ser versionados/empacotados com cuidado.

### Server Settings

Exemplo do Red House:

- `dataDir`: `data`.
- `loadOrder`: masters vanilla/DLC.
- `ip`: `127.0.0.1`.
- `port`: `10000`.
- `name`: nome do servidor.
- `maxPlayers`: `100`.
- `gamemodePath`: `gamemode.js`.
- `databaseDriver`: `file`.
- `locale`: `ru-RU`.
- `stringsPath`: `strings`.
- `isPapyrusHotReloadEnabled`: `true`.
- `isServerOptionsHotReloadEnabled`: `false`.
- `startPoints`: array de posicao/celula/angulo.

Impacto:

- Para producao, hot reload deve ser desligado.
- `startPoints` precisa virar politica de spawn inicial Heavy RP.
- `stringsPath` e localizacao importam se o servidor for portugues.

### Server Options

Red House adiciona `server-options.json` com:

- Nome exibido in-game.
- Debug Papyrus.
- Toggle de spawn vanilla.
- Tempos de respawn de jogador e NPC.
- Overrides de respawn por actor id.
- Multiplicadores de dano/stamina.
- Keybindings.
- Comandos bindados em teclas.
- Itens iniciais.
- `adminPassword`.

Impacto:

- Precisamos de um `server-options` nosso, mas com schema validado, sem senha admin simples e sem comandos perigosos por keybind em producao.
- Itens iniciais devem ser controlados por whitelist/personagem, nao por lista geral irrestrita.
- Respawn de NPC e vanilla spawn sao decisoes de design Heavy RP.

### Chat e UI

O Red House implementa chat via WebSocket e filtra mensagem por distancia e celula. No codigo lido:

- Token do browser e associado ao userId.
- Mensagens de chat sao enviadas para jogadores proximos.
- Existe canal non-RP com texto envolvido por `(( ... ))`.
- Distancia e celula determinam quem recebe chat IC.

Impacto:

- Chat local por proximidade e uma prioridade valida de MVP.
- Precisamos separar canais: IC local, sussurro, grito, OOC, staff, reports.
- O canal OOC deve ter rate limit e logs.

### Login e Spawn

O sistema Red House:

- Valida sessao via master server quando nao esta em modo local.
- Em modo local cria id fake para teste.
- Emite `spawnAllowed`.
- Reusa ator por profile id quando existe.
- Cria novo ator em `startPoints` e abre race menu quando nao existe.
- Desabilita ator no disconnect.

Impacto:

- Nosso fluxo deve ser: login -> identidade externa -> whitelist -> personagem aprovado -> spawn.
- Race menu nao deve ser liberado sem personagem aprovado em Heavy RP.
- Disconnect precisa preservar estado sem permitir abuso em combate.

### Comandos Admin

Red House documenta comandos como:

- `/adminlogin`.
- `/online`.
- `/anim`.
- `/addperk`.
- `/coc`.
- `/race`.
- `/additem`.
- `/kill`.
- `/killall`.
- `/killnpc`.
- `/thrownpc`.
- `/placeatme`.
- `/delete`.
- `/speedmult`.
- `/weaponspeedmult`.

Impacto:

- Esses comandos sao uteis em staging e eventos supervisionados.
- Em producao devem exigir permissoes por cargo, motivo obrigatorio e audit log.
- Comandos destrutivos devem ter confirmacao ou serem bloqueados fora de ambiente staff.

## 5. Ajustes Recomendados no Nosso Plano

1. Separar banco de mundo SkyMP de banco da plataforma RP.
2. Adicionar MongoDB como opcao de persistencia nativa SkyMP.
3. Manter PostgreSQL para whitelist, painel, logs, economia RP e staff.
4. Criar `docs/technical/SKYMP_SERVER_SETUP.md` com checklist real de portas, `dataDir`, masters do Skyrim e scripts.
5. Criar schema de `server-options` proprio, com validacao e perfis por ambiente.
6. Adicionar regra: `offlineMode`, hot reload e admin por senha ficam proibidos em producao.
7. Priorizar chat local por proximidade no MVP.
8. Priorizar spawn controlado por personagem aprovado, nao apenas por profile id.
9. Adicionar auditoria obrigatoria para comandos de staff.
10. Adicionar politica de licenca GPL/AGPL e nao afiliacao.
11. Adicionar decisao tecnica sobre NPCs: vanilla spawn desligado, reduzido ou seletivo.
12. Adicionar fase de laboratorio Red House apenas para aprendizado, sem virar base de producao.

## 6. Decisao Recomendada

Usar o SkyMP atual como base tecnica e o Red House como referencia historica/pratica.

Nao devemos copiar a arquitetura Red House integralmente para producao Heavy RP. Ela prova que chat, spawn, UI e server-options funcionam, mas tambem mostra riscos que precisam ser corrigidos desde o inicio: admin por senha, comandos perigosos, hot reload e estado de producao baseado em arquivos sem governanca.
