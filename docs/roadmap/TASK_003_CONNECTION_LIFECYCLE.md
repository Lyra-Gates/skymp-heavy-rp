# TASK-003 - Ciclo de conexao e whitelist

**Status:** boot real aprovado; validação com cliente pendente  
**Dono inicial:** Core / Gamemode  
**Ultima atualizacao:** 2026-08-11

## Problema

O SkyMP atualmente entrega conexoes ao gamemode por polling. O callback antigo
em `phase0-basic.js` iniciava uma verificacao assincrona de whitelist sem uma
identidade de sessao. Se o jogador desconectasse e o mesmo `userId` voltasse a
ser usado antes da resposta do banco, a promise antiga podia remover estado da
nova conexao.

O mesmo callback tratava ator ou profile ainda indisponivel no primeiro polling
como estado final. Nessas condicoes a whitelist nunca era iniciada para aquele
jogador, ate uma nova reconexao.

## Alteracoes

| Local | Mudanca | Motivo |
| --- | --- | --- |
| `core/connection-monitor.js` | Monitor injetavel com sessao por `userId` | Impedir que uma promise antiga afete uma sessao nova |
| `core/connection-monitor.js` | Tenta novamente enquanto ator ou profile nao foi publicado | Cobrir a janela normal de inicializacao da engine |
| `core/connection-monitor.js` | Limpeza idempotente de personagem e painel | Evitar dupla limpeza em recusa seguida de desconexao |
| `phase0-basic.js` | Usa o monitor como adaptador da API global `mp` | Tirar regra assincrona do arquivo de boot e permitir teste unitario |
| `core/connection-monitor.test.js` | Casos de ator/profile tardio, reconexao e recusa | Fixar o comportamento que antes dependia de timing |

## Contratos preservados

- Continua sendo polling a cada 2 segundos, com os limites atuais de userId
  (`1..10`) e profileId (`1..50`). Esta tarefa nao infere uma capacidade maior
  da API SkyMP nem altera a configuracao operacional.
- `whitelist.checkWhitelist()` continua sendo a autoridade para aprovar ou
  rejeitar e continua solicitando kick nas recusas conhecidas.
- Em erro tecnico do check, o monitor solicita kick e limpa somente a sessao
  ainda atual.
- O monitor nao importa servicos PARKED nem inicia modulos opcionais.

## Verificacao

- `node --test core/connection-monitor.test.js`: 3 testes aprovados.
- `npm test` em `skymp/gamemode`: 509 testes aprovados, incluindo este arquivo.
- `npm run typecheck`: o monitor nao adiciona erro. Restam somente os tres
  erros conhecidos de `economy-regional`, servico PARKED.

## Boot real executado em 2026-08-11

O procedimento `scripts/phase0/Start-Phase0Server.ps1 -Seconds 15` confirmou:

- gamemode `phase0-basic.js` carregado;
- banco inicializado e 4 modulos ativos (`death`, `governance`,
  `market-stalls`, `player-panel`);
- TCP `127.0.0.1:3000` e UDP `127.0.0.1:7777` em escuta;
- nenhum modulo falhou no boot.

O master local em `127.0.0.1:3001` estava desligado, portanto o servidor
registrou `ECONNREFUSED`. Isso nao invalida o smoke test, mas impede confirmar
login online e impede qualquer evidencia CEF sem clientes Skyrim reais.

## Proximo passo

Validar em servidor de teste tres sequencias: login normal, ator publicado apos
o primeiro polling e desconexao/reconexao rapida do mesmo slot. Registrar data,
versao do servidor e resultado antes de alterar os limites de polling.
