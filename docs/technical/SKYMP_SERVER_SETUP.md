# Checklist de Setup do Servidor SkyMP

## 1. Objetivo

Este checklist existe para validar o servidor SkyMP antes de qualquer sistema Heavy RP complexo.

O marco minimo e: servidor rodando, dois clientes conectados, portas documentadas, persistencia definida e comportamento basico testado.

## 2. Ambientes

### Local

- Usado por dev.
- Pode usar `databaseDriver=file`.
- Pode usar hot reload.
- Pode usar DevTools.
- Nunca deve aceitar jogadores publicos.

### Staging

- Usado por staff/testers aprovados.
- Deve simular producao quando possivel.
- Pode ter comandos destrutivos, mas sempre com audit log.
- Hot reload so pode ficar ativo durante janela tecnica.

### Producao

- Usado por jogadores aprovados.
- `offlineMode=false`.
- Hot reload desativado.
- Admin por senha compartilhada proibido.
- DevTools/dev server bloqueados.
- Backups automaticos ativos.

## 3. Arquivos Obrigatorios

Copiar para o `dataDir` do servidor, conforme a versao instalada do Skyrim:

- `Skyrim.esm`
- `Update.esm`
- `Dawnguard.esm`
- `HearthFires.esm`
- `Dragonborn.esm`

Se mods forem usados:

- `.esp` e `.esm` devem estar listados em `loadOrder`.
- `.bsa` deve estar listado em `archives` quando necessario.
- Scripts `.pex` devem estar em `data/scripts` ou no BSA correto.
- Arquivos de UI devem estar em `data/ui` quando servidos pelo SkyMP.

## 4. `server-settings.json`

Campos minimos a revisar:

```json
{
  "name": "Nome do Servidor",
  "masterKey": "chave-do-servidor",
  "listenHost": "0.0.0.0",
  "uiListenHost": "0.0.0.0",
  "port": 7777,
  "maxPlayers": 50,
  "dataDir": "data",
  "loadOrder": [
    "Skyrim.esm",
    "Update.esm",
    "Dawnguard.esm",
    "HearthFires.esm",
    "Dragonborn.esm"
  ],
  "archives": [],
  "lang": "portuguese",
  "locale": "pt-BR",
  "offlineMode": false,
  "databaseDriver": "file",
  "databaseName": "world",
  "gamemodePath": "gamemode/index.js",
  "startPoints": [
    {
      "pos": [0, 0, 0],
      "worldOrCell": "0x3c",
      "angleZ": 0
    }
  ],
  "isPapyrusHotReloadEnabled": false
}
```

## 5. Persistencia Nativa SkyMP

### MVP

- Usar `databaseDriver=file` para validar comportamento.
- Fazer backup da pasta `world` antes de cada teste destrutivo.
- Registrar tamanho, tempo de save e comportamento apos restart.

### Producao

- Avaliar `databaseDriver=mongodb`.
- Usar MongoDB separado do PostgreSQL da plataforma RP.
- Criar backup e restore testados antes da beta publica.

### Separacao Obrigatoria

- Estado de mundo SkyMP: driver nativo SkyMP.
- Plataforma RP: PostgreSQL.
- Cache/fila: Redis opcional.

## 6. Portas

### Porta Principal

- Uso: sincronizacao e trafego principal.
- Protocolo: UDP.
- Padrao: `7777`.
- Deve ser aberta no firewall em staging/producao.

### Porta de UI

- Uso: assets da UI in-game.
- Padrao: `3000` ou `port + 1`.
- Deve ser limitada conforme necessidade.

### Dev Server

- Uso: desenvolvimento de UI.
- Porta comum: `1234`.
- Proibido em producao.

### Chromium DevTools

- Uso: debug local do browser embutido.
- Porta comum: `9000`.
- Proibido em producao.

## 7. Testes Minimos da Fase 0

- Servidor inicia sem erro.
- Servidor aparece no destino esperado.
- Cliente 1 conecta.
- Cliente 2 conecta.
- Dois jogadores se veem.
- Movimento sincroniza.
- Mudanca de celula nao quebra conexao.
- Chat local funciona, se ja existir.
- Morte/respawn basico nao causa crash.
- Reconnect preserva ou recria personagem conforme regra esperada.
- Restart do servidor preserva estado esperado.
- Logs registram conexao, spawn e disconnect.

## 8. Bloqueios de Producao

Producao nao pode abrir enquanto qualquer item abaixo estiver ativo:

- `offlineMode=true`.
- Hot reload ativo.
- Admin por senha compartilhada.
- Comandos destrutivos sem permissao por cargo.
- Comandos destrutivos sem audit log.
- Dev server exposto.
- DevTools exposto.
- `databaseDriver=file` sem backup testado.
- Modlist sem controle de versao.
- Spawn sem checar personagem aprovado.

## 9. Evidencia Esperada

Ao final da Fase 0, registrar:

- Versao do SkyMP.
- Versao do Skyrim.
- Hash/versao da modlist.
- `server-settings.json` usado, sem segredos.
- Portas abertas.
- Driver de persistencia.
- Resultado dos testes.
- Lista de crashes/dessync.
- Decisao: continuar, corrigir ou trocar abordagem.
