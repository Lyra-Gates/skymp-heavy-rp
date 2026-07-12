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
| Nexus - Keizaal Online Skyrim Roleplay | https://www.nexusmods.com/games/skyrimspecialedition/collections/cimlyl | Colecao relacionada encontrada por busca, nao confirmada como collection oficial atual |
| Nexus - Keizaal Online Overhaul | https://www.nexusmods.com/games/skyrimspecialedition/collections/buwbxa | Colecao relacionada com foco visual/overhaul, nao confirmada como oficial |
| Nexus - Keizaal Online Imperium Collection | https://www.nexusmods.com/games/skyrimspecialedition/collections/ou60p1 | Colecao relacionada com proposta visual escura/gritty, nao confirmada como oficial |
| Nexus - Graphically Enhanced Keizaal Online | https://www.nexusmods.com/games/skyrimspecialedition/collections/z6kxxi | Colecao relacionada de melhoria grafica, nao confirmada como oficial |
| Nexus - Graphically Enhanced Keizaal Online alternativa | https://www.nexusmods.com/games/skyrimspecialedition/collections/gtelvb | Colecao relacionada de melhoria grafica publicada por outro slug encontrado na busca |
| Nexus - Keizaal Online Unofficial Essentials | https://www.nexusmods.com/games/skyrimspecialedition/collections/reycsc | Colecao explicitamente nao oficial, usada apenas como referencia de categoria |
| Nexus - Keizaal Online Unofficial C-Shaders | https://www.nexusmods.com/games/skyrimspecialedition/collections/cdemvf | Colecao explicitamente nao oficial, usada apenas como referencia visual |
| Nexus - Xanakin's Custom pack-Keizaal Online | https://www.nexusmods.com/games/skyrimspecialedition/collections/6rugkg | Pack pessoal relacionado, nao oficial |
| Nexus - HLT x Graphically Enhanced Keizaal Online | https://www.nexusmods.com/skyrimspecialedition/mods/181210 | Mod auxiliar relacionado ao pack grafico; citado como fork sem plugin |
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

### 3.3.1 Matriz Nexus - Oficialidade e Uso

Importante: a pagina de busca do Nexus depende de JavaScript e nao expõe, no HTML simples, uma lista completa e confiavel de todos os resultados. Abaixo estao os itens localizados por busca publica e paginas indexadas. Esta matriz nao substitui auditoria manual no Vortex/Nexus quando formos montar uma modlist real.

| Item | Mods informados publicamente | Classificacao | Sinal principal | Decisao para nosso projeto |
| --- | ---: | --- | --- | --- |
| Keizaal Online | 33 | Oficial indicada pelo guia | Linkada diretamente no guia oficial de instalacao | Estudar primeiro; nao copiar sem licenca |
| Keizaal Online - Skyrim Roleplay | 128 | Relacionada, nao confirmada como oficial atual | Nome alinhado ao projeto, mas nao foi a collection linkada pelo guia oficial | Comparar categorias depois |
| Keizaal Online Overhaul | 271 | Relacionada/comunitaria | Overhaul amplo com tags visual/animation/lore-friendly | Usar apenas como inspiracao visual; alto risco de peso e compatibilidade |
| Keizaal Online Imperium Collection | 183 | Relacionada/comunitaria | Descrita como visual escuro/gritty | Inspiracao estetica, nao MVP |
| Graphically Enhanced Keizaal Online | 186 | Relacionada/comunitaria | Pack grafico/visual/quality of life | Inspiracao pos-alfa; nao priorizar |
| Graphically Enhanced Keizaal Online alternativa | nao consolidado | Relacionada/comunitaria | Outro slug para pack grafico semelhante | Tratar como duplicata/variante ate verificacao manual |
| Keizaal Online Unofficial Essentials | 8 | Explicitamente nao oficial | Nome "Unofficial" e colecao pequena | Pode indicar categorias minimas, mas nao e fonte de verdade |
| Keizaal Online Unofficial C-Shaders | 37 | Explicitamente nao oficial | Nome "Unofficial" e foco em shaders | Rejeitar para MVP; visual somente pos-alfa |
| Xanakin's Custom pack-Keizaal Online | 114 | Pack pessoal | Nome indica custom pack de usuario | Nao usar como base |
| HLT x Graphically Enhanced Keizaal Online | 1 mod | Mod auxiliar relacionado | Descrito como fork sem plugin para pack grafico | Estudar licenca se algum dia adotarmos HLT; nao agora |

Leitura tecnica:

- Existe uma "camada oficial minima" e varias camadas comunitarias/visuais por cima.
- Para servidor publico Heavy RP, a estrategia segura e comecar pequeno, controlado e reproduzivel.
- Collections com 100-270 mods podem melhorar visual, mas aumentam suporte, crash, load order, permissao de assets, tamanho de download e divergencia entre clientes.
- O nosso MVP deve copiar o principio operacional, nao o volume de mods.

Categorias que aparecem como recorrentes e podem virar estudo futuro:

- Visual/environment/shaders.
- Roupas, capas e armaduras.
- Necessidades/comida/crafting.
- Equipamento visual no personagem.
- Patches de receitas e craft.
- Quality of life de instalacao/launcher.

Decisao:

- ADOTAR a disciplina: collection enxuta + patches proprios + registro legal.
- ADAPTAR a ideia de visual RP, mas somente depois da Fase 0 e de uma modlist minima estavel.
- REJEITAR, por enquanto, usar qualquer collection comunitaria grande como base.

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
