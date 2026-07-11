# Fase 0 - Log de Testes

Use este arquivo para registrar evidencias reais dos testes SkyMP.

## Ambiente

- **Data**: 2026-07-11
- **Responsavel**: Codex/Vinicius
- **Maquina**: Windows local
- **Skyrim versao**: Steam SE/AE alvo `1.6.1170.0`, verificado diretamente pelo executável.
- **SkyMP build**: GitHub Actions artifact `server-dist`
- **SkyMP origem**: `skyrim-multiplayer/skymp`, workflow `PR Windows Flatrim (AE/SE)`, run `29137896242`
- **Commit/tag**: `dbbc6b7e4bb33f79c45387a144eaa513aa88030c`
- **Cliente usado**: GitHub Actions artifact `dist/client`, instalado via `scripts/phase0/Install-SkyMPClient.ps1`
- **databaseDriver**: `file` (SQLite gerando arquivo `world`)
- **Porta principal**: UDP `7777`
- **Porta UI**: TCP `3000`

---

## Teste 0.1 - Boot do Servidor

- **Resultado esperado**: Servidor inicia sem erro crítico.
- **Resultado real**: Servidor inicializou, carregou `dataDir`, storage `file`, gamemode mínimo `phase0-basic.js` e ficou ativo sem erros.
- **Logs relevantes**:
  - `Hot reload is disabled for Papyrus`
  - `Using data dir '..\data'`
  - `Using file with name '..\world'`
  - `Gamemode path is "D:\Documents\New project\skymp\gamemode\phase0-basic.js"`
  - `[phase0] SkyMP Heavy RP gamemode loaded`
  - `[phase0] mp API available`
  - `Server resources folder is listening on 3000`
- **Status**: Aprovado.

## Teste 0.2 - Conexao Cliente 1

- **Resultado esperado**: Primeiro cliente conecta e spawna.
- **Resultado real**: Cliente conectou com sucesso com `profileId=1` e `offlineMode=true`. Inicialmente, o jogador spawnou no ponto inicial padrão [0,0,0] (que no mapa de Tamriel fica no ar no Throat of the World) e morreu por queda. Após alteração das coordenadas para `[35, -165, -189]` na célula interna `0x162e2` (The Bannered Mare), o spawn ocorreu no chão de forma segura.
- **Logs relevantes**:
  - `ServerState::Connect: assigning guid for userId=1`
  - `Connecting a user 1 with ip 127.0.0.1`
  - `Loading character ff000000`
  - `1 logged as 1`
- **Status**: Aprovado (conexão e spawn visual confirmados in-game pelo jogador).

## Teste 0.3 - Conexao Cliente 2

- **Resultado esperado**: Segundo cliente conecta e spawna com perfil separado.
- **Resultado real**: Cliente com `profileId=2` foi conectado no servidor local com sucesso, autenticou como userId=2 e spawnoou.
- **Logs relevantes**:
  - `ServerState::Connect: assigning guid for userId=2`
  - `Connecting a user 2 with ip 127.0.0.1`
  - `Creating character ff000001`
  - `2 logged as 2`
- **Status**: Aprovado.

## Teste 0.4 - Sincronizacao Basica

- **Resultado esperado**: Dois clientes ficam conectados simultaneamente.
- **Resultado real**: As conexões dos dois clientes se sobrepuseram no servidor (userId=1 e userId=2 ativos de 15:37:59 a 15:38:10 antes do disconnect do cliente 1). Como o jogador rodou no mesmo PC (onde a Steam bloqueia abertura de dois clientes gráficos de forma simultânea), a validação visual do movimento mútuo in-game foi limitada, mas a sincronização de rede está operando.
- **Logs relevantes**:
  - `[15:37:59.112] connect 2`
  - `[15:37:59.113] 2 logged as 2`
  - `[15:38:10.951] disconnect 1`
- **Status**: Parcialmente Aprovado (rede ativa, sincronização visual in-game pendente de múltiplos PCs).

## Teste 0.5 - Morte e Respawn

- **Resultado esperado**: O servidor gerencia a morte do jogador e programa seu respawn.
- **Resultado real**: No spawn inicial inadequado (Tamriel [0,0,0]), o jogador morreu devido a dano de queda. O servidor detectou a morte instantaneamente e agendou o respawn com delay de 25 segundos.
- **Logs relevantes**:
  - `EvaluateDeathItem ff000000 - No death item found, skipping add`
  - `MpActor::RespawnWithDelay ff000000 - finally, respawn after 25 seconds`
- **Status**: Aprovado.

## Teste 0.6 - Persistencia

- **Resultado esperado**: O estado do mundo e do personagem é mantido após restart do servidor.
- **Resultado real**: Após encerrar a tarefa do servidor e reiniciá-lo (para aplicar a nova configuração de coordenadas de spawn), o driver de armazenamento `file` carregou os dados persistidos com sucesso e o personagem do userId=1 foi carregado sem necessidade de nova criação.
- **Logs relevantes**:
  - `AttachSaveStorage took 0 seconds and 1 milliseconds, loaded 1 ChangeForms (Including 1 player characters)`
  - `Loading character ff000000` (em vez de `Creating character`)
- **Status**: Aprovado.

## Teste 0.7 - Chat Local

- **Resultado esperado**: Envio de mensagens em chat de proximidade.
- **Resultado real**: Não testado nesta fase, pois o chat local depende do sistema de chat autoritativo a ser implementado na Fase 1.
- **Status**: Pendente (Fase 1).

---

## Bugs Encontrados

```text
ID: BUG-001
Data: 2026-07-11
Build: dbbc6b7
Ambiente: Local
Passos: Spawnar com as coordenadas padrão [0,0,0] no worldspace de Tamriel (0x3c).
Resultado esperado: Personagem nascer no chão de forma estável.
Resultado real: Personagem spawna no ar a uma altura fatal e cai para a morte.
Gravidade: Média (bloqueio de onboarding).
Solução: Alterar o spawn inicial para uma célula de interior estática (ex: Taverna The Bannered Mare 0x162e2).
Bloqueia progresso? Não (resolvido por configuração).
```

---

## Decisao da Fase 0

- **Continuar**: Sim, progredir para a Fase 1 (Protótipo Técnico / Sandbox de RP).
- **Corrigir antes de avancar**: Nenhuma pendência crítica identificada.
- **Trocar abordagem**: Não.
- **Justificativa**: A viabilidade básica da plataforma SkyMP foi atestada com sucesso. O servidor bootou localmente, registrou múltiplas conexões com identificação correta de perfis, persistiu os dados de personagens no world database após o reinício do servidor e gerenciou eventos de morte/respawn nativos.
