# Voz por Proximidade — Helper Nativo (Fase 1: prova de conceito)

> **Status:** pipeline provado em bancada, **helper C++ nunca compilado** (§8).
> Substitui o caminho de [`VOICE_CLIENT_PATCH.md`](VOICE_CLIENT_PATCH.md), que
> fica no repositório como registro de por que foi descartado.

## 1. Por que este documento existe

O `voip-service.js` estava implementado e testado desde antes: sinalização
WebRTC, autenticação por ticket, volume por distância. E nunca produziu áudio
nenhum, porque o navegador embutido do client SkyMP (CEF) recusa
`getUserMedia({audio:true})` com `NotAllowedError`.

A explicação que circulava — e que estava escrita em comentário no
`skymp/ui/index.html` até 07/08/2026 — era que "falta um patch em
`MyChromiumApp.cpp` que nunca foi mergeado upstream", como se fosse
esquecimento dos mantenedores.

Não é. O release notes da **SkyrimPlatform 2.1** (o SkyMP hoje usa a 2.6)
registra a remoção com todas as letras:

> "Removed Chromium flag that gives the ability to listen to recording devices
> via browser-side JavaScript"

Foi uma **remoção deliberada**, e a razão dela é sólida. O client SkyMP abre a
URL que o servidor mandar. Com a flag ligada, qualquer JavaScript servido por
qualquer servidor SkyMP captaria o microfone do jogador **em silêncio, sem
prompt de permissão do sistema**. Reverter isso num build distribuído não
resolveria um risco do nosso servidor — criaria um risco permanente, do client
inteiro, em qualquer servidor que aquele jogador conectasse depois.

Por isso o caminho mudou.

## 2. A decisão de arquitetura

**A captura sai do navegador. A reprodução fica.**

Um executável separado (`voice-helper/`), rodando ao lado do jogo, captura o
microfone pela API de áudio do Windows e manda os quadros para o `voip-service`.
O servidor decide por proximidade quem ouve e com que volume, e retransmite. O
navegador do jogo apenas **toca** o que chega — e tocar áudio recebido nunca foi
bloqueado pela CEF. Só a captura era.

```
  helper nativo            voip-service (gamemode)              index.html
  ┌──────────────┐         ┌───────────────────────┐         ┌──────────────┐
  │ WASAPI       │ audio_  │ tickProximity() 2s    │ audio_  │ decodifica   │
  │ (compartilh.)│ frame   │   → audiência         │ frame   │ Web Audio    │
  │ PCM s16 48k  ├────────►│ relay + volume anexado├────────►│ gain=volume  │
  │ quadros 20ms │  ws     │ (não olha os bytes)   │  ws     │ → destination│
  └──────────────┘         └───────────────────────┘         └──────────────┘
```

### Efeito colateral bom: NAT/CGNAT

A troca de WebRTC P2P (malha de `RTCPeerConnection` entre pares) por relay
central resolve de graça um problema que o caminho antigo teria em produção:
dois jogadores em redes residenciais diferentes, ambos atrás de CGNAT, não
fecham conexão direta nem com STUN — precisariam de um TURN, que é um servidor
de relay com outro nome. Aqui tudo passa pelo servidor, que já é alcançável por
todo mundo porque é nele que o jogo conecta.

### O que o servidor não faz

O servidor **não decodifica, não mistura e não transcodifica** — anexa o volume
e repassa os bytes. Mixagem no servidor economizaria banda de descida, mas
exigiria decodificar e somar N fluxos por ouvinte a cada 20ms. Numa prova de
conceito isso é trocar um problema já provado por um que não foi.

## 3. Decisão: PCM cru, não Opus (nesta fase)

**Escolhido:** PCM 16-bit little-endian, mono, 48kHz, quadros de 20ms.

O motivo é isolar falhas. Codec e transporte quebram de formas parecidas do lado
de quem escuta — sai silêncio, ou sai ruído. Depurando os dois ao mesmo tempo,
não dá para saber se o áudio saiu errado porque o quadro chegou truncado ou
porque o encoder foi alimentado errado. Com PCM, "os bytes que entraram são os
bytes que saíram" é verificável com uma conta.

Os parâmetros:

- **48kHz** é o padrão do WASAPI em modo compartilhado. Pedir outra coisa faria
  o Windows reamostrar antes de a gente ver o áudio — mais uma etapa capaz de
  errar em silêncio.
- **Quadros de 20ms** é o quadro nativo do Opus. Escolher isso agora significa
  que a Fase 2 troca o codec sem mexer no enquadramento.
- **Mono** porque a voz é posicionada pelo volume da proximidade; estéreo do
  microfone seria descartado do outro lado de qualquer forma.

**O preço, medido:** 48000 × 2 bytes = 96 kB/s = **768 kbit/s por locutor**, e
base64 (§4) infla 33% → **~1 Mbit/s de subida**. Na descida, o relay multiplica
pelo número de ouvintes em alcance. Isso é caro e é sabido — é aceitável para
uma prova de conceito em rede local e **não é aceitável em produção**.

**Fase 2: Opus** (`libopus`, disponível no vcpkg). A 24 kbit/s a voz fica
transparente e o consumo cai ~30x, o que também torna irrelevante o desperdício
do base64.

## 4. Decisão: mesma porta, mesmo ticket, JSON com base64

**Escolhido:** o helper conecta na porta do `voip-service` (7778) e autentica com
o mesmo `{type:'auth', actorId, ticket}` que o `index.html` já usa.

Não há um segundo sistema de autenticação porque não há um segundo problema. O
handshake por ticket existente já resolve exatamente isto — provar que quem
conecta é o dono daquele `actorId` — e já é testado. Inventar outro dobraria a
superfície de ataque em troca de nada.

**Formato da mensagem:**

```jsonc
// helper → servidor
{ "type": "audio_frame", "seq": 41, "data": "<base64 de PCM s16le>" }

// servidor → cada ouvinte em alcance
{ "type": "audio_frame", "fromActorId": 4278192658, "volume": 0.75,
  "seq": 41, "data": "<os mesmos bytes>" }
```

**Base64 em JSON, e não quadro binário do WebSocket.** O binário economizaria os
33%, mas exigiria um cabeçalho próprio para carregar `fromActorId`/`volume`/`seq`
— um segundo formato de fio, com seu próprio parser, do lado do servidor e do
navegador. Todo o resto deste socket é JSON. Com Opus na Fase 2 os 33% incidem
sobre 24 kbit/s, e a economia deixa de pagar a complexidade.

**Teto de 8192 caracteres no payload.** O `audio_frame` é o único ponto onde um
cliente autenticado faz o servidor escrever dados controlados por ele nos
sockets de *outros* jogadores. Sem teto, um quadro de megabytes é multiplicado
pela audiência inteira — amplificação, e a memória que estoura é a do servidor.
8192 dá folga de 3x sobre o quadro nominal.

## 5. Reuso do tick de proximidade

O relay **não recalcula proximidade por quadro**. `tickProximity()` já roda a
cada 2s e já calcula, para cada par, o volume que um ouve o outro; o que faltava
era guardar. Agora ele monta `_audienceByActor` — a transposta do que já era
calculado e jogado fora:

```
actorId do locutor → [{ actorId: ouvinte, volume }]
```

Proximidade é O(n²) de distância 3D. Um quadro chega a 50/s por locutor;
recalcular por quadro seria pagar esse O(n²) cinquenta vezes por segundo por
pessoa falando.

**A audiência tem até 2s de idade**, e isso é herdado, não introduzido: o
`proximity_update` que ajusta o ganho do WebRTC sempre teve a mesma defasagem.
Consequência prática — quem sai do alcance continua ouvindo por até 2s, e quem
*entra* fica mudo por até 2s. Em velocidade de corrida do Skyrim (~350 unidades/s)
isso são ~700 unidades contra um alcance de fala de 1200. Ver §9.

**O mesmo número, não uma cópia dele.** O volume que vai anexado no `audio_frame`
sai da mesma conta que alimenta o `proximity_update`. Se fossem dois cálculos, a
mesma pessoa poderia soar em dois volumes diferentes dependendo do transporte
que a entregou. Há teste travando a igualdade.

## 6. O que mudou no `index.html`

Adiciona, não substitui. `getUserMedia`, `RTCPeerConnection`, `createPeerConnection`,
`initiateCall`, `handleOffer`, `state.voiceFatal` e as mensagens de erro do
microfone continuam todos lá — é o que roda no client oficial de quem não tem o
helper, e o encaminhamento pro Discord segue válido pra essa pessoa.

Três mudanças merecem registro:

1. **O `AudioContext` saiu de dentro do `initMicrophone()`.** Nascer junto com a
   captura fazia sentido quando a única fonte era WebRTC. Agora tocar não depende
   de capturar — e no client oficial capturar *sempre* falha, que é exatamente o
   caso em que este caminho precisa funcionar.

2. **O WebSocket não é mais fechado quando o microfone falha.** Antes era, com o
   argumento de que "sem microfone não há como publicar nem faz sentido manter a
   sinalização aberta". O argumento era correto enquanto o socket só levasse
   sinalização. Este PR põe áudio de outras pessoas nele: fechar ali desligaria
   a **escuta** junto com a captura, garantindo que ninguém nunca ouça nada
   justamente no client onde a captura falha sempre. `voiceFatal` continua
   marcado e a mensagem específica continua na tela.

3. **Chip de estado âmbar, `OUVINDO — SEM MICROFONE`.** Sem isso o jogador lê
   "VOZ INDISPONÍVEL" enquanto ouve alguém falando — a tela contradizendo a caixa
   de som. Verde mentiria (não dá pra falar) e vermelho também (dá pra ouvir).

As fontes de relay ficam em `state.relayPeers`, separadas de `state.peers`. Toda
entrada de `peers` tem um `RTCPeerConnection` e `removePeer` chama `pc.close()`;
uma fonte de relay não tem `pc`, e misturar as duas transformaria cada uso de
`peers` num campo minado de `if (peer.pc)`.

## 7. Resultado do teste ponta a ponta

Feito em 07/08/2026, com `voice-helper/tools/e2e-harness.js` (sobe o
`voip-service` real com `mp` mockado e posições controláveis por HTTP) e
`voice-helper/tools/frame-probe.js` (fala o protocolo do helper, gerando um tom
de 440Hz em vez de capturar microfone).

O ouvinte foi o **`skymp/ui/index.html` real**, carregado num navegador comum.
O navegador **bloqueou o microfone da página** — a mesma `NotAllowedError` do
CEF, o que deu ao teste a condição exata do client oficial.

### ✅ O que foi verificado

| O quê | Medido |
|---|---|
| Relay servidor→servidor | 1920 bytes por quadro, byte-a-byte idênticos |
| Enquadramento no navegador | 960 amostras, 20ms, 48kHz por buffer |
| Fidelidade do PCM | pico **0.3000** = amplitude exata do tom gerado |
| Sinal decodificado | RMS **0.2107** vs 0.2121 teórico de senoide 0.3 (0,7%) |
| Frequência | energia em 440Hz **6300× maior** que o controle em 1000Hz |
| Volume por proximidade (600 de 1200) | ganho **0.5**, saída pico **0.15** = 0.3 × 0.5 |
| Volume por proximidade (300 de 1200) | ganho **0.75**, saída pico **0.225** = 0.3 × 0.75 |
| Saída medida no grafo de áudio | RMS 0.1586 vs 0.1591 esperado; FFT em 445Hz (bin de 23,4Hz) |
| Corte por distância | ouvinte a 2000 com locutor ativo: **0 buffers agendados** |
| Retomada ao entrar no alcance | 0 → **461 buffers**, HUD em 75% |
| Socket sobrevive à falha de microfone | ✅ sem a mudança do §6.2, zero quadros chegariam |
| Erros de decodificação | **nenhum** em ~1300 quadros |

O sinal foi medido no `AnalyserNode` ligado à saída da cadeia de ganho que
alimenta o `destination` — depois do volume da proximidade, não antes.

### ❌ O que NÃO foi verificado

1. **Captura WASAPI. O helper C++ nunca foi compilado nem executado.** Ver §8.
   Tudo acima foi validado com a sonda em Node, que gera o tom em vez de captar.
   O `main.cpp` está escrito e revisado, e não está provado.

2. **Ninguém ouviu o áudio com o ouvido.** Não há saída de áudio audível neste
   ambiente. O que existe é medição do sinal no ponto em que ele entra no
   `destination` do Web Audio, com frequência e amplitude conferidas contra o
   valor teórico. É forte, e não é a mesma coisa que escutar.

3. **Dois clientes Skyrim reais.** Posições vieram do `mp` mockado.

4. **Qualquer coisa fora de `127.0.0.1`.** Latência, perda e jitter de rede real
   não foram exercitados; o jitter buffer de 60ms nunca viu um pacote atrasado.

## 8. Bloqueio: não há toolchain C++ nesta máquina

O helper não foi compilado porque **o ambiente não tem com o que compilar**.
Verificado em 07/08/2026:

```
where cmake                 → (nada)
where vcpkg                 → (nada)
where cl                    → INFORMAÇÕES: não foi possível localizar arquivos
where msbuild               → INFORMAÇÕES: não foi possível localizar arquivos
$VCPKG_ROOT                 → vazio
```

- `C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe` **não
  existe** — sem ele nem o instalador do VS está presente.
- `C:\Program Files (x86)\Microsoft Visual Studio\` contém **apenas `Shared\`**.
- `C:\Program Files\MSBuild\` contém apenas `Microsoft\Windows Workflow
  Foundation\v3.0` e `v3.5` — resíduo do .NET Framework, não do MSVC.
- Nenhum `gcc`, `g++` ou `clang` no PATH. Nenhum diretório `vcpkg`.

Ou seja: **nenhuma dependência do vcpkg chegou a ser resolvida**, porque não há
vcpkg para resolvê-las. O `vcpkg.json` e o `CMakeLists.txt` estão escritos com
base na documentação das portas (`miniaudio`, `ixwebsocket`, `nlohmann-json`) e
**não foram validados contra um `vcpkg install` real**. Quem tiver a máquina
deve tratá-los como não verificados até o primeiro build passar, e registrar
aqui o erro exato se alguma port não resolver — sem trocar de biblioteca sem
anotar o motivo.

Escolha do `miniaudio` sobre WASAPI/COM cru: header-only, licença permissiva
(MIT/domínio público), e evita ~400 linhas de `IMMDeviceEnumerator`/`IAudioClient`
que seriam código nosso para manter sem ganho nenhum sobre o que a biblioteca já
faz. Escolha do `ixwebsocket`: API pequena e síncrona o bastante para caber num
executável de terminal, sem arrastar Boost.

## 9. Próxima rodada — listado, não implementado

Nada abaixo foi feito neste PR.

**Bloqueadores de uso real**

1. **Um socket por `actorId` impede helper e UI de coexistirem.** `voipClients` é
   indexado por `actorId`: se o helper autentica como o jogador X, ele *substitui*
   a conexão da UI de X, e vice-versa. O teste de bancada contornou isso usando
   dois atores diferentes (helper = A, navegador = B). Um jogador de verdade
   precisa dos dois ao mesmo tempo. Exige conexões com papel (`sender`/`listener`)
   ou múltiplas conexões por ator — e mexe em `broadcast`, `tickProximity`,
   fechamento de socket e no relay.
2. **Handoff automático do ticket.** Hoje é copiar e colar na linha de comando.
   Pior: `issueTicket` sobrescreve o ticket pendente daquele ator, então um `/voz`
   não serve para os dois lados.
3. **Empacotamento e assinatura do executável**, e integração com o launcher —
   mesma exigência de carimbo de tempo já registrada em
   [`LAUNCHER_DISTRIBUTION.md` §6](LAUNCHER_DISTRIBUTION.md).

**Qualidade**

4. **Opus** no lugar do PCM cru (§3). ~30x menos banda.
5. **Cancelamento de eco e supressão de ruído.** Sem AEC, quem usa caixa de som
   em vez de fone realimenta a própria voz na cena.
6. **Primeiros ~2s de fala são perdidos** enquanto o tick não monta a audiência
   do locutor recém-conectado (medido: 45 de 195 quadros no primeiro teste).
   Montar a audiência no `auth` ou reduzir o intervalo do tick resolve.
7. **Serialização por ouvinte.** O payload é re-serializado para cada
   destinatário porque o `volume` difere. Com Opus o custo vira irrelevante.

**Limpeza**

8. **Remover o WebRTC do `index.html`** (`createPeerConnection`, `initiateCall`,
   `handleOffer`, relay de `offer`/`answer`/`ice` no servidor). Só depois que o
   helper estiver distribuído — hoje é o único caminho que existe para quem não
   o tem.
9. **`--list-devices` no helper**, para quem tem mais de um microfone.
10. **Teste com rede real**, não `127.0.0.1`.
