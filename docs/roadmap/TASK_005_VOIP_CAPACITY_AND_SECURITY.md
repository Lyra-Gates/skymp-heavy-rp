# TASK-005 - VOIP: capacidade e seguranca do relay

**Status:** protecoes de protocolo implementadas; homologacao com audio real pendente  
**Dono inicial:** Core / Client  
**Ultima atualizacao:** 2026-08-11

## Estado atual

O projeto ja possui voz de proximidade propria. O helper nativo captura o
microfone fora do CEF e envia PCM para `voip-service.js`; o servidor entrega o
frame somente aos listeners na mesma celula e dentro do alcance. Isto evita
reabrir globalmente a permissao de microfone do Chromium embutido.

O sistema tem autenticacao por ticket de uso unico, separacao sender/listener,
mute por ator e testes de proximidade/reconexao.

> **Revisao de 14/08/2026.** A frase original terminava com "ele nao deve
> coexistir com um segundo sistema LiveKit". A intencao continua certa — nao
> queremos dois sistemas de voz **ativos ao mesmo tempo** — mas a redacao
> proibia tambem a fase de transicao, que e justamente como se migra sem um
> corte. O que vale: um transporte ativo por vez, escolhido por `VOICE_BACKEND`
> (`legacy` por padrao), com os dois caminhos presentes no codigo durante a
> migracao. Ver [`SKYVOICE_LIVEKIT_AUDIT.md`](../technical/SKYVOICE_LIVEKIT_AUDIT.md) §7.4.

## Alteracao feita nesta tarefa

| Protecao | Motivo |
| --- | --- |
| Token bucket de 60 frames/s, burst 12, por conexao | Frame tem 20 ms; impedir multiplicacao de banda por flood |
| Socket atual e autenticado exigido em voz/sinalizacao/mute | Impedir que conexao sem auth ou socket antigo altere a cena |
| `maxPayload` de 32 KiB no WebSocket | Limitar memoria antes de converter a entrada em JSON |
| Teto existente de 8192 caracteres Base64 por frame | Impedir frame individual anormalmente grande |

## Risco de escala que continua relevante

O formato atual e PCM 48 kHz mono em Base64. Um locutor normal gera cerca de
128 KiB/s no fio antes de overhead; no relay, a saida cresce com o numero de
ouvintes proximos. A protecao evita abuso, mas nao muda esse custo fisico.

Antes de abrir para muitos jogadores, medir com audio real: CPU do helper e do
CEF, latencia, perda, GC do Node, bytes por segundo e qualidade com 5, 10 e 20
ouvintes na mesma celula.

## Decisao futura: manter ou migrar

`Metadraconis/skymp-vgr` e referencia para uma eventual migracao para LiveKit,
nao um patch para aplicar. LiveKit exige SFU/TURN, novo segredo operacional,
ports UDP, tokenizacao e observabilidade. A decisao depende do teste de carga
do relay atual e do custo de operar essa infraestrutura.

## Criterio para encerrar

- Dois clientes Skyrim reais falam e ouvem nos limites de alcance.
- PTT/mute nao vaza audio apos desconexao ou troca de helper.
- Flood intencional e descartado sem degradar outros jogadores.
- Carga de 20 ouvintes tem metricas registradas e limite operacional decidido.
