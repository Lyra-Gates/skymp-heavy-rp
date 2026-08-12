# TASK-001 — Contrato progressivo de eventos CEF → Gamemode

**Status:** implementação local concluída; validação CEF real pendente  
**Dono inicial:** Core / Gamemode  
**Última atualização:** 2026-08-11

## Por que esta tarefa existe

Todo evento que sai da UI CEF é controlado por uma máquina de jogador e, portanto,
é uma intenção não confiável. O projeto já possui `core/ui-event-router.js`, mas o
envelope chegava ao callback de `phase0-basic.js` sem uma validação compartilhada.
Isso permitia que payloads malformados chegassem aos módulos e que cada feature
inventasse seu próprio limite de confiança.

Esta tarefa aplica a primeira camada comum sem substituir o protocolo do SkyMP,
sem converter o gamemode para TypeScript e sem alterar os schemas de gameplay já
existentes.

## Alterações desta entrega

| Local | Mudança | Motivo |
| --- | --- | --- |
| `core/ui-event-router.js` | `isValidEventEnvelope()` valida objeto, `type` string não vazio e limite de 128 caracteres | Bloquear envelopes malformados na fronteira CEF → servidor |
| `phase0-basic.js` | Recusa o envelope antes de logar, rotear ou comparar o tipo do chat | Evitar acesso inseguro a `uiEvent.type` |
| `core/ui-event-router.test.js` | Testes de array, tipo vazio e tamanho excessivo | Tornar o limite explícito e resistente a regressão |
| `governance-service.js` | Parser estrito de actorId, payload plano e allow-list de namespace de ação | Não deixar payload CEF malformado alcançar guarda ou comércio |
| `player-panel-service.js` | Schema explícito para `panel:social:rename` | Recusar array, ID textual ou alias excessivo antes da identidade/banco |
| `governance-service.js` | Schema de tipos para multa, pena, confisco e motivo | Impedir coercão permissiva de entradas CEF de guarda |
| `core/ui-event-gateway.js` | Extrai e instala o callback global SkyMP em adaptador injetável | Testar a fronteira CEF sem iniciar o jogo |
| `core/ui-event-rate-limiter.js` | Mede volume por `actorId + type`; só limita se configurado | Coletar evidência antes de escolher teto operacional |

## Decisões de compatibilidade

- O campo `data` **não** é validado pelo roteador. Cada domínio continua dono do
  schema do seu comando; centralizá-lo agora criaria acoplamento e risco de quebrar
  a UI existente.
- O comportamento atual de fallback multi-módulo foi preservado. Sua remoção exige
  inventário de handlers e teste in-game, pois alguns handlers existentes podem
  observar mais de um namespace.
- O limite de 128 caracteres se aplica somente ao nome do evento, não ao payload.

## Próximos passos, em ordem

1. **Concluído — módulos `governance` e `player-panel`:** os schemas de `data`
   existentes foram explicitados e testados. Novos eventos devem atualizar esta
   tabela antes de chegar ao banco ou ao domínio.
2. **Concluído em modo de medição — Core:** o contador existe por `actorId +
   event type`; o limite permanece desligado até a primeira sessão CEF real.
   A ativação exige registrar `UI_EVENT_RATE_LIMIT_MAX_EVENTS` e
   `UI_EVENT_RATE_LIMIT_WINDOW_MS` com base nessa medição.
3. **Concluído — Core + QA:** `installUiEventGateway()` é testado com mock de
   `mp`, incluindo envelope malformado e callback instalado.
4. **Concluído na fronteira global — Security:** logs registram somente tipo e
   categoria de `data`, nunca o payload bruto. Revisões de logs de domínio
   continuam obrigatórias por feature.
5. **Pendente de decisão de protocolo:** avaliar versionamento de mensagens e
   intents depois de observar tráfego CEF real; não há mudança de transporte
   nesta entrega.

## Entrega complementar — governança

O namespace `governance:interaction:*` agora aceita apenas actorIds inteiros ou
hexadecimais completos de até 8 dígitos e ações `guard.*`, `stall.*` ou `npc.*`.
Isso impede o comportamento permissivo de `parseInt` (por exemplo, aceitar lixo
após um FormID) e evita exceções de `action.startsWith()` em payloads do cliente.
As permissões, distância, estado e validações específicas continuam no domínio.

## Entrega complementar — gateway testável

O callback global agora é criado por `core/ui-event-gateway.js`. Os testes cobrem
recusa antes do despacho, chat válido, rejeição assíncrona do roteador e exceção
síncrona do chat. O item 3 dos próximos passos está concluído; falta somente a
validação in-game com a API real do SkyMP.

## Atualizacao de seguranca do gateway

O gateway agora registra somente o FormID do emissor, o `type` validado e a
categoria de `data` (`string`, `object`, `array`, `null` ou `absent`). O payload
bruto nao e registrado. Isso preserva o diagnostico da fronteira sem expor no
log texto de chat ou outros valores controlados pelo cliente.

Os testes do gateway cobrem esse contrato: o chat continua recebendo o texto
original, enquanto a saida de log nao o contem.

## Estado de verificacao em 2026-08-11

- `npm test` em `skymp/gamemode`: 531 testes aprovados.
- `npm run typecheck`: aprovado sem erros. A correcao de tipos do modulo
  regional nao o ativou; ele continua PARKED por decisao arquitetural.

## Configuração de medição de taxa

Por padrão, o contador observa todos os eventos e não rejeita nenhum. Após uma
sessão real, a operação pode definir os dois valores abaixo no `.env` do
gamemode para ativar o bloqueio por emissor e tipo:

```text
UI_EVENT_RATE_LIMIT_MAX_EVENTS=<valor medido>
UI_EVENT_RATE_LIMIT_WINDOW_MS=<janela em ms>
```

Se um dos valores estiver ausente ou inválido, o modo seguro é somente medição.

## Fora de escopo desta tarefa

- Protobuf, substituição do transporte SkyMP ou fork do cliente.
- Reativação de módulos PARKED.
- Alteração de regras de economia, combate, morte, voz ou política.
- Mudanças em `docs/technical/REVISAO_REALIDADE_COMPARTILHADA.md`, que possui
  edição local de outro agente e não faz parte desta tarefa.

## Critérios de aceite

- `npm test` em `skymp/gamemode` passa (execução em 2026-08-11).
- Eventos inválidos não chamam handlers nem acessam `uiEvent.type` em
  `phase0-basic.js`.
- Eventos existentes, como `cef::chat:send` e `panel:*`, preservam o formato.
- Nenhum arquivo de outro agente é modificado.

## Verificação desta entrega

- `npm test` em `skymp/gamemode`: aprovado.
- `node --test core/ui-event-router.test.js`: 9 testes aprovados.
- `node --test governance-service.test.js governance-service.hardening.test.js`: 7 testes aprovados; inclui payloads de ação malformados.
- `npm run typecheck`: aprovado sem erros. Esta tarefa nao introduziu falhas no
  roteador nem reativou modulos PARKED.
