# Estudo de Referência - Servidor SkyMP Atual

Data: 2026-07-11

Fonte local estudada em modo somente leitura:
```text
E:\JOGO NORMAL
```

Este estudo não copia tickets, Discord ID, endereço completo de servidor, credenciais ou qualquer dado sensível encontrado em configs locais. A pasta de origem permanece intacta e estritamente somente leitura. Todos os identificadores de teste reais foram removidos ou substituídos por marcadores genéricos.

---

## Resumo Executivo

A instalação estudada é uma distribuição SkyMP customizada para RP, não um cliente SkyMP vanilla. Ela combina:

* **Skyrim SE/AE `1.6.1170.0`** [CONFIRMADO POR ARQUIVO] - Verificado diretamente pelo executável `SkyrimSE.exe`.
* **SKSE `1.6.1170`** [CONFIRMADO POR ARQUIVO] - Presença de `skse64_1_6_1170.dll`.
* **Cliente SkyMP customizado** [CONFIRMADO POR ARQUIVO] - Arquivo `skymp5-client.js`.
* **Login por launcher/ticket** [INFERIDO / CONFIRMADO POR ARQUIVO] - Estrutura de ticket encontrada nas configurações.
* **VOIP integrado** [CONFIRMADO POR ARQUIVO] - Arquivo `skymp-voip.json`.
* **UI web/CEF embarcada** [INFERIDO] - Baseado na presença de arquivos de UI CEF.
* **Painel admin no cliente** [OBSERVADO EM GAMEPLAY] - Menus visuais observados em jogo.
* **Sistemas de gameplay RP** (casas, fortaleza/cerco, prisão, comércio, craft, morte/respawn e sincronização de inventário) [OBSERVADO EM GAMEPLAY].
* **Mods leves e utilitários SKSE** [CONFIRMADO POR ARQUIVO] - Plugins no diretório `Data/`.

---

## Estrutura Observada

Pastas principais no diretório de referência:

* `Data/` [CONFIRMADO POR ARQUIVO]: plugins, scripts, assets, SkyMP, SKSE e mods.
* `Data/Platform/Plugins/` [CONFIRMADO POR ARQUIVO]: cliente SkyMP customizado e configs locais.
* `Data/Platform/UI/` [CONFIRMADO POR ARQUIVO]: interface web/CEF do servidor.
* `Data/SKSE/Plugins/` [CONFIRMADO POR ARQUIVO]: plugins nativos SKSE.
* `Data/Scripts/` [CONFIRMADO POR ARQUIVO]: Papyrus vanilla, SkyMP e scripts de mods.
* `Skyrim/` [CONFIRMADO POR ARQUIVO]: contém `SkyrimPrefs.ini`.

Arquivos de versão encontrados:
* `skymp_client_version.txt` [CONFIRMADO POR ARQUIVO]: build de cliente `2026.07.11.0506`.
* `skymp_mods_version.txt` [CONFIRMADO POR ARQUIVO]: build de mods `2026.07.05.0347`.

---

## Autenticação e Conexão

O cliente usa arquivos locais de configuração SkyMP com:

* `launcherTicket` em `gameData` [CONFIRMADO POR ARQUIVO].
* `profileId` [CONFIRMADO POR ARQUIVO].
* `server-ip` e `server-port` [CONFIRMADO POR ARQUIVO].
* Configurações em `skymp_config.json` contendo `session` (com prefixo de ticket), `serverAddress` (removido/higienizado para `<ip-servidor>:<porta>`) e `discordId` (removido/higienizado para `<discord-id>`) [CONFIRMADO POR ARQUIVO].

### Diretriz para o Projeto
* Manter `offlineMode` apenas para laboratório local.
* Para produção, criar launcher/plataforma própria com token curto, renovável e validado no backend.
* Nunca confiar em `profileId`, Discord ID, cargo, permissão ou estado de personagem enviados pelo cliente.
* Spawn deve depender de personagem aprovado pela whitelist, não apenas profile ID.

---

## VOIP

Foi encontrada configuração de VOIP em `skymp-voip.json` [CONFIRMADO POR ARQUIVO]:
* `ptt_key` (push-to-talk) e `volume` configurados.
* UI possui funcionalidades relacionadas a `voipHud` e `voipNameplates` [INFERIDO].

### Diretriz para o Projeto
* VOIP deve entrar depois do chat local por proximidade.
* Chat local por proximidade continua prioridade do MVP.
* VOIP deve respeitar distância, interior/exterior, mute, logs de staff e regras de RP.

---

## Plugins e Mods Detectados

### Base Oficial e Creation Club [CONFIRMADO POR ARQUIVO]
Presentes no diretório `Data/`:
* `Skyrim.esm`
* `Update.esm`
* `Dawnguard.esm`
* `HearthFires.esm`
* `Dragonborn.esm`
* `_ResourcePack.esl`
* `ccBGSSSE001-Fish.esm`
* `ccBGSSSE025-AdvDSGS.esm`
* `ccBGSSSE037-Curios.esl`
* `ccQDRSSE001-SurvivalMode.esl`

### Mods de Gameplay/RP [CONFIRMADO POR ARQUIVO]
Detectados em arquivos `.esp`/`.esm`:
* `unofficial skyrim special edition patch.esp` (USSEP)
* `SkyUI_SE.esp`
* `Ordinator - Perks of Skyrim.esp`
* `Apothecary.esp`
* `ars metallica.esp`
* `Cloaks&Capes.esp`
* `FancyFishing.esp`
* `Simple Fishing Overhaul.esp`
* `JaxonzEnhGrab.esp`
* `SMTX_Items.esm`
* `SMTX_Woodcutter.esp`
* `WindstadMine.esp`

### Diretriz para o Projeto
* `SkyUI`: util para interface/MCM, mas nosso MVP deve priorizar UI SkyMP própria.
* `USSEP`: bom candidato a mod base, mas precisa de testes de compatibilidade com o SkyMP.
* `Ordinator` e `Apothecary`: alteram progressão/perks; bom para RP, mas exigem sincronização e controle server-side.
* `SMTX_Woodcutter`, `ars metallica`, `WindstadMine`: indicam foco em profissão, coleta, craft e economia produtiva.
* `JaxonzEnhGrab`: risco alto de desync/exploit. Deve ser bloqueado.

---

## Plugins SKSE Detectados [CONFIRMADO POR ARQUIVO]

Principais DLLs sob `Data/SKSE/Plugins/`:
* `MpClientPlugin.dll` (Cliente SkyMP)
* `SkyrimPlatform.dll`
* `EngineFixes.dll`
* `SSEDisplayTweaks.dll`
* `CrashLogger.dll`
* `MCMHelper.dll`
* `ActorLimitFix.dll`
* `AnimationQueueFix.dll`
* `CollisionSentinel.dll`
* `OpenAnimationReplacer`
* `po3_Tweaks.dll`
* `SkyrimSoulsRE.dll`
* `CraftingCategories.dll`
* `AchievementsModsEnablerLoader.dll`

---

## Sistemas RP no Cliente Customizado

O arquivo `skymp5-client.js` contém módulos e referências a serviços do lado do cliente:

* `authService`, `chatService`, `voiceChatService`, `adminMenuService`, `interactionService`, `arrestService`, `deathService`, `respawnService`, `houseService`, `barterV2Service`, `craftService`, `containersService`, `dropItemService`, `antiLootService`, `loadOrderVerificationService`, `serverJsVerificationService`, `blockVanillaNpcService`, `disableFastTravelService`, `disableSkillAdvanceService`, `weatherSyncService`, `timeService`, `worldCleanerService`, `seasonPassService`, `seasonShopService`, `apoiadorPaymentService` [CONFIRMADO POR ARQUIVO] (referências encontradas no código do cliente).
* O comportamento detalhado no servidor para esses serviços é [NÃO VERIFICADO].

Referências a pacotes customizados detectadas no cliente:
* `ChatCommand`, `ChatPacket`, `AdminRoleStatus`, `AdminMenuSync`, `AdminTeleport`, `DungeonChestState`, `DungeonChestBusy`, `DungeonContainerOpen`, `DeathSackList`, `DoubleDropRequest`, `Barter2Commit`, `Barter2Cancel`, `WorkVigor`, `ChannelReward`, `ServerLoadOrder`, `FortSiegeBreachFx` [CONFIRMADO POR ARQUIVO].

---

## Riscos Técnicos Observados

1. **Divergência de Load Order e Forms** [INFERIDO / OBSERVADO EM GAMEPLAY]
   * Logs locais mostraram erros de `form not found` e `onUpdateEquipmentMessage`.
   * **Mitigação**: O Launcher e o Servidor devem validar o checksum do modpack antes de autorizar o login.
2. **Sistemas Críticos no Cliente** [INFERIDO / NÃO VERIFICADO]
   * A lógica de inventário, baús, morte e administração tem ganchos no cliente.
   * **Mitigação**: O servidor deve ser o único autoritativo para conceder permissão, saldo, itens ou cooldowns.
3. **Manipulação Livre de Objetos** [OBSERVADO EM GAMEPLAY]
   * Uso de ganchos como `JaxonzEnhGrab` no multiplayer.
   * **Mitigação**: Bloquear movimentação livre de props e containers. Tudo deve passar por ações server-side validadas.
4. **NPCs e Entidades Vanilla** [INFERIDO]
   * Presença de `blockVanillaNpcService` para gerenciar comportamento nativo.
   * **Mitigação**: Adotar spawn seletivo/reduzido de NPCs vanilla para evitar lag de sincronização.

---

## Histórico de Atualizações de Referência

* **2026-07-11 13:51**: Nova build de mods publicada (`skymp_mods_version.txt` atualizado para `2026.07.11.0511`).
* **Novos arquivos detectados** [CONFIRMADO POR ARQUIVO]:
  * Plugins: `BeardMaskFix.esp`, `FaceMasksOfSkyrim.esp`, `I4IconAddon.esp`, `MoreCraftableEquipment.esp` (e sub-patches).
  * DLLs SKSE: `BeardMaskFix.dll`, `InventoryInjector.dll`, `po3_KeywordItemDistributor.dll`, `SimpleDualSheath.dll`.
* **Leitura**: Foco em expandir opções visuais e categorização avançada de craft e inventário no cliente. A validação destas receitas e a prevenção de duplicações dependem de lógica server-side [NÃO VERIFICADA].
