# Schema de Server Options RP

> **Estado: projetado, não implementado.**
> `Initialize-LocalConfig.ps1` gera `skymp/config/server-options.local.json` a partir do exemplo, mas **nenhum código do gamemode lê esse arquivo**. Todas as opções abaixo são um contrato de design, não configuração viva: mexer nelas hoje não muda nada em jogo.
> As regras que este documento descreve estão hoje espalhadas como constantes em código — raios de chat/voz em `skymp/gamemode/core/proximity-ranges.js`, flags de módulo em `ENABLE_*` no `.env`, permissões de staff em `admin-service.js`/`governance-service.js`.
> Ligar este schema de verdade (carregar, validar e aplicar) está no plano de melhorias — ver `docs/technical/QA_REPORT_2026-08.md`.

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
