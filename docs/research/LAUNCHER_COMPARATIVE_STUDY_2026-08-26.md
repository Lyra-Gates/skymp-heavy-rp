# Estudo comparativo do launcher SkyrimRP 1.6.3

Data: 2026-08-26.

Escopo: comparação estática entre `apps/launcher` deste repositório e o
launcher público de `Skyrim-Roleplay-Brasil/launcher`, com foco em conexão,
autenticação, distribuição, atualização e diagnóstico. Nenhum executável
externo foi iniciado. O instalador 1.6.3 foi apenas baixado, validado por hash e
extraído para inspeção estática.

## Resumo executivo

O launcher externo é uma referência útil para o bootstrap do cliente e para o
motor de atualização, mas sua autenticação não deve ser transplantada.

- A autenticação local é mais forte: `offlineMode=false`, sessão opaca e
  `profileId` resolvido pelo Master API. O launcher externo conecta inicialmente
  com um `profileId` fornecido pelo cliente e só depois envia um JWT próprio em
  `auth:session`. Copiar esse desenho reabriria o AUTH-01.
- O principal achado para a falha de conexão é `server-info-ignore`. O cliente
  externo grava esse campo como `true`; o nosso launcher não. Na implementação
  de `skymp5-client.js` inspecionada, sem esse campo o cliente tenta consultar
  `/api/servers/<masterKey>/serverinfo` no master antes de conectar ao peer.
  Como o nosso settings grava `master: ""`, o fallback é
  `https://gateway.skymp.net`, onde o servidor privado não está cadastrado.
- O segundo achado P0 é o tratamento de erro do nosso `launch-game`: qualquer
  falha ao gravar a sessão/settings é apenas registrada no console; o Skyrim é
  aberto mesmo assim. Isso permite iniciar com configuração antiga, vazia ou de
  outro servidor. O launcher externo falha fechado nesse ponto e trata arquivo
  read-only explicitamente.
- O atualizador externo é substancialmente mais robusto: manifesto v2 por
  arquivo, staging, validação de tamanho e SHA-256, ativação atômica, journal,
  backup e rollback. O nosso valida o hash do ZIP, mas extrai diretamente sobre
  o jogo e só depois grava carimbos de versão. Uma falha no meio pode deixar uma
  instalação híbrida sem rollback.

## Evidência coletada

### Artefato externo

- Release: `v1.6.3`, publicada em 2026-08-25.
- Instalador: `SkyrimRP-Launcher-Setup.exe`, 78.496.066 bytes.
- SHA-256 observado:
  `63ea5796febfce41b8fb39336b56e7fd3b530bfb8aca5b41e336d622bad8d417`.
- Assinatura Authenticode: `NotSigned`.
- Pacote Electron extraído: versão `1.6.3`; o `package.json` empacotado declara
  licença MIT, embora o repositório público não contenha um arquivo de licença
  nem o código-fonte do launcher.
- Manifesto v2 público: perfis `client-1.6` e `client-1.7.99`, canais de rollout,
  inventário por arquivo e destino `game.skyrimrp.com.br:7777`.
- O pacote `srp-client-1799` também foi validado contra o SHA-256 publicado antes
  da inspeção.

### Validação local

- `apps/launcher`: 70/70 testes aprovados.
- `apps/launcher`: `npm run typecheck` aprovado.
- Trust boundary/config doctor: 12/12 testes aprovados.
- Os testes atuais comprovam o uso de `gameData.session` e a remoção de
  `profileId`, mas não comprovam o conjunto completo de campos necessários para
  alcançar o peer nem o comportamento quando o settings é read-only.

## Comparação do fluxo de conexão

| Etapa | SkyMP Heavy RP | Launcher externo 1.6.3 | Avaliação |
|---|---|---|---|
| Login | Discord OAuth; troca server-side | usuário/senha; bearer token | Manter o local |
| Entrada/fila | launch ticket de uso único e fila rotativa | `/auth/launch-ticket` | Local tem cadeia mais explícita |
| Identidade inicial | sessão opaca em `gameData.session` | `gameData.profileId` client-side | Local é mais seguro |
| Resolução da identidade | Master API retorna `accountId` | servidor aceita perfil local e recebe JWT depois | Não copiar o modo externo |
| Descoberta do peer | `master:""`, IP e porta; sem bypass | IP/porta e `server-info-ignore:true` | P0 local |
| Token adicional | sessão no login nativo | `srp-token.txt`, depois `auth:session` custom packet | Específico do gamemode externo |
| Escrita do settings | write direto; erro não bloqueia spawn | write-then-read-only; erro bloqueia spawn | P0 local |
| Início do jogo | `exec` após `taskkill`; resultado não observado | `spawn`, espera evento `spawn`/`error` | Adotar o padrão comportamental |

## Causa provável da conexão

O cliente SkyMP inspecionado resolve o destino assim:

1. Lê `server-master-key`; se ausente, deriva `<server-ip>:<server-port>`.
2. Se `server-info-ignore` não for verdadeiro, consulta
   `{master}/api/servers/{masterKey}/serverinfo`.
3. `master: ""` cai para `https://gateway.skymp.net`.
4. Somente com `server-info-ignore:true`, ou com um endpoint `/serverinfo`
   próprio funcional, ele usa diretamente `server-ip` e `server-port`.

Nosso painel implementa a resolução
`GET /api/servers/:masterKey/sessions/:session`, mas não implementa
`GET /api/servers/:masterKey/serverinfo`. Assim, para o cliente observado, o
settings atual pode falhar antes de chegar ao UDP 7777.

Há duas soluções válidas:

1. Curto prazo: gravar `server-info-ignore:true`, usando diretamente o peer já
   definido pelo launcher. A autenticação via sessão/Master API no servidor não
   muda. A paridade continua sendo verificada pelo launcher em `game-api`.
2. Longo prazo: implementar `/serverinfo`, apontar o `master` do cliente para o
   painel e gravar `server-master-key`. Essa opção centraliza descoberta,
   public keys e metadata, mas amplia o contrato operacional.

Para a alfa, a primeira opção é menor e compatível com a arquitetura existente.

## Falhas locais que podem mascarar a causa

### P0 — spawn depois de falha ao gravar credenciais

`launch-game` envolve toda a escrita em `try/catch`, imprime o erro e continua
para o `exec` do SKSE. O renderer recebe `true` mesmo que:

- o ticket esteja vazio;
- o JSON existente esteja inválido;
- o arquivo esteja read-only;
- não haja permissão de escrita;
- o settings final não contenha a sessão correta.

O resultado percebido é “o jogo abre, mas não conecta”, embora a falha real
tenha ocorrido antes do processo nascer.

### P0 — ausência de bypass ou descoberta privada

O launcher grava `master: ""`, mas não grava `server-info-ignore` nem um master
privado capaz de servir `/serverinfo`.

### P1 — duas representações da mesma sessão

`skymp_config.json` recebe `ticket:<token>`; `skymp5-client-settings.txt`
recebe o token cru. O Master API tolera o prefixo, mas o arquivo realmente lido
pelo cliente deve permanecer explicitamente documentado e testado para evitar
que uma correção futura altere só um dos dois.

### P1 — diagnóstico parcial de disponibilidade

O indicador “Online” consulta apenas `http://<SERVER_IP>:7758/health`. Ele não
prova que:

- o painel/Master API está acessível;
- o banco resolve a sessão;
- o processo SkyMP escuta em UDP 7777;
- o cliente consegue resolver o destino sem consultar o gateway público.

### P1 — hosts e protocolos acoplados

O mesmo `SERVER_IP` é usado para o jogo e para a API; a API é sempre HTTP. Em
produção é preferível separar `GAME_SERVER_HOST`, `GAME_SERVER_PORT`,
`GAME_API_BASE_URL` e `PANEL_BASE_URL`, permitindo TLS para APIs sem confundir o
hostname/porta UDP do jogo.

## Comparação de atualização

### Pontos fortes locais

- SHA-256 obrigatório antes de extrair cada pacote.
- Manifestos indisponíveis falham fechado quando distribuição está configurada.
- Verificação de espaço em disco.
- Modpack em partes e concorrência limitada na paridade.
- Verificação de load order, masters e Creation Club mais profunda que a
  apresentada pelo launcher externo.

### Lacunas em relação ao manifesto v2 externo

- Extração é in-place, sem staging/ativação atômica.
- Não há journal nem rollback de arquivos já substituídos.
- O estado instalado usa versão/contentSig por pacote, não inventário de bytes
  por arquivo.
- `VERIFY` e `REPAIR` não possuem um único motor transacional compartilhado.
- Não há allowlist explícita de hosts para downloads nem validação própria de
  cada redirecionamento.
- Não há validação explícita de path traversal do inventário antes da extração.
- Uma queda após extrair e antes de gravar o stamp deixa o estado ambíguo; uma
  queda no meio da extração pode deixar mistura de versões.

O modelo externo deve ser adotado como arquitetura, reimplementado no código
AGPL local e coberto por testes próprios; não é necessário copiar seu código.

## Segurança e operação

- Ambos os launchers usam `contextIsolation:true` e `nodeIntegration:false`.
- Ambos desativam o sandbox do renderer/preload por razões de compatibilidade.
- O launcher local restringe melhor a navegação da janela principal e mantém os
  tickets fora do renderer.
- Ambos persistem sessão local em texto recuperável pelo usuário da máquina.
  Isso não torna o cliente confiável; o servidor deve continuar validando tudo.
- O instalador externo analisado não possui assinatura Authenticode. O nosso
  pipeline suporta assinatura, mas ainda não existe instalador assinado. Logo,
  o projeto externo não resolve esse bloqueio operacional.

## Plano recomendado

### P0 — antes do próximo teste com dois clientes

1. Extrair a escrita de conexão para uma função pura e testável.
2. Exigir ticket não vazio e autenticação presente.
3. Gravar o settings de forma atômica, removendo/restaurando read-only quando
   necessário.
4. Incluir `server-info-ignore:true` no caminho direto, ou implementar e testar
   `/serverinfo` antes de omitir esse campo.
5. Ler de volta o settings e validar destino + sessão antes do spawn.
6. Trocar `exec` por `spawn(exePath, [], {cwd})`, aguardar `spawn`/`error` e
   devolver falha real ao renderer.
7. Adicionar testes para arquivo read-only, ticket vazio, JSON legado, destino
   direto e erro de spawn.

### P1 — antes da distribuição fechada

1. Separar URLs do painel, game-api e host UDP.
2. Fazer `/health` expor dependências sem vazar segredos e criar preflight do
   launcher com fases nomeadas.
3. Registrar um `launcher.log` com `PLAY-CONFIG`, `PLAY-TICKET`, `PLAY-SPAWN` e
   códigos seguros, sem imprimir credenciais.
4. Introduzir manifesto v2 local com canais `canary/stable`, runtime compatível
   e inventário por arquivo.
5. Migrar instalação para staging + ativação atômica + rollback.

### P2 — maturidade operacional

1. Assinar e timestamp do instalador.
2. Considerar proteção OS-bound para a sessão persistida.
3. Assinar o manifesto ou separar sua autoridade da mesma origem que hospeda os
   pacotes, reduzindo o impacto de comprometimento único do CDN.

## Decisão

Usar o launcher externo como referência para:

- bootstrap direto com `server-info-ignore`;
- escrita fail-closed e diagnóstico;
- canais/perfis de cliente;
- manifesto por arquivo;
- atualização transacional e rollback.

Não adotar:

- `profileId` fornecido pelo cliente como identidade nativa;
- autenticação somente depois que o ator já foi criado;
- arquivos, marcas ou assets externos.

A implementação de 26/08/2026 corrigiu o bootstrap P0 antes de ampliar o
escopo do atualizador:

- `connection-settings.mjs` passou a validar ticket, host e porta, preservar
  opções legadas conhecidas, remover credenciais fornecidas pelo cliente,
  gravar os dois contratos de conexão com substituição por arquivo temporário,
  restaurar read-only e reler o resultado antes do spawn;
- o caminho direto agora inclui `server-info-ignore:true`, mantendo
  `offlineMode:false` e a sessão opaca resolvida pelo Master API;
- `game-process.mjs` substituiu o `exec` por `spawn` direto, sem shell, e só
  confirma sucesso após o evento `spawn` e a validação do PID;
- o IPC e a UI agora usam resultado estruturado e exibem falha real, sem
  iniciar o Skyrim quando a preparação da conexão falha;
- testes unitários e de contrato cobrem JSON legado/corrompido, read-only,
  ticket vazio, destino direto, ordem preparação → encerramento → spawn e
  erros de criação do processo.

O próximo marco continua sendo o teste operacional com dois clientes reais.
Somente depois dele faz sentido promover as melhorias transacionais P1 do
atualizador.
