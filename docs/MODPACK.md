# Modpack Oficial — Skyrim Heavy RP

> **Versão do modpack:** 1.0 (baseado na análise do servidor em 2026-07-12)  
> **Compatibilidade:** Skyrim Special Edition 1.6.1170 (Steam)  
> **Incompatível com:** GOG, versão Anniversary Edition não-patcheada

---

## Índice

1. [Masters Base (Vanilla + Creation Club)](#masters-base)
2. [Mods de Conteúdo e Gameplay](#mods-de-conteúdo)
3. [Plugins Customizados do Servidor](#plugins-custom)
4. [Ordem de Carregamento (Load Order)](#load-order)
5. [Notas de Compatibilidade](#notas)

---

## Masters Base

Estes são os masters obrigatórios da base do Skyrim SE + conteúdo Creation Club
que o servidor exige. São verificados por hash MD5 para garantir a versão correta.

| # | Arquivo | Tipo | Descrição |
|---|---------|------|-----------|
| 1 | `Skyrim.esm` | ESM | Master principal do Skyrim SE |
| 2 | `Update.esm` | ESM | Patch oficial da Bethesda |
| 3 | `Dawnguard.esm` | ESM | DLC Dawnguard |
| 4 | `HearthFires.esm` | ESM | DLC HearthFires |
| 5 | `Dragonborn.esm` | ESM | DLC Dragonborn |
| 6 | `ccbgssse001-fish.esm` | ESM | CC: Fishing (obrigatório para mods de pesca) |
| 7 | `ccqdrsse001-survivalmode.esl` | ESL | CC: Survival Mode |
| 8 | `ccbgssse037-curios.esl` | ESL | CC: Rare Curios |
| 9 | `ccbgssse025-advdsgs.esm` | ESM | CC: The Cause (Adventure) |
| 10 | `_ResourcePack.esl` | ESL | CC: Resource Pack (texturas/meshes base) |

---

## Mods de Conteúdo

### Essenciais / Correções

| # | Arquivo | Nexus | Descrição |
|---|---------|-------|-----------|
| 11 | `Unofficial Skyrim Special Edition Patch.esp` | [USSEP](https://www.nexusmods.com/skyrimspecialedition/mods/266) | Patch de bugs não-oficiais. Obrigatório como master de vários outros mods |

### Sistemas de Gameplay (RP)

| # | Arquivo | Nexus | Descrição |
|---|---------|-------|-----------|
| 12 | `Ordinator - Perks of Skyrim.esp` | [Ordinator](https://www.nexusmods.com/skyrimspecialedition/mods/1137) | Overhaul completo de perks — 400+ perks únicas. Fundamental para progressão RP |
| 13 | `Apothecary.esp` | [Apothecary](https://www.nexusmods.com/skyrimspecialedition/mods/52130) | Overhaul de alquimia, comida e venenos. Compatível com Ordinator |
| 18 | `ars metallica.esp` | [Ars Metallica](https://www.nexusmods.com/skyrimspecialedition/mods/321) | Expansão do sistema de smithing |
| 20 | `JaxonzEnhGrab.esp` | [Jaxonz Enhanced Grab](https://www.nexusmods.com/skyrimspecialedition/mods/203) | Sistema de manipulação física de objetos |

### Pesca

| # | Arquivo | Nexus | Descrição |
|---|---------|-------|-----------|
| 16 | `FancyFishing.esp` | [Fancy Fishing](https://www.nexusmods.com/skyrimspecialedition/mods/103590) | Sistema de pesca avançado com mini-game |
| 21 | `StreamlinedFishing.esp` | [Streamlined Fishing](https://www.nexusmods.com/skyrimspecialedition/mods/85086) | Simplifica o mini-game de pesca |
| 22 | `Simple Fishing Overhaul.esp` | [Simple Fishing Overhaul](https://www.nexusmods.com/skyrimspecialedition/mods/103595) | Overhaul da mecânica base de pesca do CC |

### Equipamentos e Crafting

| # | Arquivo | Nexus | Descrição |
|---|---------|-------|-----------|
| 17 | `Cloaks&Capes.esp` | [Cloaks & Capes](https://www.nexusmods.com/skyrimspecialedition/mods/2019) | Adiciona mantos e capas ao jogo |
| 23 | `SkyUI_SE.esp` | [SkyUI](https://www.nexusmods.com/skyrimspecialedition/mods/12604) | Interface de inventário melhorada |
| 24 | `FaceMasksOfSkyrim.esp` | [Face Masks of Skyrim](https://www.nexusmods.com/skyrimspecialedition/mods/2549) | Máscaras faciais equipáveis |
| 25 | `BeardMaskFix.esp` | — | Fix de compatibilidade entre barbas e máscaras |
| 26 | `I4IconAddon.esp` | [I4](https://www.nexusmods.com/skyrimspecialedition/mods/85702) | Ícones de categoria no inventário |
| 27 | `MoreCraftableEquipment.esp` | [MCE](https://www.nexusmods.com/skyrimspecialedition/mods/14055) | Permite craftar equipamentos normalmente não craftáveis |
| 28 | `MoreCraftableEquipment_BYOHLooms.esp` | — | Patch MCE + HearthFires |
| 29 | `MoreCraftableEquipment_CloaksandCapes.esp` | — | Patch MCE + Cloaks & Capes |
| 30 | `MoreCraftableEquipment_Fish.esp` | — | Patch MCE + CC Fishing |
| 31 | `MoreCraftableEquipment_USSEP.esp` | — | Patch MCE + USSEP |

### Economia e Trabalho

| # | Arquivo | Nexus | Descrição |
|---|---------|-------|-----------|
| 19 | `WindstadMine.esp` | [Windstad Mine](https://www.nexusmods.com/skyrimspecialedition/mods/4688) | Mina administrável — sistema de trabalho/mineração jogável |

### Visual e Imersão

| # | Arquivo | Nexus | Descrição |
|---|---------|-------|-----------|
| 33 | `NW_Sons_of_Skyrim.esp` | [Sons of Skyrim](https://www.nexusmods.com/skyrimspecialedition/mods/14060) | Bandeiras e lore das facções |
| 34 | `JKs Skyrim.esp` | [JK's Skyrim](https://www.nexusmods.com/skyrimspecialedition/mods/6289) | Overhaul visual de todas as cidades |
| 35 | `HoldBorderBanners.esp` | [Hold Border Banners](https://www.nexusmods.com/skyrimspecialedition/mods/1737) | Bandeiras nas fronteiras entre Holds |

---

## Plugins Custom

Estes plugins são desenvolvidos internamente para o servidor.
São distribuídos automaticamente pelo launcher via auto-update.

| # | Arquivo | Descrição |
|---|---------|-----------|
| 14 | `SMTX_Woodcutter.esp` | **Sistema de lenhador custom** — mecânica de corte de lenha com progressão RP |
| 15 | `SMTX_Items.esm` | **Master de itens custom** — itens exclusivos do servidor |
| 32 | `AjustesSkyMP.esp` | **Ajustes de balanceamento** — adaptações para o ambiente multiplayer SkyMP |
| 36 | `Sentinel - Master Plugin.esp` | **Sentinel (master)** — sistema de guarda/segurança |
| 37 | `Sentinel - More Craftable Equipment.esp` | **Sentinel + MCE patch** |
| 38 | `Sentinel.esp` | **Sentinel (principal)** — plugin de guarda com quests, NPCs e lore |

---

## Load Order

Ordem de carregamento exata imposta pelo servidor via `plugins.txt`:

```
*Skyrim.esm
*Update.esm
*Dawnguard.esm
*HearthFires.esm
*Dragonborn.esm
*ccbgssse001-fish.esm
*ccqdrsse001-survivalmode.esl
*ccbgssse037-curios.esl
*ccbgssse025-advdsgs.esm
*_ResourcePack.esl
*Unofficial Skyrim Special Edition Patch.esp
*Ordinator - Perks of Skyrim.esp
*Apothecary.esp
*SMTX_Woodcutter.esp
*SMTX_Items.esm
*FancyFishing.esp
*Cloaks&Capes.esp
*ars metallica.esp
*WindstadMine.esp
*JaxonzEnhGrab.esp
*StreamlinedFishing.esp
*Simple Fishing Overhaul.esp
*SkyUI_SE.esp
*FaceMasksOfSkyrim.esp
*BeardMaskFix.esp
*I4IconAddon.esp
*MoreCraftableEquipment.esp
*MoreCraftableEquipment_BYOHLooms.esp
*MoreCraftableEquipment_CloaksandCapes.esp
*MoreCraftableEquipment_Fish.esp
*MoreCraftableEquipment_USSEP.esp
*AjustesSkyMP.esp
*NW_Sons_of_Skyrim.esp
*JKs Skyrim.esp
*HoldBorderBanners.esp
*Sentinel - Master Plugin.esp
*Sentinel - More Craftable Equipment.esp
*Sentinel.esp
```

---

## Notas

### Mods Bloqueados pelo Launcher (Quarentena)

O launcher move automaticamente para `Data\_disabledByLauncher\` qualquer mod fora da lista acima:

- **OpenAnimationReplacer** — crashes com SkyMP
- **PairedAnimationImprovements** — crashes reportados
- Qualquer mod extra instalado pelo jogador

### Versão do Skyrim

Compatível **exclusivamente** com Steam **1.6.1170**.
O launcher detecta e bloqueia GOG e AE não-downgradeados.

### Geração do mods.json para o Servidor

```powershell
# Gerar hashes MD5 de todos os mods na pasta Data
Get-ChildItem "C:\Games\Skyrim Special Edition\Data" -Include "*.esp","*.esm","*.esl" |
  ForEach-Object {
    $hash = (Get-FileHash $_.FullName -Algorithm MD5).Hash.ToLower()
    [PSCustomObject]@{ filename = $_.Name; hash = $hash }
  } | ConvertTo-Json -Depth 2
```
