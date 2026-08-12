# 05 — theZebco/skymp

## Resumo e diferença do upstream

Snapshot `d7e2166` (2026-08-01): 7 commits à frente, 1 atrás, 53 arquivos divergentes. Implementa um vertical de voz LiveKit atravessando cliente TypeScript, servidor, C++, agente Go e Terraform.

## Arquitetura de voz

```text
player/cell lifecycle -> server voiceSystem.ts -> scoped voice config/token
  -> client voiceChatService.ts -> native VoiceChat.cpp
  -> LiveKit room/audio tracks <- voice-agent/infra
```

Arquivos: `voiceChatService.ts`, `voiceSystem.ts`, `VoiceChat.cpp/.h`, `voice-agent/`, `infra/voice/`, docs. O fork também altera create/destroy actor, movement/cell data e networking para alimentar positional voice.

## Segurança e sincronização

Autoridade `HYBRID`: servidor deve escolher sala, identidade, range mode e autorização; cliente inevitavelmente controla captura/playback, mas não pode emitir token arbitrário. Tokens devem ter audience/room/identity/TTL; mute disciplinar precisa ser server-side. Testar reconnect, troca de célula, actor destruction, token expirado, duplicidade de tracks e race entre movimentos.

## Performance

LiveKit oferece infraestrutura própria de SFU, mas não prova escala do gamemode. Medir CPU do C++/CEF, banda por participante, interest management, 10/30/50/100 usuários, whisper/normal/shout, salas/células e degradação de rede. 200 jogadores é cenário de pesquisa.

## Comparação e recomendação

O Heavy RP usa `voip-service.js` + helper UDP próprio. Não manter ambos permanentemente. `RESEARCH_MORE`: construir spike com a mesma matriz e decidir migração total ou manutenção do stack atual. O design LiveKit é mais completo em NAT/transporte; o stack local é menor e controlável. Licença `NOASSERTION`/`TERMS.md`: não importar C++/Go sem revisão.
