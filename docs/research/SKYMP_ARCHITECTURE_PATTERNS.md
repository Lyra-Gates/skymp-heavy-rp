# Padrões arquiteturais observados

## RECOMMENDED

### Intent -> validação -> transação -> evento -> projeção

O cliente envia intenção mínima. O servidor resolve personagem, target e permissões, valida estado/revisão, grava em transação MariaDB, registra auditoria e só então publica resultado para A/B/C e UI. Aplicável a trade, propriedade, facção, crime e morte.

### Identidade em quatro camadas

`Account -> Session -> Character -> Identity`. Account autentica; Session prova presença; Character contém estado persistente; Identity decide o que outro personagem conhece. Alias/disfarce nunca altera a identidade real usada pela autoridade.

### Módulos explícitos e fail-closed

O `module-registry` local é uma boa base. Cada módulo deve declarar dependências, feature flag, comandos, listeners, health check, versão de schema e shutdown. Não fazer auto-scan de diretório em produção.

### Repositório e transação MariaDB

Serviços de domínio não executam SQL disperso. Repositórios recebem uma conexão/transação; mutations econômicas usam ledger, unique idempotency key e compare-and-set. O padrão conceitual de enricomalta é útil, mas a implementação Mongo não é compatível.

### Manifesto canônico e autenticado

Ordenação determinística, path normalizado, tamanho e SHA-256 por arquivo, dependências de plugins e assinatura Ed25519. O launcher verifica antes de iniciar; o servidor registra a versão aceita. Inspirado no F02K.

### Sessões opacas e curtas

Tickets com subject interno, character slot, audience, issued-at, expiry, nonce e key id. Consumo/replay são controlados no servidor; logs nunca exibem token.

### Estado compartilhado versionado

Cada agregado relevante possui `revision`. Pacotes de mutação carregam intent e expected revision quando apropriado; resultados carregam revision nova. Reconnect recebe snapshot autoritativo, não reexecuta intents antigas.

### UI como apresentação hostil

CEF/UI não é trust boundary. Validar schema, tamanho, frequência e enum de ação no gateway; nunca aceitar preço, saldo, cargo ou owner calculado na UI.

## OPTIONAL

### Event bus in-process

Útil para desacoplar audit log, refresh de painel e métricas, desde que eventos sejam tipados, síncronos quando a ordem importa e tenham política de erro. Não usar como substituto de transação.

### Bridge SkyMP <-> backend

Boa para autenticação, administração e projeções web. Deve ter timeout, circuit breaker, idempotência e autenticação mútua. O loop de gameplay crítico não deve depender de uma chamada HTTP remota por ação.

### LiveKit para voz

Pode simplificar NAT, transporte e operação. Exige spike com 10/30/50/100 jogadores, custo, latência, reconexão, cell transition, mute e degradação. Adotar apenas substituindo o stack atual de modo planejado.

### Native API extensions

ObjectReference, Camera, Input e raycast podem habilitar portas, containers, carry e carroças. Exigem fork mínimo, testes por versão do Skyrim e plano de upstream/rebase.

## AVOID

- Cliente autoritativo para inventário, ouro, posição administrativa, property target ou rank.
- Auto-carregar qualquer arquivo encontrado em `modules/`.
- Polling global por tick e loops `players x players` sem spatial partition/cell index.
- Duas fontes persistentes para o mesmo dado (MariaDB e Mongo) ou dois stacks de voz permanentes.
- Retries cegos de POST/DELETE sem idempotency key.
- Restaurar serviços PARKED/DEAD apenas porque os arquivos existem.
- Misturar estado nativo do mundo e plataforma web sem owner explícito.
- Tratar documentação, UI ou DTO como prova de sistema funcional.

## Fluxo ideal

```text
CEF/client intent
  -> UI event gateway (schema/rate/size)
  -> session + character resolver
  -> domain service (permission/range/state)
  -> MariaDB transaction + idempotency + audit
  -> domain event
  -> SkyMP projection to players A/B/C
  -> panel/web/Discord projections
```
