# SPIKE — SkyVoice sobre LiveKit

> **Isto é um spike, não é produção.** Ele existe para responder uma pergunta
> que precisava de resposta antes de escolher entre o Plano A (captura na CEF) e
> o Plano B (captura no `voice-helper` nativo): **o transporte LiveKit funciona
> com um token emitido pelo nosso servidor, e o áudio atravessa?**
>
> A resposta é sim, medida contra um `livekit-server` real. Ver
> [`docs/technical/SKYVOICE_LIVEKIT_AUDIT.md`](../../docs/technical/SKYVOICE_LIVEKIT_AUDIT.md) §10–§11.

## O que ele prova

Dois participantes contra um `livekit-server` de verdade, com tokens assinados
pelo mesmo módulo que o gamemode usa (`skymp/gamemode/core/voice/livekit-token.js`):

- token aceito pelo servidor oficial, e token com secret errado **recusado** (401);
- nenhum API secret dentro do token que o cliente recebe;
- áudio publicado por A chega em B **através do SFU**, com o sinal preservado;
- PTT (parar/retomar captura) e mute duro (`unpublish`);
- câmera recusada pelo servidor — **com controle**, ver abaixo;
- reconexão com token novo, e o `actorId` sobrevivendo à troca de identidade;
- servidor inalcançável falha de forma capturável, sem derrubar o processo.

## O que ele NÃO prova

Está impresso na saída do próprio programa, para que ninguém leia só o placar:

- **voz inteligível ao ouvido humano** — não é medida, é julgamento. Mesma
  limitação registrada em `VOICE_NATIVE_HELPER.md` §8.2, e trocar de transporte
  não a resolve;
- dois clientes **Skyrim** reais;
- captura pela CEF ou pelo `voice-helper` (os participantes são processos Node);
- **origem não autorizada sem microfone** — isso é do `CefPermissionHandler`, do
  lado do client, e não existe neste spike;
- rede real: latência, perda e jitter fora de `127.0.0.1`.

## O controle da câmera

Vale destacar porque quase virou uma conclusão errada. Ao publicar vídeo com um
token restrito a `canPublishSources: ['microphone']`, o LiveKit **não devolve
erro de permissão** — ele ignora a publicação e o cliente estoura por timeout
(~10s).

Um timeout, sozinho, não prova permissão: poderia ser o `VideoSource` sem
quadros. Por isso o spike publica vídeo **duas vezes** — uma com o token
restrito, outra com um token de controle sem a restrição. O restrito estoura em
~10s; o controle publica em dezenas de milissegundos. É a diferença entre os
dois que prova a permissão, e ela roda toda vez, não uma vez.

## Como rodar

Precisa de um `livekit-server`. Baixe o binário oficial e **confira o checksum**
(`checksums.txt` acompanha cada release em `livekit/livekit`).

`livekit-spike.yaml`:

```yaml
port: 7880
bind_addresses: [127.0.0.1]
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50060
  use_external_ip: false
keys:
  skyvoice_spike: <um segredo qualquer para a bancada>
```

```bash
livekit-server --config livekit-spike.yaml
```

Noutro terminal:

```bash
npm install
LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=skyvoice_spike LIVEKIT_API_SECRET=<o mesmo> npm run spike
```

Sai `0` se todas as verificações passarem.

## Por que ele não vive em `voice-helper/tools/`

Aquele diretório é a bancada do **caminho legado** (`e2e-harness.js`,
`frame-probe.js`) e continua válido — o `voice-helper` não vai ser apagado. Este
spike testa outro transporte, tem dependência própria (`@livekit/rtc-node`) e é
descartável por natureza. Misturá-lo lá faria parecer que o helper depende do
LiveKit, o que não é verdade hoje.
