# Patch de Client — Liberar Microfone no CEF (Voz por Proximidade)

## Contexto

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
