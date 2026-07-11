# Estudo de Referencia - Servidor SkyMP Atual

Data: 2026-07-11

Fonte local estudada em modo somente leitura:

```text
E:\JOGO NORMAL
```

Regra de seguranca: este estudo registra ideias, arquitetura e riscos. Ele nao copia IP, ticket, token, webhook, Steam ID, Discord ID real, cookie, endpoint privado, senha, chave, codigo proprietario ou asset do servidor estudado. A pasta de origem permanece somente leitura e nao deve ser versionada.

## Niveis de Confirmacao

- CONFIRMADO POR ARQUIVO: existe arquivo, nome de modulo, config, log ou plugin local que comprova a presenca do item.
- OBSERVADO EM GAMEPLAY: comportamento foi visto diretamente em jogo pelo usuario ou por teste local do nosso ambiente.
- INFERIDO: conclusao razoavel a partir de nomes, estrutura de arquivos, logs ou UI, mas sem prova direta do comportamento completo.
- NAO VERIFICADO / DEPENDE DO SERVIDOR: a existencia no cliente nao prova implementacao server-side, regra de validacao, persistencia ou seguranca.

## Resumo Executivo

A instalacao estudada e uma distribuicao SkyMP customizada para RP, nao um cliente SkyMP vanilla.

Descobertas classificadas:

- Skyrim SE/AE `1.6.1170.0`: CONFIRMADO POR ARQUIVO, verificado pelo executavel `SkyrimSE.exe`.
- SKSE para `1.6.1170`: CONFIRMADO POR ARQUIVO, pela presenca de `skse64_1_6_1170.dll`.
- Cliente SkyMP customizado: CONFIRMADO POR ARQUIVO, pela presenca de `Data/Platform/Plugins/skymp5-client.js`.
- Login por launcher/ticket: CONFIRMADO POR ARQUIVO para a existencia de campos de ticket; INFERIDO para o fluxo completo; NAO VERIFICADO quanto a validacao server-side.
- VOIP integrado: CONFIRMADO POR ARQUIVO para configs e nomes de modulo; NAO VERIFICADO quanto ao roteamento server-side e qualidade em gameplay.
- UI web/CEF embarcada: CONFIRMADO POR ARQUIVO pela pasta `Data/Platform/UI`; NAO VERIFICADO quanto a todas as telas e permissoes.
- Painel admin no cliente: CONFIRMADO POR ARQUIVO por nomes de modulo e UI; NAO VERIFICADO quanto a permissoes server-side.
- Sistemas de casas, prisao, comercio, craft, morte, respawn, inventario e faccoes: CONFIRMADO POR ARQUIVO para referencias no cliente; NAO VERIFICADO quanto a implementacao server-side real.
- Mods de gameplay e SKSE: CONFIRMADO POR ARQUIVO pela presenca de plugins, DLLs e assets.

Conclusao: a referencia e util para escopo e riscos, mas nao deve ser usada como base direta. O nosso projeto deve reimplementar sistemas criticos de forma server-authoritative.

## Estrutura Observada

Pastas e arquivos:

- `Data/`: CONFIRMADO POR ARQUIVO. Contem plugins, scripts, assets, SkyMP, SKSE e mods.
- `Data/Platform/Plugins/`: CONFIRMADO POR ARQUIVO. Contem cliente SkyMP customizado e configs locais.
- `Data/Platform/UI/`: CONFIRMADO POR ARQUIVO. Contem UI web/CEF.
- `Data/SKSE/Plugins/`: CONFIRMADO POR ARQUIVO. Contem plugins SKSE.
- `Data/Scripts/`: CONFIRMADO POR ARQUIVO. Contem Papyrus vanilla, SkyMP e scripts de mods.
- `Skyrim/SkyrimPrefs.ini`: CONFIRMADO POR ARQUIVO.
- `Mods/` e `Creations/`: CONFIRMADO POR ARQUIVO, mas sem conteudo relevante observado no nivel inspecionado.

Arquivos de versao:

- `skymp_client_version.txt`: CONFIRMADO POR ARQUIVO, build `2026.07.11.0506`.
- `skymp_mods_version.txt`: CONFIRMADO POR ARQUIVO, atualizado para `2026.07.11.0511` apos update do servidor.

## Autenticacao e Conexao

Evidencia encontrada:

- `launcherTicket` em `gameData`: CONFIRMADO POR ARQUIVO.
- `profileId`: CONFIRMADO POR ARQUIVO.
- `server-ip` e `server-port`: CONFIRMADO POR ARQUIVO.
- `session`, `serverAddress` e `discordId` em config local: CONFIRMADO POR ARQUIVO, com valores reais removidos deste estudo.

Classificacao:

- A existencia dos campos e CONFIRMADA POR ARQUIVO.
- O fluxo de login por launcher e INFERIDO.
- A validacao do ticket, expiracao, protecao contra replay e vinculo com conta/personagem sao NAO VERIFICADOS / DEPENDEM DO SERVIDOR.

Diretriz para nosso projeto:

- `offlineMode` apenas em laboratorio local.
- Producao deve usar token curto, renovavel e validado no backend.
- Nunca confiar em `profileId`, Discord ID, cargo, permissao ou estado de personagem enviados pelo cliente.
- Spawn deve depender de personagem aprovado pela whitelist.

## VOIP

Evidencia encontrada:

- `skymp-voip.json`: CONFIRMADO POR ARQUIVO.
- Referencias a `voiceChatService`, `voipHud` e `voipNameplates`: CONFIRMADO POR ARQUIVO para nomes de modulo.

Classificacao:

- Presenca de VOIP no cliente: CONFIRMADO POR ARQUIVO.
- Voz por proximidade funcionando, roteamento por celula, mute e logs: NAO VERIFICADO / DEPENDE DO SERVIDOR.

Diretriz:

- VOIP fica depois do chat local.
- Chat local por proximidade e prioridade do primeiro prototipo.
- VOIP precisa respeitar distancia, interior/exterior, mute, logs e regras de RP.

## Mods e Plugins Detectados

Base oficial e Creation Club detectados:

- `Skyrim.esm`, `Update.esm`, `Dawnguard.esm`, `HearthFires.esm`, `Dragonborn.esm`: CONFIRMADO POR ARQUIVO.
- `_ResourcePack.esl`, `ccBGSSSE001-Fish.esm`, `ccBGSSSE025-AdvDSGS.esm`, `ccBGSSSE037-Curios.esl`, `ccQDRSSE001-SurvivalMode.esl`: CONFIRMADO POR ARQUIVO.

Mods de gameplay/RP detectados:

- `unofficial skyrim special edition patch.esp`: CONFIRMADO POR ARQUIVO.
- `SkyUI_SE.esp`: CONFIRMADO POR ARQUIVO.
- `Ordinator - Perks of Skyrim.esp`: CONFIRMADO POR ARQUIVO.
- `Apothecary.esp`: CONFIRMADO POR ARQUIVO.
- `ars metallica.esp`: CONFIRMADO POR ARQUIVO.
- `Cloaks&Capes.esp`: CONFIRMADO POR ARQUIVO.
- `FancyFishing.esp` e `Simple Fishing Overhaul.esp`: CONFIRMADO POR ARQUIVO.
- `JaxonzEnhGrab.esp`: CONFIRMADO POR ARQUIVO, risco alto.
- `SMTX_Items.esm`, `SMTX_Woodcutter.esp`, `WindstadMine.esp`: CONFIRMADO POR ARQUIVO.
- `MoreCraftableEquipment` e patches: CONFIRMADO POR ARQUIVO apos update.
- `BeardMaskFix.esp`, `FaceMasksOfSkyrim.esp`, `I4IconAddon.esp`: CONFIRMADO POR ARQUIVO apos update.

Plugins SKSE detectados:

- `MpClientPlugin.dll`, `SkyrimPlatform.dll`: CONFIRMADO POR ARQUIVO.
- `EngineFixes.dll`, `SSEDisplayTweaks.dll`, `CrashLogger.dll`, `MCMHelper.dll`, `ActorLimitFix.dll`, `AnimationQueueFix.dll`, `CollisionSentinel.dll`, `OpenAnimationReplacer`, `po3_Tweaks.dll`, `SkyrimSoulsRE.dll`, `CraftingCategories.dll`, `AchievementsModsEnablerLoader.dll`: CONFIRMADO POR ARQUIVO.
- `InventoryInjector.dll`, `po3_KeywordItemDistributor.dll`, `SimpleDualSheath.dll`, `BeardMaskFix.dll`: CONFIRMADO POR ARQUIVO apos update.

Diretriz:

- Mods podem inspirar o design.
- Mods que geram itens, alteram crafting, injetam inventario ou manipulam props entram como alto risco ate prova em SkyMP.
- O launcher deve validar hash, load order e versao do modpack.

## Sistemas RP Referenciados no Cliente

O `skymp5-client.js` contem referencias a:

- `authService`, `chatService`, `voiceChatService`, `adminMenuService`, `interactionService`, `arrestService`, `deathService`, `respawnService`, `houseService`, `barterV2Service`, `craftService`, `containersService`, `dropItemService`, `antiLootService`, `loadOrderVerificationService`, `serverJsVerificationService`, `blockVanillaNpcService`, `disableFastTravelService`, `disableSkillAdvanceService`, `weatherSyncService`, `timeService`, `worldCleanerService`, `seasonPassService`, `seasonShopService`, `apoiadorPaymentService`.

Classificacao:

- Referencias no cliente: CONFIRMADO POR ARQUIVO.
- Funcionamento em gameplay: NAO VERIFICADO, exceto quando o usuario confirmar observacao direta.
- Validacao server-side, persistencia, permissoes e auditoria: NAO VERIFICADO / DEPENDE DO SERVIDOR.

Pacotes customizados vistos no cliente:

- `ChatCommand`, `ChatPacket`, `AdminRoleStatus`, `AdminMenuSync`, `AdminTeleport`, `DungeonChestState`, `DungeonChestBusy`, `DungeonContainerOpen`, `DeathSackList`, `DoubleDropRequest`, `Barter2Commit`, `Barter2Cancel`, `WorkVigor`, `ChannelReward`, `ServerLoadOrder`, `FortSiegeBreachFx`.

Classificacao:

- Nomes de pacote: CONFIRMADO POR ARQUIVO.
- Semantica completa e seguranca: INFERIDO / NAO VERIFICADO.

## Riscos Tecnicos

1. Load order e forms:
   - Logs locais indicaram `form not found` e mensagens relacionadas a equipamento.
   - Nivel: CONFIRMADO POR ARQUIVO para o log; INFERIDO para a causa.
   - Mitigacao: checksum e load order obrigatorios no login.

2. Sistemas criticos no cliente:
   - Existem ganchos de inventario, morte, admin, baus e comercio no cliente.
   - Nivel: CONFIRMADO POR ARQUIVO para os ganchos; NAO VERIFICADO para server-side.
   - Mitigacao: servidor recalcula permissao, distancia, alvo, saldo, item, cooldown e consequencia.

3. Manipulacao livre de objetos:
   - `JaxonzEnhGrab.esp` existe no pacote.
   - Nivel: CONFIRMADO POR ARQUIVO. Gameplay e impacto multiplayer: NAO VERIFICADO.
   - Mitigacao: bloquear manipulacao livre no MVP.

4. NPCs e entidades vanilla:
   - `blockVanillaNpcService` e `worldCleanerService` aparecem no cliente.
   - Nivel: CONFIRMADO POR ARQUIVO para referencias; comportamento server-side NAO VERIFICADO.
   - Mitigacao: politica explicita de NPCs seletivos/reduzidos.

## Impacto Para Nosso Projeto

Aplicar agora:

- Manter a prioridade da Fase 0: dois clientes reais, movimento, celula, inventario, equipamento, morte, respawn e persistencia.
- Usar a referencia para decidir riscos do modpack.
- Criar `MODPACK_BASELINE.md` antes de alfa.
- Tratar inventario, containers, drop, trade e staff como superficies de auditoria.

Nao aplicar agora:

- Nao copiar codigo, assets ou configs do servidor estudado.
- Nao desenvolver launcher completo antes de fechar o teste tecnico.
- Nao desenvolver economia, casas, prisao, faccoes ou VOIP completo antes da Fase 1 estar validada.
