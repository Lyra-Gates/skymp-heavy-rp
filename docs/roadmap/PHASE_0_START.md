# Fase 0 - Como Comecar

## 1. Objetivo

Validar se o SkyMP atual consegue sustentar a base tecnica do servidor Heavy RP antes de desenvolver whitelist, economia, faccoes ou launcher.

Nao comece por economia, painel web ou modpack grande. Comece provando conexao, sincronizacao, persistencia e limites.

## 2. Resultado Esperado

Ao final da Fase 0, precisamos responder:

- Qual build do SkyMP sera usada?
- Qual versao do Skyrim sera travada?
- O servidor roda localmente?
- Dois clientes conectam?
- O mundo persiste apos restart?
- Quais portas precisam abrir?
- `file` basta para MVP?
- `mongodb` sera necessario para producao?
- Quais recursos de scripting funcionam de forma confiavel?
- Quais crashes ou dessync impedem progresso?

## 3. Preparacao Local

Antes de copiar builds ou masters do Skyrim, leia `docs/technical/PHASE_0_FILE_LAYOUT.md`.

### Ferramentas

- Git.
- GitHub CLI autenticado, se for usar remoto.
- Node.js LTS.
- PowerShell.
- Skyrim Special Edition / Anniversary Edition instalado.
- Build atual do SkyMP.
- Cliente SkyMP correspondente.

### Pastas Recomendadas

```text
skymp-rp/
  skymp/
    server/
    gamemode/
    config/
    ui/
  docs/
  infrastructure/
```

No momento, este repositorio ainda esta na etapa documental. A estrutura de codigo deve ser criada quando a build SkyMP escolhida estiver validada.

## 4. Ordem de Execucao

### Passo 1 - Confirmar Build

- Baixar ou compilar a build atual do SkyMP.
- Registrar origem da build.
- Registrar commit/tag quando existir.
- Confirmar se usa Skyrim SE, AE ou ambos.

Saida esperada:

```text
SkyMP build:
Origem:
Commit/tag:
Skyrim suportado:
Observacoes:
```

### Passo 2 - Montar `dataDir`

Copiar os masters oficiais:

- `Skyrim.esm`
- `Update.esm`
- `Dawnguard.esm`
- `HearthFires.esm`
- `Dragonborn.esm`

Conferir se `loadOrder` bate com esses arquivos.

Script auxiliar:

```powershell
.\scripts\phase0\Prepare-SkyMPDataDir.ps1
.\scripts\phase0\Prepare-SkyMPDataDir.ps1 -CopyMasters
```

### Passo 3 - Criar `server-settings.json`

Comecar com:

- `offlineMode=false` sempre que testar fluxo real.
- `databaseDriver=file` no primeiro teste.
- `maxPlayers=10` para laboratorio.
- `isPapyrusHotReloadEnabled=false`, salvo teste tecnico local.
- `startPoints` controlado.

Use `skymp/config/server-settings.local.example.json` como base. Copie para um arquivo local nao versionado antes de inserir chaves reais.

Script auxiliar:

```powershell
.\scripts\phase0\Initialize-LocalConfig.ps1
```

### Passo 4 - Testar Servidor Local

Validar:

- Boot sem erro.
- Logs limpos.
- Porta principal ativa.
- Porta da UI ativa.
- DataDir acessivel.
- Gamemode carregado.

### Passo 5 - Testar Dois Clientes

Validar:

- Cliente 1 conecta.
- Cliente 2 conecta.
- Jogadores se enxergam.
- Movimento sincroniza.
- Mudanca de celula nao quebra.
- Inventario basico nao causa crash.
- Morte/respawn basico nao causa crash.
- Disconnect/reconnect funciona.

### Passo 6 - Testar Persistencia

Com `databaseDriver=file`:

- Criar personagem.
- Mover personagem.
- Alterar inventario.
- Desconectar.
- Reiniciar servidor.
- Reconectar.
- Conferir estado.

Se falhar, documentar exatamente o que nao persistiu.

### Passo 7 - Testar Chat Minimo

Antes do chat final, validar viabilidade:

- Enviar mensagem local.
- Filtrar por distancia.
- Filtrar por celula.
- Registrar log.
- Bloquear spam simples.

### Passo 8 - Registrar Problemas

Criar notas com:

- Crash.
- Dessync.
- Falha de persistencia.
- Falha de porta.
- Bug de UI.
- Bug de inventario.
- Falha de spawn.

Formato:

```text
Data:
Build:
Ambiente:
Passos:
Resultado esperado:
Resultado real:
Gravidade:
Bloqueia progresso? sim/nao
```

Use tambem `docs/roadmap/PHASE_0_TEST_LOG.md` como registro principal da rodada de testes.

## 5. Decisoes ao Final

### Continuar

Se dois clientes conectam, persistencia funciona e nao ha crash bloqueante.

### Corrigir Antes de Avancar

Se ha bugs importantes, mas isolados.

### Trocar Abordagem

Se a build atual nao suporta conexao, persistencia ou estabilidade minima.

## 6. O Que Nao Fazer Ainda

- Nao criar modpack grande.
- Nao criar economia completa.
- Nao abrir Discord publico.
- Nao prometer data de beta.
- Nao criar faccoes complexas.
- Nao fazer launcher completo.
- Nao monetizar.

## 7. Proximo Marco Depois da Fase 0

Se a Fase 0 passar, iniciar Fase 1:

- Identidade de conta.
- Personagem aprovado.
- Spawn controlado.
- Admin por cargo.
- Audit log de comandos.
- Primeiro chat local por proximidade.
