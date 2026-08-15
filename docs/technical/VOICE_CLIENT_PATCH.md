# Patch de Client — Liberar Microfone no CEF (Voz por Proximidade)

> ## ⛔ CAMINHO DESCARTADO — substituído em 07/08/2026
>
> **Não aplique este patch.** O caminho ativo é o helper nativo:
> [`VOICE_NATIVE_HELPER.md`](VOICE_NATIVE_HELPER.md).
>
> O documento abaixo está preservado inteiro, e de propósito. Ele registra por
> que a ideia foi levada a sério — três PRs upstream, um diff pronto, um runbook
> completo — e o que se descobriu depois. Apagá-lo faria alguém redescobrir o
> caminho daqui a seis meses e refazer o percurso inteiro.
>
> ### O que ele não sabia
>
> O texto abaixo trata o bloqueio como uma omissão: `OnBeforeCommandLineProcessing`
> "não habilita nenhuma flag de mídia", e as PRs "não foram mergeadas" sem review.
> A leitura implícita é a de esquecimento dos mantenedores.
>
> Não foi. O release notes da **SkyrimPlatform 2.1** — a engine que o SkyMP usa,
> hoje na 2.6 — registra a **remoção deliberada**:
>
> > "Removed Chromium flag that gives the ability to listen to recording devices
> > via browser-side JavaScript"
>
> A flag existiu e foi tirada de propósito. Isso reclassifica as três PRs
> auto-fechadas: elas não estavam esperando atenção, estavam pedindo a reversão
> de uma decisão de segurança.
>
> ### Por que a decisão deles está certa
>
> O client SkyMP **abre a URL que o servidor mandar**. Com a flag ligada num
> build distribuído, qualquer JavaScript servido por **qualquer** servidor SkyMP
> captaria o microfone do jogador em silêncio — sem prompt do sistema, sem
> indicador, sem consentimento. O escopo do risco não é este servidor: é o client
> inteiro, para sempre, em todo servidor que aquele jogador conectar depois.
>
> Note que o próprio diff abaixo já concedia isso sem perceber: ele passa
> `use-fake-ui-for-media-stream` (suprime o prompt) junto de `enable-features`
> (concede a permissão) — exatamente a combinação "captura sem o usuário saber" —
> e ainda desliga a same-origin policy. O comentário do `disable-web-security`
> defende a mudança com "o CEF do SkyMP só carrega a UI local, não navega pra
> origens arbitrárias". Essa premissa é falsa: carregar a UI que o servidor
> aponta é precisamente navegar para uma origem arbitrária.
>
> ### Correção de fato — 14/08/2026: a versão da CEF estava errada
>
> Este documento (e o comentário do patch abaixo) diz **"CEF3, baseado em
> Chromium ~70"**. É falso. O SkyMP pina
> **CEF 108.4.13 / Chromium 108.0.5359.125** — verificado em
> `overlay_ports/cef-prebuilt/portfile.cmake` no upstream.
>
> O número veio junto com o diff copiado de `Silveira-Software/skymp` e nunca
> foi conferido. Ele importa porque muda a conclusão: Chromium 70 não tem
> `CefPermissionHandler`; **Chromium 108 tem**. Existe, portanto, um caminho
> para liberar o microfone **por origem e só áudio**, sem nenhuma flag global —
> que é o oposto do que este patch faz.
>
> A rejeição deste patch **continua válida**, e agora com um motivo a mais:
> `use-fake-device-for-media-stream` substitui o microfone real por um
> dispositivo sintético, e `use-file-for-fake-audio-capture=""` o alimenta com
> nada. O patch que existe para liberar o microfone provavelmente entregaria
> silêncio.
>
> Ver [`SKYVOICE_LIVEKIT_AUDIT.md`](SKYVOICE_LIVEKIT_AUDIT.md) §5.
>
> ### O que substitui
>
> Tirar a captura do navegador em vez de enfraquecer o navegador. Um executável
> separado captura o microfone pela API de áudio do Windows e manda os quadros
> para o servidor, que retransmite por proximidade; o navegador do jogo só
> **toca** o que chega — e tocar nunca foi bloqueado pela CEF, só a captura era.
>
> De quebra resolve o NAT/CGNAT que travaria a malha P2P entre jogadores em redes
> residenciais diferentes. Ver [`VOICE_NATIVE_HELPER.md`](VOICE_NATIVE_HELPER.md).

---

## Contexto

> ⚠️ O parágrafo abaixo diz "Chromium ~70". **Está errado** — é Chromium 108.
> Preservado como escrito porque este documento é registro histórico; a correção
> e o que ela muda estão no bloco no topo do arquivo.

O `voip-service.js` (`skymp/gamemode/voip-service.js`, comando `/voz`) já está implementado e testado no lado servidor: sinalização WebRTC, autenticação por ticket, cálculo de volume por distância. Mas o navegador embutido do SkyMP (CEF3, baseado em Chromium ~70) **recusa `getUserMedia({audio:true})` com `NotAllowedError`** mesmo com permissão de microfone concedida pelo Windows, porque `OnBeforeCommandLineProcessing` (em `skyrim-platform/src/tilted/ui/MyChromiumApp.cpp`, no client oficial) não habilita nenhuma flag de mídia do Chromium.

Sem esse patch, o servidor de sinalização funciona perfeitamente, mas **nenhum áudio real sai do microfone de ninguém** — o cliente trava em `initMicrophone()` com erro.

## O que já foi confirmado

- O patch existe e é pequeno — só adiciona flags de linha de comando no construtor do Chromium embutido, sem tocar em nenhuma outra lógica.
- Foi enviado 3 vezes como PR upstream ([#2778](https://github.com/skyrim-multiplayer/skymp/pull/2778), [#2779](https://github.com/skyrim-multiplayer/skymp/pull/2779), [#2780](https://github.com/skyrim-multiplayer/skymp/pull/2780)) por um contribuidor identificado como parte do **"Skyrim RP BR"** — comentários em português, mesma comunidade/contexto deste projeto.
- Nenhuma foi mergeada; todas foram auto-fechadas pelo próprio autor em 08/07/2026, sem review dos mantenedores. Não há indicação de que vá ser mergeada em breve.
- **Este documento não representa um build real** — não há toolchain C++/CEF/MSVC disponível no ambiente onde isso foi escrito. É o runbook pra quem tiver esse ambiente executar.

## O patch (diff exato da PR #2780)

Arquivo: `skyrim-platform/src/tilted/ui/MyChromiumApp.cpp`, dentro de `MyChromiumApp::OnBeforeCommandLineProcessing`:

```cpp
void MyChromiumApp::OnBeforeCommandLineProcessing(
  const CefString& aProcessType, CefRefPtr<CefCommandLine> aCommandLine)
{
  // ===== Voice chat (WebRTC) — liberar getUserMedia no CEF =====
  // Sem essas flags o navegador embutido (CEF3, baseado em Chromium ~70)
  // recusa getUserMedia({audio:true}) com NotAllowedError, e o mic fica
  // bloqueado mesmo com permissao concedida pelo SO.
  //
  // A ordem importa: o "use-fake-ui" sozinho suprime o prompt mas NAO
  // concede permissao — precisa do "enable-features" tambem.
  aCommandLine->AppendSwitch("enable-media-stream");
  aCommandLine->AppendSwitch("use-fake-ui-for-media-stream");
  aCommandLine->AppendSwitch("enable-usermedia-screen-capturing");
  aCommandLine->AppendSwitchWithValue("autoplay-policy", "no-user-gesture-required");

  // concede permissao de microfone automaticamente para todas as origens
  // (file://, http://, https://). Sem isso, getUserMedia devolve
  // NotAllowedError mesmo com o prompt suprimido.
  aCommandLine->AppendSwitchWithValue("enable-features",
    "WebRTC,WebRtcHideLocalIpsWithMdns,MediaSession,MediaStream,GetUserMedia");

  // fallback: se mesmo assim o mic real for bloqueado (permissao do SO,
  // driver, antivirus), usa dispositivo de audio sintetico em vez de
  // quebrar a conexao. Liga com --use-file-for-fake-audio-capture=<wav>
  // se quiser um arquivo; vazio = silencio.
  aCommandLine->AppendSwitch("use-fake-device-for-media-stream");
  aCommandLine->AppendSwitchWithValue("use-file-for-fake-audio-capture", "");

  // alguns drivers USB de mic exigem isto pra enumerar dispositivos
  aCommandLine->AppendSwitch("allow-file-access-from-files");
  aCommandLine->AppendSwitch("disable-web-security");
}
```

⚠️ `disable-web-security` desabilita a same-origin policy do Chromium embutido — aceitável aqui porque o CEF do SkyMP só carrega a UI local (`skymp/ui/`), não navega pra origens arbitrárias, mas **registrar essa decisão explicitamente** se este patch for aplicado (mesma lógica de por que desativamos isso no Electron do launcher — ver `apps/launcher/electron/main.ts`).

## Passos pra quem for aplicar (precisa de ambiente C++/CEF/MSVC — Windows, Visual Studio, vcpkg)

1. Fork de `skyrim-multiplayer/skymp` (GPLv3/AGPLv3 — ver `docs/technical/LICENSE_AND_AFFILIATION_POLICY.md` seção 2: registrar o fork, disponibilizar código-fonte, manter avisos de licença).
2. Seguir `CONTRIBUTING.md` e `docs/docs_client_installation.md` do próprio repo upstream pra setup do ambiente de build (submódulos, vcpkg, CMake) — não reproduzido aqui porque não foi validado neste ambiente.
3. Aplicar o diff acima em `skyrim-platform/src/tilted/ui/MyChromiumApp.cpp`.
4. Build do `skyrim-platform` (gera o client SkyMP com o patch).
5. Testar `getUserMedia` manualmente antes de liberar pra produção: abrir a UI CEF em jogo, rodar `navigator.mediaDevices.getUserMedia({audio:true})` no console e confirmar que retorna um `MediaStream` em vez de lançar `NotAllowedError`.
6. Publicar o build patchado como parte do manifesto do Launcher (`apps/web` — ver `docs/ARCHITECTURE.md` 1.5), com hash verificado como qualquer outro arquivo do client.
7. Documentar a alteração no changelog e no registro de fork exigido pela política de licença.

## Enquanto isso não existe

`/voz` continua registrado e funcional no servidor (`ENABLE_VOIP_SERVICE`), mas o client vai falhar ao pedir o microfone com `NotAllowedError` — o comportamento esperado é a UI mostrar isso claramente e sugerir canal de voz do Discord como alternativa (ver `docs/ARCHITECTURE.md` 1.4.4 e a seção de canais de voz temporários do bot Discord).

---

**Atualização (07/08/2026).** O parágrafo acima continua valendo para *falar*: sem
o helper nativo instalado, o microfone segue bloqueado e o Discord segue sendo a
alternativa. O que mudou é que **ouvir deixou de depender disso** — o
`voip-service` retransmite os quadros de quem tem o helper, e a UI toca. Por isso
a UI não fecha mais o WebSocket quando o microfone falha; fechar deixaria a
pessoa muda *e* surda. Ver [`VOICE_NATIVE_HELPER.md`](VOICE_NATIVE_HELPER.md) §6.
