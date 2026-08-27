# ADR-012 — Bootstrap de conexão do launcher é fail-closed

Status: **IMPLEMENTED**. Data da decisão e validação: 2026-08-26.

## Contexto

Depois que a fila admite o jogador, o launcher precisa entregar ao cliente
SkyMP três informações coerentes: a sessão opaca, o endereço do servidor e a
ordem para usar esse endereço diretamente. Esse handoff é feito por dois
arquivos com contratos diferentes:

- `Data/Platform/Plugins/skymp_config.json`, que recebe `session` no formato
  `ticket:<ticket>` e `serverAddress`;
- `Data/Platform/Plugins/skymp5-client-settings.txt`, que recebe o ticket cru
  em `gameData.session`, `server-ip`, `server-port`, `master:""` e
  `server-info-ignore:true`.

O fluxo anterior editava esses arquivos dentro do handler Electron, engolia
falhas de leitura/escrita e iniciava o SKSE mesmo assim. Também usava `exec`
para abrir o executável e retornava sucesso antes de saber se o Windows havia
criado o processo. Na inspeção do cliente distribuído pelo launcher externo de
referência, ficou confirmado que, sem `server-info-ignore:true`, o cliente tenta
consultar o gateway público `/serverinfo` antes de usar o peer configurado. O
nosso servidor não depende desse gateway.

Esse comportamento produzia três riscos:

1. iniciar com ticket ou destino antigo depois de uma falha silenciosa;
2. permitir que `profileId`, `token` ou `launcherTicket` legados continuassem
   no arquivo e confundissem a fronteira de identidade online;
3. mostrar “Skyrim iniciado” quando o processo nunca nasceu.

## Decisão

1. A preparação da conexão fica isolada em
   `apps/launcher/electron/connection-settings.mjs` e lança erro com código
   estável em qualquer inconsistência.
2. Ticket vazio, caminho inválido, host/porta inválidos, JSON existente
   corrompido ou raiz que não seja objeto são falhas bloqueantes.
3. Os dois arquivos são lidos antes da primeira escrita. Opções legadas
   desconhecidas são preservadas, mas `profileId`, `token` e `launcherTicket`
   são removidos no nível superior e em `gameData`.
4. A identidade permanece server-side: o cliente fornece apenas a sessão
   opaca; `offlineMode:false` resolve `profileId` pelo Master API conforme o
   [ADR-001](ADR_001_ONLINE_PROFILE_ID_IS_ACCOUNT_ID.md).
5. O destino direto sempre inclui `server-info-ignore:true`. Retirar esse campo
   exige implementar e testar um `/serverinfo` compatível antes.
6. Cada arquivo é publicado por temporário no mesmo diretório, com flush,
   tratamento de read-only e restauração do modo anterior. Depois da escrita,
   ambos são relidos e comparados com o contrato solicitado.
7. Só depois dessa verificação o launcher encerra processos antigos e chama
   `spawn(exePath, [], { cwd, shell:false, detached:true, stdio:'ignore' })`.
8. O IPC `launch-game` devolve `{ok,pid?,code?,error?}`. Sucesso só existe após
   o evento `spawn` e um PID inteiro positivo; erro, ausência de PID e timeout
   são falhas visíveis na UI.

## Motivos

- **Falha fechada:** configuração de conexão é credencial e roteamento, não uma
  preferência cosmética. Continuar depois de uma escrita incompleta mascara a
  causa e pode usar estado antigo.
- **Autoridade do servidor:** remover identificadores declarados pelo cliente
  evita reintroduzir o bypass que `offlineMode:false` existe para impedir.
- **Compatibilidade com o cliente real:** os dois formatos de sessão não são
  redundância inventada pelo launcher; cada arquivo é consumido por uma camada
  diferente do cliente SkyMP.
- **Independência operacional:** `server-info-ignore:true` usa o host/porta que
  o projeto controla e elimina uma dependência não declarada do gateway
  público.
- **Criação de processo verificável:** `spawn` sem shell evita interpretação de
  caminho pelo shell e fornece eventos próprios de sucesso/erro. Esperar o
  evento impede falso positivo na interface.
- **Testabilidade:** módulos sem dependência do runtime Electron permitem
  simular filesystem e processo em testes unitários.

## Consequências

- Um arquivo JSON legado corrompido agora bloqueia JOGAR e precisa ser reparado,
  em vez de ser sobrescrito silenciosamente.
- Se a configuração não puder ser confirmada, processos do jogo já abertos não
  são encerrados e um novo SKSE não é iniciado.
- A UI recebe códigos operacionais estáveis e nunca fica presa em estado
  `isPlaying` depois de exceção no polling.
- A publicação é atômica por arquivo. Os dois arquivos não formam uma transação
  única de filesystem; a releitura e o bloqueio do spawn impedem usar um par
  não confirmado, mas rollback conjunto continua sendo uma possível evolução.
- O launcher ainda precisa de homologação real com dois clientes. Teste
  automatizado prova o contrato local, não o handshake completo com Windows,
  SKSE, cliente SkyMP, Game API e Master API.

## Alternativas rejeitadas

- **Continuar após erro e deixar o cliente tentar:** transforma configuração
  velha em comportamento aparentemente aleatório e dificulta diagnóstico.
- **Gravar `profileId` derivado do Discord:** o cliente não é autoridade de
  identidade e Discord snowflake não é o namespace numérico de gameplay.
- **Manter o gateway público como fallback implícito:** adiciona uma dependência
  externa fora do controle operacional do projeto e muda o destino efetivo.
- **Usar `exec` ou `shell:true`:** desnecessário para abrir um executável
  conhecido e pior para caminhos, erros e segurança.
- **Considerar a chamada de criação como sucesso imediato:** não distingue uma
  solicitação enviada de um processo realmente criado.

## Evidência

- `connection-settings.test.mjs`: 7 cenários para contratos, legado, ticket
  vazio, JSON inválido, IPv6, read-only e validação de host/porta.
- `game-process.test.mjs`: 5 cenários para opções do spawn, erro síncrono,
  evento `error`, PID inválido e timeout.
- `launch-contract.test.mjs`: 3 contratos estáticos para ordem
  preparar → encerrar → iniciar, retorno estruturado, ausência de shell e
  presença de `server-info-ignore`.
- `auth-boundary.test.js`: impede regressão para identidade controlada pelo
  cliente.
- Em 26/08/2026: launcher com 85/85 testes, typecheck e lint aprovados;
  contratos de auth/gamemode com 12/12 testes; `npm run build` completou
  renderer, main, preload e instalador NSIS.

## Próxima validação obrigatória

Executar o roteiro com dois clientes reais e registrar, sem credenciais:

1. ticket admitido e consumido uma única vez;
2. processo SKSE criado e PID reportado;
3. conexão chegando ao servidor configurado sem chamada obrigatória ao gateway;
4. Master API resolvendo a sessão para o `accountId` correto;
5. segundo cliente recebendo identidade própria e desconexão liberando a vaga.
