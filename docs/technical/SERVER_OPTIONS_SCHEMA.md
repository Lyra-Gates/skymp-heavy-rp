# Schema de Server Options RP

***Português** · [English](SERVER_OPTIONS_SCHEMA.en.md) · [Русский](SERVER_OPTIONS_SCHEMA.ru.md) · [Español](SERVER_OPTIONS_SCHEMA.es.md)*

> **Estado: parcialmente implementado.**
> O arquivo passou a ser carregado e validado por `skymp/gamemode/core/server-options.js`. Mas **só as opções listadas na seção "O que está ligado hoje" fazem alguma coisa** — o resto continua sendo contrato de design.
>
> O loader avisa no boot quando encontra no arquivo uma opção que ainda não faz nada, e **aborta o boot** se um valor for de tipo errado ou estiver fora do intervalo. Falhar alto é deliberado: uma opção de gameplay mal digitada que "quase funciona" é pior que um servidor que não sobe.

> **De onde este schema veio:** as opções originais (`isVanillaSpawn`, `SpawnTimeToRespawn`, `spawnTimeToRespawnNPC` e afins) são as do servidor Red House — ver `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` 4.1. Foram copiadas como intenção de design e nunca ligadas ao nosso código, o que explica o schema descrever comportamento que nunca existiu aqui. A tabela abaixo separa o que é real do que continua sendo intenção.

## 0. O que está ligado hoje

| Opção | Onde age |
|---|---|
| `chat.whisperRange` | `core/proximity-ranges.js` — chat **e** voz |
| `chat.localRange` | idem. `emote` e `ooc` são derivados dela (×5/4 e ×5/3) |
| `chat.shoutRange` | idem |
| `chat.oocEnabled` | `rp-chat-service.js` — desliga `/ooc` e `/b` in-game |
| `chat.oocRateLimitSeconds` | `rp-chat-service.js` — janela do anti-flood |
| `rp.permadeathEnabled` | `death-service.js` — bleed-out aposenta o personagem em vez de respawnar |
| `spawn.playerRespawnSeconds` | `death-service.js` — pausa entre morrer e respawnar |
| `economy.startingGold` | `whitelist.js` — concedido uma vez só por personagem, no primeiro spawn |

Todas as demais opções documentadas abaixo estão em `DECLARED_BUT_UNWIRED` no loader. Ao implementar uma, mova-a para `SPEC` e atualize esta tabela — há um teste que impede o exemplo de ganhar chave nova sem alguém classificá-la.

**Sobre `rp.permadeathEnabled`:** ligar isso muda o significado de toda cena de combate do servidor. O personagem que sangra até o fim vira `status='retired'` (nunca `DELETE`, mesmo caminho do `/permakill`), é notificado e desconectado. É decisão de operação, não detalhe de configuração.

## 1. Objetivo

Definir um `server-options` proprio para o servidor Heavy RP, com validacao, perfis por ambiente e protecoes contra configuracoes perigosas.

Este arquivo nao substitui `server-settings.json`. Ele controla regras de gameplay, RP, staff, chat, spawn e operacao.

## 2. Principios

- Toda opcao deve ter tipo definido.
- Producao deve bloquear opcoes perigosas.
- Mudancas devem ser auditaveis.
- Valores padrao devem favorecer seguranca.
- Ambiente local pode ser permissivo, staging controlado e producao restrito.

## 3. Exemplo de Estrutura

```json
{
  "environment": "staging",
  "rp": {
    "heavyRpEnabled": true,
    "requireApprovedCharacterForSpawn": true,
    "allowRaceMenuBeforeApproval": false,
    "defaultStartPointPolicy": "approved_character",
    "permadeathEnabled": false
  },
  "chat": {
    "localRange": 1400,
    "whisperRange": 350,
    "shoutRange": 3000,
    "oocEnabled": true,
    "oocRateLimitSeconds": 10,
    "logAllChannels": true
  },
  "staff": {
    "passwordAdminLoginEnabled": false,
    "requireRolePermission": true,
    "requireCommandReason": true,
    "auditAllCommands": true,
    "allowDestructiveCommandsInProduction": false
  },
  "spawn": {
    "vanillaSpawnMode": "selective",
    "playerRespawnSeconds": 300,
    "npcRespawnSeconds": 3600,
    "disableRespawnActorIds": []
  },
  "economy": {
    "serverAuthoritativeCurrency": true,
    "startingGold": 0,
    "logAllTransactions": true
  },
  "debug": {
    "enablePapyrusDebug": false,
    "enableHotReload": false,
    "enableDevTools": false
  }
}
```

## 4. Perfis por Ambiente

### Local

- Pode ativar debug.
- Pode ativar hot reload.
- Pode usar comandos de teste.
- Pode usar `databaseDriver=file`.
- Nao pode ser exposto para publico.

### Staging

- Debug limitado.
- Hot reload apenas em janela tecnica.
- Comandos destrutivos permitidos somente para dev/admin.
- Audit log obrigatorio.
- Whitelist pode usar grupo de testers.

### Producao

- `passwordAdminLoginEnabled=false`.
- `requireRolePermission=true`.
- `requireCommandReason=true`.
- `auditAllCommands=true`.
- `allowDestructiveCommandsInProduction=false`, salvo lista de excecoes assinada por dono/dev lider.
- `enableHotReload=false`.
- `enableDevTools=false`.
- `requireApprovedCharacterForSpawn=true`.

## 5. Validacoes Obrigatorias

Falhar o boot em producao se:

- Ambiente for `production` e `passwordAdminLoginEnabled=true`.
- Ambiente for `production` e `enableHotReload=true`.
- Ambiente for `production` e `enableDevTools=true`.
- Ambiente for `production` e `requireApprovedCharacterForSpawn=false`.
- Ambiente for `production` e `auditAllCommands=false`.
- Ambiente for `production` e `requireCommandReason=false`.
- `localRange`, `whisperRange` ou `shoutRange` forem menores ou iguais a zero.
- `startingGold` for negativo.
- `playerRespawnSeconds` for menor que a regra de morte definida.

## 6. Decisoes Pendentes

- Valor final dos ranges de chat apos teste em jogo.
- Se OOC global fica ativo em producao ou limitado por cooldown maior.
- Se vanilla spawn sera desligado, seletivo ou reduzido.
- Se permadeath existe no lancamento.
- Se comandos destrutivos podem ser usados em evento com autorizacao previa.
