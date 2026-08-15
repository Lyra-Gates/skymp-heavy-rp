# Auditoria do VOIP atual e validação técnica do SkyVoice/LiveKit

**Data:** 2026-08-14
**Branch:** `research/skymp-upstream-boundary-2026-08-14`
**Escopo:** auditar a voz existente, verificar a viabilidade da arquitetura
SkyMP + LiveKit + CEF/WebAudio, e provar o transporte por spike. **Não** é a
implementação do sistema de voz.

## Como ler as marcas

| Marca | Significa |
|---|---|
| **VERIFICADO** | Executado nesta máquina, ou lido no código-fonte da versão exata em uso. Tem número ou citação. |
| **INFERIDO** | Deduzido de evidência forte, sem execução direta. Pode estar errado. |
| **PLANEJADO** | Decisão tomada, sem código. |
| **NÃO TESTADO** | Não exercitado. Nada aqui é promessa de funcionamento. |

> **Nada neste documento afirma que a voz funciona.** O transporte foi provado;
> a captura no jogo e a inteligibilidade não. Ver §12 e §13.

> **Não existe rádio por voz neste projeto.** Não há, e não se planeja,
> frequência, canal de rádio, PTT de rádio, rádio de facção, `VoiceRadioService`
> nem efeito de rádio. Este documento não abre espaço para isso.

---

## 1. Estado real encontrado

### 1.1 O que existe e roda

| Componente | Arquivo | Estado |
|---|---|---|
| Serviço de voz por proximidade | `skymp/gamemode/voip-service.js` (755 linhas) | **VERIFICADO** — 41 testes passam |
| Raios de proximidade | `skymp/gamemode/core/proximity-ranges.js` | **VERIFICADO** — fonte única, lida de `server-options` |
| Utilitários de distância/célula | `skymp/gamemode/core/range-utils.js` | **VERIFICADO** |
| UI (escuta + WebRTC legado) | `skymp/ui/index.html` (1344 linhas) | **VERIFICADO** que existe; nunca rodou dentro do jogo |
| Helper nativo de captura | `voice-helper/src/main.cpp` (359 linhas) | **VERIFICADO** — compila e captura (§8.4 do doc do helper) |
| Bancada legada | `voice-helper/tools/{e2e-harness,frame-probe}.js` | **VERIFICADO** |

**Suíte completa do gamemode: 840 testes, 840 passam, 0 falham.** `npm run
typecheck` limpo. **VERIFICADO** (execução nesta sessão; 817 antes das minhas
mudanças, 23 acrescentados).

### 1.2 A arquitetura atual, em uma frase

O `voice-helper` captura o microfone por WASAPI **fora da CEF**, manda quadros
PCM s16 48 kHz mono de 20 ms em base64 por WebSocket para o `voip-service`, que
calcula proximidade a cada 2 s e **retransmite os bytes** para quem está em
alcance, com o ganho já anexado; o `index.html` toca via Web Audio.

Por que a captura está fora do navegador: a CEF do SkyMP recusa `getUserMedia`.
A causa exata está na §5 — e **não é a que o repositório documentava**.

### 1.3 Estado de prova do caminho legado

| Camada | Provado? |
|---|---|
| Relay servidor→servidor, byte-a-byte | **VERIFICADO** (doc do helper §7) |
| Enquadramento e fidelidade PCM no navegador | **VERIFICADO** — pico 0.3000, RMS 0.2107 vs 0.2121 |
| Ganho por proximidade | **VERIFICADO** — 0.5 e 0.75 exatos |
| Corte por distância e por célula | **VERIFICADO** — teste automatizado |
| Captura WASAPI real | **VERIFICADO** — 598 quadros, 50,1/s, 0 descartes |
| Conexão dupla (helper + UI, mesmo ator) | **VERIFICADO** |
| **Voz inteligível a um ouvido humano** | **NÃO TESTADO** — bloqueio antigo, ainda aberto |
| **Dois clientes Skyrim reais** | **NÃO TESTADO** |
| **Rede real (fora de 127.0.0.1)** | **NÃO TESTADO** |

---

## 2. Problemas existentes

### 2.1 🔴 A documentação errava a versão da CEF, e o erro mudava a conclusão

`VOICE_CLIENT_PATCH.md`, `VOICE_NATIVE_HELPER.md` §1 e o próprio
`voip-service.js` descreviam a CEF do SkyMP como **"CEF3, baseado em Chromium
~70"**.

**É Chromium 108.** **VERIFICADO** no pin do upstream:

```cmake
# skyrim-multiplayer/skymp — overlay_ports/cef-prebuilt/portfile.cmake
set(CEF_URL ".../cef_binary_108.4.13+ga98cd4c+chromium-108.0.5359.125_windows64.tar.bz2")
```
```json
{ "name": "cef-prebuilt", "version-semver": "108.4.13", "supports": "windows & x64" }
```

Isso não é um detalhe de nota de rodapé. Chromium 70 (2018) **não tem**
`CefPermissionHandler`; Chromium 108 (2022) **tem**. A versão errada sustentava a
conclusão de que só restava enfraquecer o cliente globalmente ou sair do
navegador — e essa conclusão estava baseada numa CEF que o projeto não usa.

O erro é **de origem externa**: o comentário "Chromium ~70" vem literalmente do
patch de `Silveira-Software/skymp`, foi copiado para cá junto com o diff, e
nunca foi conferido contra o pin.

### 2.2 🟠 O custo do relay é físico e não tem conserto dentro do desenho atual

PCM cru a 48 kHz mono = 768 kbit/s por locutor, +33% de base64 ≈ **1 Mbit/s de
subida**. Na descida o servidor **multiplica pelo número de ouvintes**, e
re-serializa o payload por destinatário (o `volume` difere). Isso roda **dentro
do processo Node do gamemode**. Registrado em `TASK_005` e continua verdadeiro.
**VERIFICADO** por leitura de código.

### 2.3 🟠 Primeiros ~2 s de fala perdidos

A audiência só é montada no `tickProximity()`, que roda a cada 2 s. Quem acaba de
conectar não tem audiência e seus quadros são descartados. Medido antes: 45 de
195 quadros. **VERIFICADO** (registrado no doc do helper §9.6).

### 2.4 🟠 Handoff de ticket é manual, atrás de uma flag de andaime

`VOIP_DEBUG_EXPOSE_TICKET=true` grava em disco, em texto puro, uma credencial de
30 s que autentica como aquele jogador. Está desligada por padrão, bem
documentada e testada — mas é um andaime, e a Fase 3 tinha que removê-lo. Ele
continua lá. **VERIFICADO**.

### 2.5 🟡 Jitter buffer não adaptativo

Underrun → salta para `now + 60 ms`, inserindo ~48 ms de silêncio. Em rede real
isso pica em vez de degradar suave. **NÃO TESTADO** fora de `127.0.0.1`.

### 2.6 🟡 Sem AEC e sem supressão de ruído

Quem usa caixa de som realimenta a própria voz na cena. **VERIFICADO** por
ausência no código.

### 2.7 🟡 WebRTC P2P morto no `index.html` e no servidor

`createPeerConnection`, `initiateCall`, `handleOffer` e o relay de
`offer`/`answer`/`ice` continuam presentes. Nunca produziram áudio (a captura
falha antes) e não produzirão. Mantidos de propósito enquanto o helper não é
distribuído. **VERIFICADO**.

---

## 3. Código reaproveitável

Vale mais do que parece — a migração para LiveKit **não joga fora a parte cara**.

| O quê | Onde | Por que sobrevive |
|---|---|---|
| **Regra de proximidade** | `voip-service.tickProximity` + `core/proximity-ranges.js` | É regra de mundo. O LiveKit não decide isso e não deve. Vale igual nos dois transportes. |
| **Comparação de célula** | `range-utils.getCell` | Interiores têm origem de coordenada própria; sem isso a voz atravessa parede. Independe de transporte. |
| **Tabela `VOICE_RANGES` única** | `core/proximity-ranges.js` | Faz falar e escrever chegarem nas mesmas pessoas. |
| **`muted`/`voiceMode` por ATOR** | `voip-service` §10 | A lição mais cara já aprendida aqui: mute por conexão faz a UI mentir sobre privacidade. Vale igual no LiveKit. |
| **Emissão de credencial pelo servidor** | `issueTicket` | O access token do LiveKit é o mesmo padrão com outro formato: servidor emite, cliente apresenta. |
| **Captura WASAPI** | `voice-helper/src/main.cpp` | Já compila e já capturou áudio real. O Plano B troca só o destino dos quadros. |
| **Bancada** | `voice-helper/tools/` | Continua válida para o caminho legado. |

**O `voice-helper` NÃO deve ser apagado** — é a base do Plano B e a única captura
provada que o projeto tem. **PLANEJADO** manter.

---

## 4. Código legado

"Legado" aqui = tem substituto previsto, mas **não sai agora**.

| O quê | Quando sai |
|---|---|
| WebRTC P2P no `index.html` e o relay `offer`/`answer`/`ice` | Só depois de um caminho de captura distribuído. Hoje é o único que existe para quem não tem o helper. |
| PCM cru + base64 no fio | Substituído por Opus — que no LiveKit vem de graça (§6). |
| `_exposeDebugTicket` + `VOIP_DEBUG_EXPOSE_TICKET` | Com o handoff automático de credencial. |
| Relay de áudio dentro do processo do gamemode | Se e quando o LiveKit assumir o transporte. |

**Nada disso foi removido nesta rodada, de propósito.** Ver §9.

---

## 5. Resultado da pesquisa CEF

### 5.1 Versão exata — VERIFICADO

**CEF 108.4.13+ga98cd4c+chromium-108.0.5359.125, windows64.**

Fonte: `overlay_ports/cef-prebuilt/{portfile.cmake,vcpkg.json}` no
`skyrim-multiplayer/skymp`. O fork `hijosdelasnieves/hijosdelasnieves-RP` pina
**exatamente a mesma versão** — a conclusão é estável no ecossistema.

### 5.2 A API existe nessa versão — VERIFICADO

Lido no branch **5359** da CEF (o branch do Chromium 108), não em documentação
genérica:

- `include/cef_client.h` → `virtual CefRefPtr<CefPermissionHandler> GetPermissionHandler()`
- `include/cef_permission_handler.h` →
  ```cpp
  virtual bool OnRequestMediaAccessPermission(
      CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
      const CefString& requesting_origin, uint32 requested_permissions,
      CefRefPtr<CefMediaAccessCallback> callback);
  ```
- `include/internal/cef_types.h` → `cef_media_access_permission_types_t`:
  `CEF_MEDIA_PERMISSION_NONE = 0`,
  `..._DEVICE_AUDIO_CAPTURE = 1 << 0`,
  `..._DEVICE_VIDEO_CAPTURE = 1 << 1`,
  `..._DESKTOP_AUDIO_CAPTURE = 1 << 2`,
  `..._DESKTOP_VIDEO_CAPTURE = 1 << 3`.

### 5.3 Por que `getUserMedia` falha hoje — VERIFICADO, e a causa é outra

`libcef/browser/media_access_query.cc` do branch 5359:

```cpp
if (CheckCommandLinePermission()) {      // --enable-media-stream
  query.ExecuteCallback(query.requested_permissions());   // libera TUDO que foi pedido
  return base::NullCallback();
}
if (auto client = browser->GetClient()) {
  if (auto handler = client->GetPermissionHandler()) {
    handled = handler->OnRequestMediaAccessPermission(...);
  }
}
if (default_disallow && !handled) {
  query.ExecuteCallback(CEF_MEDIA_PERMISSION_NONE);       // nega
}
```

E `alloy_browser_host_impl.cc:1279` chama isso com **`default_disallow=true`**.

O `OverlayClient` do SkyMP (`skyrim-platform/src/tilted/ui/OverlayClient.h`)
implementa `GetRenderHandler`, `GetLoadHandler`, `GetLifeSpanHandler` e
`GetContextMenuHandler` — e **não** `GetPermissionHandler`. O
`OnBeforeCommandLineProcessing` do upstream está **vazio** (verificado: corpo
`{}`).

**Diagnóstico:** sem handler e sem flag, o runtime alloy nega por padrão. O
`NotAllowedError` não é uma limitação da versão da CEF — é a **ausência de um
handler que a versão em uso oferece**. Isto reabre o Plano A.

### 5.4 O desenho seguro é exatamente o pedido — PLANEJADO

```
pedido de microfone
  → requesting_origin está na allowlist?     não → Cancel()
  → requested_permissions ⊆ {AUDIO_CAPTURE}? não → Cancel()
  → VOIP habilitado nesta sessão?            não → Cancel()
  → Continue(CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE)
qualquer outro caso                              → Cancel()
```

Três propriedades que o desenho garante e as flags globais não:

1. **Escopo de origem.** O handler recebe `requesting_origin` e decide por
   origem. A flag concede a **todas**.
2. **Só áudio.** `Continue()` recebe uma máscara. Conceder `AUDIO_CAPTURE` sem
   `VIDEO_CAPTURE` deixa a câmera bloqueada **por construção** — mesmo que a
   página peça vídeo, o retorno não o contém.
3. **Estado do jogo.** O handler pode consultar se o VOIP está ligado. A flag é
   decidida no `main()` e vale para sempre.

### 5.5 Por que NÃO copiar as flags dos forks — VERIFICADO

**`Silveira-Software/skymp`** (2 commits à frente do upstream, `MyChromiumApp.cpp`)
— é a origem literal do diff em `VOICE_CLIENT_PATCH.md`:

```cpp
aCommandLine->AppendSwitch("enable-media-stream");
aCommandLine->AppendSwitch("use-fake-ui-for-media-stream");
aCommandLine->AppendSwitch("use-fake-device-for-media-stream");
aCommandLine->AppendSwitchWithValue("use-file-for-fake-audio-capture", "");
aCommandLine->AppendSwitch("disable-web-security");
```

Três defeitos, e o terceiro é irônico:

1. `enable-media-stream` na CEF 108 cai no `CheckCommandLinePermission()` acima
   → **libera tudo que for pedido, inclusive câmera, para qualquer origem.**
2. `disable-web-security` desliga a same-origin policy do client inteiro.
3. `use-fake-device-for-media-stream` **substitui o microfone real por um
   dispositivo sintético**, e `use-file-for-fake-audio-capture=""` o alimenta com
   nada. O patch que existe para liberar o microfone provavelmente entregaria
   **silêncio**. **INFERIDO** — comportamento documentado dessas flags no
   Chromium, não executado aqui.

**`hijosdelasnieves/hijosdelasnieves-RP`** (mesma CEF 108, comentário
`HDN 2026-04-22 [voice-mic-fix]`, e menciona LiveKit):

```cpp
aCommandLine->AppendSwitch("enable-media-stream");
aCommandLine->AppendSwitch("auto-accept-camera-and-microphone-capture");
aCommandLine->AppendSwitch("use-fake-ui-for-media-stream");
aCommandLine->AppendSwitch("allow-running-insecure-content");
aCommandLine->AppendSwitchWithValue("disable-features", "MediaRouter,AudioServiceSandbox");
```

É exatamente a flag que a diretriz desta tarefa manda não copiar, e o nome dela
diz o problema: **camera-and-microphone**. Some-se `AudioServiceSandbox`
desligado (tira o sandbox do serviço de áudio) e o resultado é microfone +
câmera abertos para qualquer origem que o client carregar. O comentário deles
("sin pedir permiso al usuario") descreve o efeito com precisão.

Note que a implementação LiveKit do lado deles **não está nesse repositório** —
só o patch da CEF. Não há como auditar o resto do desenho deles a partir dele.

### 5.6 O que continua não sabido

- **NÃO TESTADO:** nenhum build da CEF/SkyrimPlatform foi feito nesta rodada. A
  §5.4 é leitura de cabeçalho e de fonte, não um handler compilado e executado.
- **NÃO TESTADO:** se o `livekit-client` (JS) roda de fato dentro da CEF 108 do
  SkyMP. O `browserslist` do SDK é `chrome >= 64` (**VERIFICADO**), o que
  *sugere* compatibilidade — mas `browserslist` é alvo de transpilação, não
  promessa de runtime.
- **INFERIDO:** o SkyrimPlatform usa o runtime **alloy** (é off-screen rendering
  via `CefRenderHandler`, e o bootstrap "chrome" da CEF 108 não suporta OSR).
  Importa porque `default_disallow=true` é do caminho alloy.

---

## 6. Resultado da pesquisa LiveKit

Tudo abaixo é **VERIFICADO** por documentação oficial, e o que foi executado está
marcado com ▶.

| Tema | Achado |
|---|---|
| **JS SDK** | `livekit-client` 2.21.0. `browserslist`: `chrome >= 64`. Transpilado com Babel + `webrtc-adapter`. |
| **C++ SDK** | `livekit/client-sdk-cpp` **1.0.0, estável**. Windows x64 suportado. Exige CMake ≥ 3.20 e toolchain Rust (compila `livekit_ffi` do `client-sdk-rust`). Publica/assina áudio. |
| **Access tokens** | JWT HS256. `iss`=API key, `sub`=identity, `exp`, claim `video` com as grants. **Devem ser criados no backend**; o secret nunca vai ao cliente. ▶ |
| **Rooms** | Uma sala por cena de voz; o token prende a uma sala via `roomJoin`+`room`. ▶ |
| **Tracks** | Publish/subscribe por faixa; `canPublishSources` restringe a fonte. ▶ |
| **Selective subscription** | `autoSubscribe: false` + `publication.setSubscribed(true)`. `setEnabled()` pausa sem desassinar (mais barato para alternar muito). Documentado explicitamente para "aplicações espaciais". |
| **Controle server-side de subscription** | `UpdateSubscriptions` na API de servidor (room, identity, trackSids, subscribe). Também `UpdateParticipant` (permissões), `MutePublishedTrack`, `RemoveParticipant`. |
| **Participant identity** | Chave única na sala; um segundo participante com a mesma identidade **derruba o primeiro**. ▶ (por isso o sufixo de sessão — §7.3) |
| **Reconnect** | Eventos `Reconnecting` / `Reconnected` / `Disconnected`; reconexão automática. ▶ (parcial — ver §11) |
| **Connection quality** | `ConnectionQualityChanged` com valor por participante. ▶ |
| **Active speaker** | `ActiveSpeakersChanged`; `Participant.isSpeaking` / `audioLevel`. |
| **Audio levels** | Propriedade do participante, não evento próprio. |
| **Opus** | Codec de áudio padrão, ~24–64 kbit/s para voz. DTX e RED ligados por padrão em mono. ▶ |
| **Self-hosting** | `livekit-server`, binário único. 7880 (HTTP/WS), 7881 (TCP fallback), 50000–60000/UDP (mídia). ▶ v1.13.5 executado nesta máquina. |
| **TURN** | Embutido no `livekit-server` (`turn.enabled`, `tls_port` 5349, `relay_range`). Resolve o CGNAT que o relay atual resolvia por acidente. |
| **Load testing** | `lk load-test` (livekit-cli): `--audio-publishers`, `--subscribers`, `--duration`. Distribuível em várias máquinas. |

**Ponto de atenção de SDK, VERIFICADO:** o `@livekit/rtc-node` expõe
`publication.muted` **apenas como leitura** — não tem `mute()`. Mutar pelo lado
que publica é API do SDK JS de navegador (`setMicrophoneEnabled`) e do servidor
(`MutePublishedTrack`). Não é limitação do LiveKit; é da superfície daquele SDK.
Registrado porque é fácil concluir errado a partir de um `TypeError`.

---

## 7. Arquitetura escolhida

### 7.1 A divisão de autoridade

```
┌─────────────────────────────────────────────────────────┐
│ SkyMP (gamemode)  — AUTORIDADE                          │
│  · quem ouve quem (tickProximity, célula + distância)   │
│  · com que volume (VOICE_RANGES, uma tabela só)         │
│  · muted / voiceMode  (do ATOR, nunca da conexão)       │
│  · emite o access token (secret nunca sai daqui)        │
└───────────────┬─────────────────────────────────────────┘
                │ token curto + ordens de subscription
                ▼
┌─────────────────────────────────────────────────────────┐
│ LiveKit (SFU)     — TRANSPORTE, e só                    │
│  · WebRTC / Opus / TURN                                 │
│  · NÃO decide proximidade, personagem ou regra de jogo  │
└───────────────┬─────────────────────────────────────────┘
                │ faixas de áudio
                ▼
┌─────────────────────────────────────────────────────────┐
│ Cliente — captura e reprodução                          │
│  CefLiveKitEndpoint     (getUserMedia + SDK JS)         │
│  NativeLiveKitEndpoint  (WASAPI + SDK C++)              │
│  · aplica o ganho que o SkyMP mandou                    │
└─────────────────────────────────────────────────────────┘
```

**SFU, nunca P2P.** Decidido e registrado: todo áudio passa pelo SFU. Além de
escalar melhor (n conexões por participante em vez de n²), é o que preserva o
NAT/CGNAT que o relay atual já resolvia — dois jogadores em redes residenciais
distintas não fecham conexão direta. **PLANEJADO**.

### 7.2 Onde a proximidade entra sem o LiveKit saber dela

Duas camadas, e a escolha entre elas não precisa ser feita agora:

- **Ganho no cliente** (barato, imediato): o SkyMP continua mandando o mapa de
  volume do `tickProximity`; o cliente aplica por faixa. O SFU entrega tudo.
- **Subscription no servidor** (economiza banda): o gamemode usa
  `UpdateSubscriptions` para que cada ouvinte só receba os locutores em alcance.

A segunda é a que justifica o SFU em cena cheia, e é exatamente onde o fork
`Metadraconis/skymp-vgr` tem a lacuna registrada em
[`VOICE_FORK_AUDIT_SKYMP_VGR_2026-08-11.md`](VOICE_FORK_AUDIT_SKYMP_VGR_2026-08-11.md):
o `proximityLoop` deles não é iniciado, e a API de posição do agente aceita
origem `*` sem autenticação. **Nós não devemos repetir isso** — a decisão de
subscription é do gamemode, dentro do processo que já é autoritativo, sem um
serviço HTTP aberto no meio.

### 7.3 Identidade

`actor-<actorId>-<nonce>`, **sempre derivada no servidor**. O nonce existe porque
identidade é chave única na sala: sem ele, uma reconexão rápida derrubaria a
própria sessão anterior. O `actorId` é recuperável da identidade
(`actorIdFromIdentity`), que é como o ouvinte sabe a que ator aplicar o ganho.
**VERIFICADO** por teste e pelo spike.

### 7.4 A costura VoiceEndpoint

O ponto da abstração é que **o resto do sistema não pergunta quem captura**.

| Endpoint | Captura | Exige build de client? | Áudio passa no servidor de jogo? | Implementado |
|---|---|---|---|---|
| `legacy-relay` | helper nativo | não | **sim** | **sim** |
| `cef-livekit` | CEF | **sim** | não | não |
| `native-livekit` | helper nativo | não | não | não |

Os dois endpoints LiveKit são **indistinguíveis no transporte** — mesma sala,
mesmo protocolo. Um jogador com client patchado e outro com helper nativo se
ouvem sem que nenhum saiba do outro. Há teste travando essa indistinguibilidade,
porque é ela que permite decidir entre Plano A e Plano B **depois**, e migrar sem
um corte.

A única pergunta que o serviço de voz faz é
`relaysAudioThroughGameServer()` — uma propriedade do **transporte**, não a
identidade do endpoint.

### 7.5 Plano A e Plano B

- **Plano A — `cef-livekit`.** Viável (§5.3/§5.4): a CEF 108 tem a API. Custo: um
  build de client nosso, com fork registrado (`LICENSE_AND_AFFILIATION_POLICY.md`).
- **Plano B — `native-livekit`.** Não depende de build de client. Reaproveita a
  captura WASAPI já provada; troca o destino dos quadros para o SDK C++
  (estável, Windows x64). Custo: o jogador roda um processo a mais, e o
  `client-sdk-cpp` arrasta toolchain Rust no build.

**Não é preciso escolher agora**, e é isso que a §7.4 compra. Se o Plano A não
fechar com segurança, o Plano B assume **sem fragilizar o cliente** — e sob
nenhuma hipótese se liga `auto-accept-camera-and-microphone-capture` ou
`enable-media-stream`.

---

## 8. Riscos de segurança

| # | Risco | Gravidade | Mitigação | Estado |
|---|---|---|---|---|
| 1 | API secret vazar para o cliente | **Crítico** | Secret só em `LIVEKIT_API_SECRET`; o cliente recebe JWT. Teste trava que o secret não aparece no token. | **VERIFICADO** |
| 2 | Cliente forjar identidade de outro jogador | **Crítico** | Identidade derivada do `actorId` no servidor; token assinado. Token com secret errado → **401**. | **VERIFICADO** ▶ |
| 3 | Flags globais de mídia abrirem mic+câmera para qualquer origem | **Crítico** | Não usar flag nenhuma; `CefPermissionHandler` com allowlist de origem e máscara só-áudio. | **PLANEJADO** (§5.4) |
| 4 | Câmera ser publicada | **Alto** | Duas camadas independentes: `canPublishSources: ['microphone']` no token **e** a máscara do handler. Provado com controle. | **VERIFICADO** ▶ (token) / **PLANEJADO** (handler) |
| 5 | Token vazado reutilizado | **Alto** | TTL de 6 min, preso a uma sala, sem direitos de operador (`roomAdmin`/`roomCreate`/`canPublishData` = `false`). | **VERIFICADO** |
| 6 | `canPublishData` virar canal paralelo entre clientes | **Alto** | Negado explicitamente no token. O SkyMP é a única via de regra de jogo. | **VERIFICADO** |
| 7 | Serviço de proximidade HTTP aberto (o erro do fork VGR) | **Alto** | Não haverá serviço externo: a decisão de subscription é do gamemode. | **PLANEJADO** |
| 8 | `VOIP_DEBUG_EXPOSE_TICKET` esquecido ligado | **Médio** | Desligado por padrão, só `'true'` liga, lido por chamada. **Continua sendo um andaime a remover.** | **VERIFICADO** |
| 9 | Portas UDP 50000–60000 expostas | **Médio** | Necessárias para mídia; exigem firewall e IP público real. | **NÃO TESTADO** |
| 10 | LiveKit fora do ar derrubar o jogo | **Médio** | Falha de conexão é capturável e não derruba o processo. | **VERIFICADO** ▶ (no spike; **não** no gamemode) |

---

## 9. Alterações realizadas

Deliberadamente pequenas. **Nada do caminho legado foi removido ou modificado no
comportamento.**

| Arquivo | O que mudou |
|---|---|
| `skymp/gamemode/core/voice/voice-endpoint.js` | **novo** — a costura `VoiceEndpoint` e a resolução de `VOICE_BACKEND`. |
| `skymp/gamemode/core/voice/livekit-token.js` | **novo** — emissão de access token, sem dependência nova (JWT HS256 com `node:crypto`). |
| `skymp/gamemode/core/voice/*.test.js` | **novos** — 23 testes. |
| `skymp/gamemode/phase0-basic.js` | registra o backend no boot e **avisa** se o backend escolhido tem endpoint sem implementação. Não muda a condição de ligar o módulo. |
| `skymp/gamemode/package.json` | os dois novos testes entram no `npm test`. |
| `skymp/gamemode/.env.example` | documenta `VOICE_BACKEND`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. |
| `spikes/skyvoice-livekit/` | **novo** — o spike e seu README. Dependência isolada; não entra no gamemode. |
| `docs/technical/SKYVOICE_LIVEKIT_AUDIT.md` | este documento. |
| `VOICE_CLIENT_PATCH.md`, `VOICE_NATIVE_HELPER.md`, `voip-service.js` | correção da versão da CEF (§2.1), apontando para cá. |

**Não alterado, de propósito:** `voip-service.js` (comportamento), `skymp/ui/`,
`voice-helper/`, `core/proximity-ranges.js`, `core/range-utils.js`.

`VOICE_BACKEND` **não** liga nem desliga a voz — quem faz isso continua sendo
`ENABLE_VOIP_SERVICE`. São perguntas diferentes, e uni-las faria trocar de
transporte parecer que desliga a voz.

---

## 10. Testes executados

| # | O quê | Comando | Resultado |
|---|---|---|---|
| 1 | Suíte VOIP existente | `node --test voip-service.test.js` | **41/41** |
| 2 | Suíte completa (antes) | `npm test` | **817/817** |
| 3 | Suíte completa (depois) | `npm test` | **840/840** |
| 4 | Tipos | `npm run typecheck` | limpo |
| 5 | Novos módulos de voz | `node --test core/voice/*.test.js` | **23/23** |
| 6 | **Spike LiveKit ponta a ponta** | `node spike.js` contra `livekit-server` 1.13.5 real | **22/22** |
| 7 | Controle da câmera | embutido no spike | ver §11 |

O `livekit-server` foi o binário oficial `v1.13.5 windows_amd64`, com **SHA-256
conferido** contra o `checksums.txt` da release
(`3ec7eaa7…a8906`, bateu).

---

## 11. Resultados

### 11.1 Spike — 22 verificações, 22 passaram — VERIFICADO

Dois participantes, `livekit-server` real, tokens do nosso módulo:

| Verificação | Medido |
|---|---|
| Nenhum API secret no token | ✅ |
| Token preso a uma sala | ✅ |
| Token só permite fonte `microphone` | ✅ |
| A e B autenticados pelo servidor real | ✅ |
| **Token com secret errado** | **401 Unauthorized** |
| A publica faixa de microfone | ✅ |
| B assina a faixa e recebe | **253 quadros** |
| **Fidelidade do sinal através do Opus** | **RMS 0.2121** vs 0.2121 teórico |
| **Seletividade em frequência** | energia em 440 Hz **220.451×** o controle em 1 kHz |
| PTT solto → silêncio em B | RMS **0.00000** |
| PTT apertado → sinal volta | RMS 0.1985 |
| Mute duro (`unpublish`) remove a faixa em B | ✅ |
| Câmera com token restrito | **recusada** (timeout 10.143 ms) |
| **CONTROLE: mesma publicação sem a restrição** | **publicou em 65 ms** |
| Reconexão com token novo | **+287 quadros**, RMS 0.2121 |
| `actorId` sobrevive à troca de identidade | ✅ |
| Qualidade de conexão reportada pelo SFU | evento recebido |
| Servidor inalcançável | falha capturável, processo vivo |

O RMS bater 0.2121 contra 0.2121 teórico **através de um codec com perdas** é o
resultado mais forte da rodada: o Opus preservou o sinal, e o caminho
A → SFU → B não o corrompeu.

### 11.2 O controle da câmera merece destaque

A recusa de vídeo do LiveKit **não é um erro de permissão** — é silêncio seguido
de timeout do cliente (~10 s). Um timeout sozinho não prova nada: poderia ser o
`VideoSource` sem quadros.

Por isso o spike publica vídeo **duas vezes**: token restrito (estoura em 10 s) e
token de controle sem restrição (**publica em 65 ms**). É a diferença que prova a
permissão, e ela roda toda vez.

Isso quase virou um "câmera bloqueada ✅" sem lastro. Fica registrado como o tipo
de evidência que este projeto não aceita.

### 11.3 O que mudou de conclusão

**O Plano A voltou à mesa.** `VOICE_CLIENT_PATCH.md` foi descartado por um motivo
correto (não enfraquecer o cliente) apoiado num fato errado (Chromium ~70). Com
Chromium 108, existe um caminho que **não** enfraquece o cliente: um
`CefPermissionHandler` que responde por origem e concede só `AUDIO_CAPTURE`.

Isso não reabre o patch de flags — aquele continua descartado, e agora com um
terceiro motivo (§5.5: ele provavelmente entregaria silêncio).

---

## 12. Blockers

| # | Blocker | Bloqueia | Natureza |
|---|---|---|---|
| 1 | **Ninguém nunca ouviu a voz deste projeto.** | Declarar qualquer caminho de voz pronto | Precisa de **pessoa**, não de código. Aberto desde a Fase 1. |
| 2 | **Nenhum cliente Skyrim real jamais conectou.** | Toda validação em jogo | Ambiental — é o bloqueio da Fase 0 inteira, não só da voz. |
| 3 | **Nenhum build da SkyrimPlatform.** | Plano A (o handler é C++ no client) | Exige fork registrado + build de client + distribuição pelo launcher. |
| 4 | Handoff automático de credencial | Tirar o `VOIP_DEBUG_EXPOSE_TICKET` | Conhecido desde a Fase 1. |
| 5 | Nada foi exercitado fora de `127.0.0.1` | Qualquer afirmação sobre jitter/perda/TURN | Precisa de duas máquinas em redes distintas. |

O blocker #1 é o mesmo do caminho legado. **Trocar de transporte não o resolve**,
e nenhum resultado deste documento deve ser lido como se resolvesse.

---

## 13. Itens ainda não testados

**NÃO TESTADO**, sem exceção:

1. Voz **inteligível** a um ouvido humano — em qualquer transporte.
2. Dois clientes **Skyrim** reais falando e ouvindo.
3. `getUserMedia` dentro da CEF do SkyMP, com ou sem handler.
4. Um `CefPermissionHandler` compilado. §5.4 é desenho, não binário.
5. **Origem não autorizada sem acesso ao microfone** — depende de #4.
6. O `livekit-client` (JS) rodando dentro da CEF 108.
7. O `client-sdk-cpp` compilado no `voice-helper`.
8. Qualquer coisa fora de `127.0.0.1`: latência, perda, jitter, TURN, CGNAT.
9. Carga: 5/10/20 ouvintes na mesma cena, no LiveKit ou no relay atual
   (critério aberto do `TASK_005`).
10. `UpdateSubscriptions` conduzido pelo gamemode.
11. Comportamento do gamemode com LiveKit caindo **em produção** (o spike provou
    só que a falha é capturável num processo Node isolado).
12. AEC / supressão de ruído.
13. Empacotamento e assinatura de qualquer binário novo.

---

## 14. Recomendação para a próxima etapa

**Não migrar ainda. Não remover nada. Resolver o blocker #1 primeiro.**

O caminho legado está provado até o transporte e trava numa coisa que nenhum
código resolve: **ninguém escutou**. O caminho LiveKit agora está provado no
transporte também — e trava no **mesmo lugar**. Migrar antes de resolver isso
seria trocar um sistema não-ouvido por outro não-ouvido, e perder a única
comparação honesta possível entre os dois.

Na ordem:

1. **Uma pessoa escuta o caminho legado.** Passo 6 da etapa 8.2 do
   `FASE_0_ROTEIRO.md`. É uma sessão de bancada com o `voice-helper.exe` que já
   compila, o harness que já roda, e um par de fones. **Destrava a Fase 1
   inteira** e é pré-requisito para comparar qualquer coisa.
2. **Medir o relay atual sob carga** (5/10/20 ouvintes) — o critério que o
   `TASK_005` deixou aberto. Sem esse número, "o LiveKit escala melhor" é
   convicção, não decisão.
3. **Decidir Plano A vs Plano B com dados**, não antes. O que decide é se haverá
   build de client próprio — e isso é decisão de projeto (fork registrado,
   launcher, assinatura), não técnica.
4. **Se Plano A:** implementar o `CefPermissionHandler` da §5.4 num fork
   registrado, com teste explícito de que uma origem fora da allowlist é negada e
   de que a câmera nunca é concedida. Nenhuma flag de linha de comando.
5. **Se Plano B:** `client-sdk-cpp` no `voice-helper`, mantendo a captura WASAPI
   que já funciona.
6. **Só então** ligar `VOICE_BACKEND=livekit` num ambiente fechado, com os dois
   caminhos ainda presentes.

**Não avançar** para subscription server-side, espacialização, AEC ou qualquer
sistema de gameplay antes do passo 1. E, reforçando o escopo desta tarefa: **não
existe rádio por voz neste projeto** — nada aqui deve ser lido como preparação
para um.

---

## Fontes

**Verificadas por leitura direta do código-fonte da versão em uso:**
- [`overlay_ports/cef-prebuilt/portfile.cmake`](https://github.com/skyrim-multiplayer/skymp/blob/main/overlay_ports/cef-prebuilt/portfile.cmake) — o pin da CEF
- [`OverlayClient.h`](https://github.com/skyrim-multiplayer/skymp/blob/main/skyrim-platform/src/tilted/ui/OverlayClient.h) — sem `GetPermissionHandler`
- [`MyChromiumApp.cpp`](https://github.com/skyrim-multiplayer/skymp/blob/main/skyrim-platform/src/tilted/ui/MyChromiumApp.cpp) — `OnBeforeCommandLineProcessing` vazio
- CEF branch 5359: `cef_permission_handler.h`, `cef_client.h`, `internal/cef_types.h`, `libcef/browser/media_access_query.cc`, `libcef/browser/alloy/alloy_browser_host_impl.cc`
- Forks: [`Silveira-Software/skymp`](https://github.com/Silveira-Software/skymp), [`hijosdelasnieves/hijosdelasnieves-RP`](https://github.com/hijosdelasnieves/hijosdelasnieves-RP)

**LiveKit:**
- [Selective subscription](https://docs.livekit.io/home/client/tracks/subscribe/) · [Autenticação](https://docs.livekit.io/home/get-started/authentication/) · [Gerenciar participantes](https://docs.livekit.io/home/server/managing-participants/) · [Eventos](https://docs.livekit.io/home/client/events/) · [Deploy](https://docs.livekit.io/transport/self-hosting/deployment/) · [Benchmark](https://docs.livekit.io/home/self-hosting/benchmark/)
- [`client-sdk-cpp`](https://github.com/livekit/client-sdk-cpp) · [`client-sdk-js`](https://github.com/livekit/client-sdk-js) · [`livekit-cli`](https://github.com/livekit/livekit-cli)

**Internas:** [`VOICE_NATIVE_HELPER.md`](VOICE_NATIVE_HELPER.md) · [`VOICE_CLIENT_PATCH.md`](VOICE_CLIENT_PATCH.md) · [`VOICE_FORK_AUDIT_SKYMP_VGR_2026-08-11.md`](VOICE_FORK_AUDIT_SKYMP_VGR_2026-08-11.md) · [`TASK_005_VOIP_CAPACITY_AND_SECURITY.md`](../roadmap/TASK_005_VOIP_CAPACITY_AND_SECURITY.md) · [`FASE_0_ROTEIRO.md`](FASE_0_ROTEIRO.md)
