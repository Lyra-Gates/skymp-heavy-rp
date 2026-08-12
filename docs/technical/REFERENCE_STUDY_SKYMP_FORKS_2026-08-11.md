# Estudo de forks SkyMP - 2026-08-11

**Status:** pesquisa de triagem concluida; nenhuma dependencia ou codigo externo
foi incorporado.  
**Responsavel inicial:** Core / Gamemode  
**Escopo:** forks publicos relevantes no ecossistema SkyMP, comparados ao
projeto `skymp-heavy-rp`.

## Metodo e limites

Em 2026-08-11 foram consultados metadados e arvores de arquivos publicados no
GitHub. A pagina de forks do projeto principal era dinamica e tinha 163 forks;
esta nao e, portanto, uma auditoria linha a linha de todos eles. A selecao
abaixo prioriza forks com uma capacidade nao presente no nosso projeto ou com
uma pratica arquitetural que resolve um risco atual.

Todos os forks listados como forks pelo GitHub retornaram licenca `NOASSERTION`.
Isto permite estudar publicamente o desenho, mas nao autoriza presumir que
trechos podem ser copiados. Antes de reutilizar codigo, confirmar autoria,
licenca e obrigacoes com a equipe responsavel.

## Achados confirmados

| Referencia | Evidencia encontrada | Valor para Heavy RP | Decisao |
| --- | --- | --- | --- |
| [Metadraconis/skymp-vgr](https://github.com/Metadraconis/skymp-vgr) | `docs_livekit_voice_chat.md`, infraestrutura Terraform de voz, `voice-agent` em Go e sobreposicao do SDK LiveKit | Arquitetura concreta para voz de proximidade: token de curta duracao, posicao, PTT e limite de streams | Referencia para avaliar uma migracao do VOIP proprio; nao integrar agora |
| [Moo-Core/SkyrimRP-client](https://github.com/Moo-Core/SkyrimRP-client) | `client_intent.proto` com `session_id`, sequencia monotona, timestamp e acoes tratadas como pedidos nao confiaveis | Confirma a direcao da nossa validacao de eventos CEF e sugere evolucao: idempotencia e ordenacao por sessao | Adotar o padrao gradualmente nos eventos de maior valor |
| [SkyrimRoleplay/skyrp](https://github.com/SkyrimRoleplay/skyrp) | documentacao propria de voz, deploy/nginx, backend, launcher e cliente | Bom referencial operacional para separar jogo, autenticacao, launcher e deploy | Usar apenas como checklist de operacao; a propria documentacao alerta que voz nao e flag de build |
| [skyrim-roleplay/skymp](https://github.com/skyrim-roleplay/skymp) | scripts de deploy, Docker e pipelines CI | Confirma que deploy versionado deve ser um eixo do projeto, nao uma etapa manual | Referencia secundaria; nao ha diferencial confirmado nesta triagem |
| [Red House public](https://github.com/alekcey0211/red-house-public) | referencia local ja registrada em `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` | Sistemas RP e conteudo historico | Apenas referencia: GPL-3.0 exige revisao juridica antes de qualquer reutilizacao |

## O que implementar a partir disto

### 1. Eventos como intents, nao como fatos

O gateway ja passou a validar envelope, formato e limite de eventos. A proxima
evolucao deve acrescentar, nos eventos que movem ouro, itens ou permissao:

- `requestId` opaco e unico por sessao;
- rejeicao de repeticao por uma janela curta;
- versao do contrato por tipo de evento;
- resposta explicita de sucesso, recusa de negocio ou falha tecnica.

O servidor continua sendo a autoridade. Posicao, quantidade, alvo e timestamp
enviados pelo cliente sao apenas alegacoes a validar.

### 2. Voz: avaliar migracao, nao adicionar um segundo sistema

O projeto ja possui `voip-service.js`, com autenticacao por ticket, papeis de
sender/listener e relay de proximidade testados. O `skymp-vgr` demonstra uma
alternativa: SkyMP gera token LiveKit, um agente de voz calcula proximidade e o
cliente transmite/renderiza audio. Isto requer, alem de codigo, um servidor
LiveKit/TURN, portas UDP, segredo de API, rotacao de token e telemetria.

Logo, LiveKit nao deve ser habilitado em paralelo ao relay atual nem tratado
como configuracao simples. A tarefa correta e comparar custo, qualidade de
audio, limite de participantes, moderacao e operacao; entao decidir por manter
e endurecer o VOIP atual ou executar uma migracao planejada.

Pre-requisitos para abrir esta tarefa:

1. ambiente de homologacao com LiveKit e TURN;
2. revisao de seguranca de CEF/microfone e permissoes;
3. limite de streams simultaneos por ouvinte e teste de carga;
4. politica de moderacao, denuncia e retencao para voz;
5. owner operacional para o novo servico.

### 3. Operacao reproduzivel

Os forks mais maduros separam deploy, proxy, backend e launcher. Para este
projeto, a proxima melhoria operacional e produzir um runbook sem segredos
contendo: ordem de boot, portas, health checks, migration antes do deploy,
rollback e logs a coletar. Isto vem antes de adicionar mais modulos de jogo.

## Itens deliberadamente nao adotados

- Nenhum codigo de fork foi cherry-picked.
- Nenhuma licenca `NOASSERTION` foi tratada como permissiva.
- Voz LiveKit nao foi ligada: ela exige infraestrutura e validacao de cliente.
- O modulo `economy-regional` permanece PARKED. Ele possui transferencia entre
  tesouros em duas atualizacoes SQL independentes, alem de referencias que
  atualmente falham no typecheck. Ativa-lo agora permitiria perda ou criacao
  indevida de saldo em caso de falha parcial.

## Fontes primarias

- [Repositorio e forks do SkyMP](https://github.com/skyrim-multiplayer/skymp/forks)
- [Documentacao de voz do skymp-vgr](https://github.com/Metadraconis/skymp-vgr/blob/main/docs/docs_livekit_voice_chat.md)
- [Contrato ClientIntent do SkyrimRP-client](https://github.com/Moo-Core/SkyrimRP-client/blob/main/skymp5-client/src/proto/skyrimrp/v1/client_intent.proto)
- [Nota tecnica de voz do skyrp](https://github.com/SkyrimRoleplay/skyrp/blob/main/docs/skyrp_voice_chat.md)

## Proxima revisao

Reexecutar a triagem antes de iniciar voz, launcher ou autenticacao externa;
forks mudam rapidamente e a data de push deve ser registrada na nova decisao.
