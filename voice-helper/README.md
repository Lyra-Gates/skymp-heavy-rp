# voice-helper

Executável Windows que captura o microfone **fora do navegador embutido do
client SkyMP** e envia os quadros para o `voip-service` do gamemode, que
retransmite por proximidade.

Existe porque o CEF do client não libera `getUserMedia`, e a flag do Chromium que
liberava foi **removida de propósito** na SkyrimPlatform 2.1 — revertê-la
exporia o microfone do jogador a qualquer servidor SkyMP que ele conectasse
depois. A arquitetura e o porquê estão em
[`docs/technical/VOICE_NATIVE_HELPER.md`](../docs/technical/VOICE_NATIVE_HELPER.md).

> ⚠️ **Fase 1 — prova de conceito.** O código deste diretório **nunca foi
> compilado**: a máquina onde foi escrito não tem Visual Studio, CMake nem vcpkg
> (evidência em VOICE_NATIVE_HELPER.md §8, reverificada em §8.1 — continua sem).
> O pipeline servidor→navegador foi validado com a sonda em Node
> (`tools/frame-probe.js`); a captura WASAPI não.
> Trate `CMakeLists.txt`, `vcpkg.json` e `src/main.cpp` como **não verificados**
> até o primeiro build passar.

## Limitações desta fase (deliberadas)

- **O ticket é passado à mão**, por linha de comando. Não há handoff automático
  entre o jogo e o helper — é trabalho da Fase 3. Para conseguir ler o ticket
  durante um teste manual existe um andaime temporário
  (`VOIP_DEBUG_EXPOSE_TICKET`), descrito em VOICE_NATIVE_HELPER.md §11.
- ~~**O helper e a UI do mesmo jogador não coexistem.**~~ **Resolvido em
  07/08/2026.** O `auth` passou a levar `role` (`listener` para a UI, `sender`
  para o helper) e o `voip-service` guarda as duas conexões por ator. O helper
  manda `role: "sender"` sozinho — não há nada a fazer na linha de comando. Ver
  VOICE_NATIVE_HELPER.md §10.
- **Sem UI, sem bandeja, sem serviço.** É um processo de terminal; sai com Ctrl+C.
- **Sem cancelamento de eco.** Use fone, ou sua voz volta pra cena.
- **PCM cru** (~1 Mbit/s de subida). Opus fica pra Fase 2.

## Compilar

Requisitos: Windows, Visual Studio 2022 (workload "Desenvolvimento para desktop
com C++"), CMake ≥ 3.21 e vcpkg.

**1. vcpkg, se ainda não houver**

```bash
git clone https://github.com/microsoft/vcpkg C:/vcpkg
```

```bash
C:/vcpkg/bootstrap-vcpkg.bat
```

**2. Configurar** (a partir de `voice-helper/`). O `vcpkg.json` está em modo
manifesto: as dependências (`miniaudio`, `ixwebsocket`, `nlohmann-json`) são
baixadas e compiladas nesta etapa, sem `vcpkg install` separado.

```bash
cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake -DVCPKG_TARGET_TRIPLET=x64-windows
```

**3. Compilar**

```bash
cmake --build build --config Release
```

O binário sai em `build/Release/voice-helper.exe`.

Se alguma port não resolver, **anote o erro exato em VOICE_NATIVE_HELPER.md §8
antes de trocar de biblioteca** — a decisão de usar `miniaudio` está registrada
com motivo, e trocá-la em silêncio apagaria o motivo junto.

**Falha mais provável no primeiro build**, já que nada disto foi verificado:
`src/main.cpp` faz `#define MINIAUDIO_IMPLEMENTATION` antes do include, o que
assume que a port entrega o `miniaudio.h` como header-only. Se a port do vcpkg
entregar uma biblioteca já compilada, isso vira erro de **símbolo duplicado** no
link. Nesse caso remova o `#define` e deixe o `target_link_libraries` resolver —
e registre a correção aqui.

## Rodar

```bash
voice-helper.exe --actor-id 0xFF000A12 --ticket 753f03d8fa3c944a4c7b1dff7e7a08fb --host 127.0.0.1 --port 7778
```

| Argumento | Obrigatório | Padrão | O quê |
|---|---|---|---|
| `--actor-id` | sim | — | formID do ator, decimal ou `0x`-hex |
| `--ticket` | sim | — | token de uso único emitido pelo `/voz` |
| `--host` | não | `127.0.0.1` | host do `voip-service` |
| `--port` | não | `7778` | porta do `voip-service` |

**O ticket vale 30 segundos e serve uma vez só.** Auth recusada quase sempre é
ticket vencido entre o `/voz` e o comando — rode `/voz` de novo e use o novo.

O servidor precisa estar com `ENABLE_VOIP_SERVICE=true`.

## Testar sem compilar nada

`tools/` tem as duas ferramentas que validaram a Fase 1. As duas usam o `ws` do
gamemode; nenhuma tem `node_modules` próprio.

**Harness** — sobe o `voip-service` real com posições falsas e serve o
`index.html` de verdade:

```bash
node voice-helper/tools/e2e-harness.js --voip-port 7778 --http-port 8099
```

> ⚠️ O harness emite ticket de voz para qualquer `actorId` que pedir, **sem
> autenticação** — é exatamente o furo que o handshake por ticket fecha. Só em
> `127.0.0.1`, em máquina de desenvolvimento.

Rotas: `/` (a UI), `/ticket?actorId=&role=`, `/move?actorId=&x=&y=&z=`, `/state`.

O `role` do `/ticket` é `listener` (padrão, o que a página busca) ou `sender` (o
que a sonda e o helper usam). São tickets diferentes de propósito — um não serve
no lugar do outro, e é isso que deixa os dois papéis do mesmo jogador conectados
ao mesmo tempo. Ver VOICE_NATIVE_HELPER.md §10.

**Sonda** — fala o mesmo protocolo do helper, com um tom de 440Hz no lugar do
microfone. É o que isola falha de captura de falha de transporte:

```bash
node voice-helper/tools/frame-probe.js --actor-id 0xFF000A12 --ticket <token de sender> --seconds 10
```

```bash
node voice-helper/tools/frame-probe.js --listen --actor-id 0xFF000A13 --ticket <token de listener>
```

O papel segue o modo: gerando tom ela autentica como `sender` (o que o helper
faz), com `--listen` como `listener` (o que a UI faz). `--role` força o contrário,
pra testar o lado errado de propósito. Peça ao harness o ticket do papel certo —
`/ticket?actorId=0xFF000A12&role=sender` — ou a auth é recusada.

Roteiro completo do teste e os números medidos: VOICE_NATIVE_HELPER.md §7.

## Formato do fio

PCM 16-bit little-endian, mono, 48kHz, quadros de 20ms (960 amostras = 1920
bytes → 2560 chars em base64).

O mesmo formato aparece em três arquivos e os três precisam concordar; divergir
faz o áudio sair em velocidade errada em vez de falhar limpo:

- `src/main.cpp` — `kSampleRate`, `kChannels`, `kFrameMs`
- `skymp/gamemode/voip-service.js` — `AUDIO_SAMPLE_RATE`, `AUDIO_CHANNELS`, `AUDIO_FRAME_MS`
- `skymp/ui/index.html` — `RELAY_SAMPLE_RATE`
