# Estudo de Referencia - Keizaal Online

Data da pesquisa: 2026-07-12

## 1. Escopo

Este documento consolida informacoes publicas sobre o Keizaal Online para extrair ideias de gameplay, operacao, modlist e infraestrutura aplicaveis ao nosso servidor SkyMP Heavy RP.

Regras deste estudo:

- Nao copiar codigo, assets, patches, modpack ou configuracoes privadas.
- Nao tratar materia jornalistica como prova tecnica server-side.
- Separar fatos confirmados por fonte publica de inferencias.
- Usar Keizaal Online como referencia de produto e operacao, nao como base de producao.

## 2. Fontes Publicas Consultadas

| Fonte | URL | Uso no estudo |
| --- | --- | --- |
| Site oficial | https://keizaal.com/en | Identidade publica, links oficiais, nao afiliacao |
| Guia oficial de instalacao | https://keizaal.com/en/play | Fluxo de entrada, launcher, Discord, Vortex, collection |
| Roadmap oficial | https://keizaal.com/en/roadmap | Confirma existencia de pagina publica de roadmap, mas o conteudo textual exposto e minimo |
| Organizacao GitHub | https://github.com/skyrim-roleplay | Repositorios publicos, fork SkyMP, launcher publico |
| Launcher GitHub | https://github.com/skyrim-roleplay/launcher | Evidencia de launcher publico e releases |
| Nexus Collection principal | https://www.nexusmods.com/games/skyrimspecialedition/collections/gm8l1r | Colecao publica usada pelo servidor, indicada pelo guia oficial |
| Nexus Content and Patches | https://www.nexusmods.com/skyrimspecialedition/mods/177724 | Evidencia de patches proprios e creditos de mods usados |
| Games.GG | https://games.gg/news/skyrim-keizaal-online-600-players-no-npcs/ | Descricao publica do modelo player-driven e escala divulgada |
| GamesRadar | https://www.gamesradar.com/games/the-elder-scrolls/new-skyrim-mod-turns-bethesdas-rpg-into-the-ultimate-mmo-ive-always-yearned-for-transforming-all-npcs-into-real-players/ | Descricao jornalistica de gameplay, trading entre jogadores e ausencia de NPCs |

## 3. Achados Confirmados Por Fonte Publica

### 3.1 Entrada de jogador

Confirmado:

- O jogador precisa entrar no Discord para jogar.
- Ha um launcher proprio.
- O launcher aponta para o `SkyrimSE.exe`.
- O guia recomenda instalacao limpa de Skyrim Special Edition via Steam.
- O guia usa Vortex e uma Nexus Collection para baixar mods.
- Existe canal de suporte tecnico no Discord.

Impacto para nosso projeto:

- Nosso launcher nao precisa ser completo agora, mas o fluxo final deve ter:
  - checagem de versao do executavel;
  - checagem de modlist;
  - link com Discord/whitelist;
  - instrucoes de suporte;
  - erro claro quando faltar arquivo.

### 3.2 Organizacao publica

Confirmado:

- A organizacao `skyrim-roleplay` se descreve como uma experiencia multiplayer de roleplay em Skyrim baseada no SkyMP.
- Repositorios publicos encontrados:
  - `launcher`;
  - fork `skymp`;
  - fork `NirnLabUIPlatform`;
  - fork `ied-dev` / Immersive Equipment Displays.
- O launcher publico tem releases; a pagina consultada indicava release `1.2.8` em 2026-06-26.

Impacto para nosso projeto:

- Launcher e fork SkyMP sao pilares publicos do ecossistema deles.
- `NirnLabUIPlatform` sugere atencao a UI/CEF.
- `Immersive Equipment Displays` sugere interesse em exibicao visual de equipamentos, mas isso nao confirma uso server-side nem compatibilidade para o nosso MVP.

### 3.3 Modlist e patches

Confirmado:

- O guia oficial aponta para uma Nexus Collection publica.
- A collection principal exibida publicamente e descrita como usada pelo servidor e com 33 mods.
- Existe pagina Nexus "Keizaal Online Content and Patches".
- Essa pagina descreve patches para Keizaal Online.
- A pagina de patches lista creditos relacionados a:
  - Sentinel;
  - Cloaks and Capes;
  - Nirn Necessities;
  - New Legion;
  - More Craftable Equipment;
  - Common Clothes;
  - Eyes/meshes de autores diversos.

Impacto para nosso projeto:

- Patches proprios sao parte essencial de um servidor desse tipo.
- Devemos manter `docs/legal/ASSET_LICENSE_REGISTRY.md` e um registro de patches por mod.
- Mods de roupa, capas, equipamentos, comida/necessidades e aparencia parecem relevantes para RP visual e profissao.

### 3.4 Gameplay player-driven

Confirmado por materias publicas, nao por codigo:

- Keizaal Online e descrito como mundo persistente e sincronizado.
- O modelo divulgado substitui NPCs por jogadores em funcoes sociais/economicas.
- O comercio e descrito como realizado entre jogadores.
- Ha enfase em economia e ausencia de vendor NPC tradicional.
- Materias publicas citam mais de 600 jogadores simultaneos.
- Materias publicas citam eventos comunitarios e calendario publico.

Limite de confianca:

- Isso confirma a proposta publica e a percepcao externa.
- Nao confirma detalhes internos de implementacao, persistencia, anticheat, autorizacao, database, scripts ou controle de spawn.

Impacto para nosso projeto:

- Heavy RP deve ser menos "farmar sistema" e mais "produzir dependencia social".
- Vendedores NPC devem ser desativados, reduzidos ou substituidos por mercado player-driven.
- Eventos devem ser sistema de operacao, nao apenas improviso de Discord.

### 3.5 Nao afiliacao

Confirmado:

- O site oficial declara que Keizaal Online nao e afiliado a Bethesda Softworks ou ZeniMax Media.

Impacto para nosso projeto:

- Nossa politica de licenca e nao afiliacao deve continuar explicita.
- Nao usar marca Keizaal como se fosse afiliacao, parceria ou base oficial.

## 4. Sistemas/Ideias Aplicaveis Ao Nosso Servidor

| Ideia | Evidencia | Nivel | Aplicar como |
| --- | --- | --- | --- |
| Discord como entrada obrigatoria | Guia oficial | Confirmado | Manter whitelist e conta Discord no painel |
| Launcher com checagem de instalacao | Guia oficial e GitHub launcher | Confirmado | MVP: checar exe, manifest, hash e versao |
| Vortex/Collection para modlist | Guia oficial | Confirmado | Curto prazo: guia manual; medio prazo: manifest proprio |
| Patches proprios por mod | Nexus patches | Confirmado | Criar registro de patches e licencas antes de distribuir |
| Mundo sem vendor NPC central | Materias publicas | Confirmado como proposta publica | Adaptar com NPCs reduzidos e economia entre jogadores |
| Economia player-driven | Materias publicas | Confirmado como proposta publica | Priorizar mural de comercio, contratos e entregas |
| Eventos publicos agendados | Games.GG | Confirmado como noticia | Criar mural/event calendar por cidade e staff |
| Cargos e suporte via Discord | Guia oficial | Confirmado | Integrar bot com painel de whitelist e suporte |
| UI/CEF forte | GitHub com NirnLabUIPlatform + launcher | Inferido | Usar CEF para chat, mural, trade e painel in-game |
| Equipamento visual/importancia estetica | ied-dev fork + patches de roupas/equipamentos | Inferido | Estudar depois; nao colocar no MVP tecnico |

## 5. Ideias De Gameplay Para Backlog

### 5.1 MVP/Primeiro prototipo apos Fase 0

- Chat local com `/me`, `/do`, `/ooc`, `/roll`.
- Mural de anuncios por cidade:
  - compra/venda entre jogadores;
  - pedido de escolta;
  - expedicao;
  - recrutamento de oficio;
  - aviso de evento publico;
  - recompensa/bounty narrativo aprovado pela staff.
- Mercado sem vendor NPC generico:
  - item listado por personagem;
  - entrega presencial;
  - taxa por cidade;
  - log server-side.
- Calendario de eventos:
  - evento de staff;
  - evento de guilda/faccao aprovado;
  - evento emergente de cidade.

### 5.2 Alfa

- Profissoes que geram cena:
  - ferreiro depende de minerador;
  - cozinheiro depende de cacador/pescador;
  - medico/alquimista depende de coletor;
  - guarda depende de denuncias, prisao e escolta.
- Contratos por cidade:
  - contratos de compra;
  - contratos de entrega;
  - contratos de protecao;
  - contratos de investigacao;
  - contratos de coleta com local e risco.
- Controle de NPCs:
  - vanilla spawn desligado/reduzido/seletivo;
  - staff pode spawnar mobs em evento;
  - mobs nao devem virar grind economico automatico.

### 5.3 Pos-alfa

- Launcher completo com auto-update.
- Patches proprios de equipamento/roupa/aparencia.
- Economia regional avancada.
- Sistema visual de equipamentos.
- Calendario web + in-game sincronizado.
- Ferramenta staff para eventos de massa.

## 6. Riscos Identificados

| Risco | Origem | Mitigacao |
| --- | --- | --- |
| Copiar modlist sem licenca adequada | Nexus/patches | Registrar cada mod e permissao antes de usar |
| Transformar economia em grind solo | Sistemas de profissao | Recompensas devem depender de outro jogador ou evento |
| Confiar no cliente para trade/inventario | Gameplay player-driven | Trade, gold e inventario sempre server-authoritative |
| Eventos virarem caos sem agenda | Escala publica | Criar calendario, staff owner e regras de evento |
| Launcher virar prioridade cedo demais | Referencia Keizaal | MVP usa guia/manifest simples; launcher completo fica pos-alfa |
| Ausencia total de NPCs quebrar onboarding | Modelo "sem NPCs" | Para nosso projeto, usar reducao progressiva, nao corte total imediato |

## 7. Decisoes Recomendadas Para Nosso Plano

1. Nao copiar Keizaal Online; estudar como referencia de operacao e produto.
2. Priorizar a conclusao real da Fase 0 antes de novos sistemas.
3. Adotar o principio "player-driven economy", mas com server authority.
4. Criar mural de cidade antes de economia complexa.
5. Usar Discord como identidade, whitelist e suporte, mas nao como substituto de logs server-side.
6. Tratar launcher completo como pos-alfa; agora basta validação de build/modlist.
7. Manter NPCs reduzidos/seletivos ate termos staff, eventos e jogadores suficientes.
8. Criar uma politica formal de patches/mods antes de distribuir qualquer asset.

## 8. Proximas Acoes

- Atualizar backlog para incluir "Mural de Cidade" como prototipo prioritario pos-Fase 0.
- Criar documento de politica de modlist: permitido, proibido, em estudo.
- Criar checklist de licenca por mod antes de qualquer inclusao real.
- Definir quais NPCs vanilla ficam ativos no laboratorio.
- Nao iniciar economia, launcher completo ou sistema de faccoes antes dos testes tecnicos pendentes da Fase 0.
