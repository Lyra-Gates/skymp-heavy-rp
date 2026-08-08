// voice-helper — captura o microfone fora do CEF e manda os quadros pro
// voip-service do gamemode.
//
// Por que este processo existe: o navegador embutido do client SkyMP (CEF) não
// libera `getUserMedia`. A flag do Chromium que liberava foi *removida de
// propósito* na SkyrimPlatform 2.1, e revertê-la exporia o microfone do jogador
// a qualquer servidor SkyMP que ele conectasse depois — o client abre a URL que
// o servidor mandar. Ver docs/technical/VOICE_NATIVE_HELPER.md.
//
// A captura sai do navegador; a reprodução continua nele (tocar áudio recebido
// nunca foi bloqueado). O servidor vira relay: recebe daqui, decide por
// proximidade quem ouve e com que volume, e reenvia.
//
// Fase 1 (prova de conceito). Sem UI, sem handoff automático de ticket, sem
// empacotamento. Argumentos na linha de comando e Ctrl+C pra sair.

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>

#include <ixwebsocket/IXNetSystem.h>
#include <ixwebsocket/IXWebSocket.h>

#include <nlohmann/json.hpp>

namespace {

// Formato do fio — tem que bater com AUDIO_* em skymp/gamemode/voip-service.js
// e com RELAY_SAMPLE_RATE em skymp/ui/index.html. Três lugares, um formato; se
// algum divergir o áudio sai em velocidade errada em vez de falhar limpo.
constexpr ma_uint32 kSampleRate = 48000;
constexpr ma_uint32 kChannels = 1;
constexpr ma_uint32 kFrameMs = 20;
constexpr ma_uint32 kSamplesPerFrame = kSampleRate / 1000 * kFrameMs;  // 960

// Teto da fila entre a thread de áudio e a de rede, em quadros (~1s).
//
// Não é otimização: o callback do miniaudio roda numa thread de tempo real e
// não pode bloquear esperando a rede. Se o socket engasgar, a fila cresce; ao
// bater no teto descartamos o quadro mais ANTIGO. Numa conversa, áudio velho
// não tem valor — entregá-lo atrasado é pior do que não entregar.
constexpr size_t kMaxQueuedFrames = 50;

std::atomic<bool> g_running{true};

void OnSignal(int) { g_running = false; }

// ── base64 ────────────────────────────────────────────────────────────────
// Escrito à mão em vez de puxar mais uma dependência: são 20 linhas e é o único
// uso de base64 no programa inteiro.
const char kB64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string Base64Encode(const uint8_t* data, size_t len) {
  std::string out;
  out.reserve(((len + 2) / 3) * 4);
  size_t i = 0;
  for (; i + 2 < len; i += 3) {
    const uint32_t n = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    out.push_back(kB64[(n >> 18) & 63]);
    out.push_back(kB64[(n >> 12) & 63]);
    out.push_back(kB64[(n >> 6) & 63]);
    out.push_back(kB64[n & 63]);
  }
  if (i < len) {
    uint32_t n = data[i] << 16;
    const bool two = (i + 1 < len);
    if (two) n |= data[i + 1] << 8;
    out.push_back(kB64[(n >> 18) & 63]);
    out.push_back(kB64[(n >> 12) & 63]);
    out.push_back(two ? kB64[(n >> 6) & 63] : '=');
    out.push_back('=');
  }
  return out;
}

// ── fila entre a thread de áudio e a de rede ──────────────────────────────
class FrameQueue {
 public:
  void Push(std::vector<int16_t>&& frame) {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (queue_.size() >= kMaxQueuedFrames) {
        queue_.pop_front();
        ++dropped_;
      }
      queue_.push_back(std::move(frame));
    }
    cv_.notify_one();
  }

  // Devolve false quando é hora de encerrar.
  bool Pop(std::vector<int16_t>& out) {
    std::unique_lock<std::mutex> lock(mutex_);
    cv_.wait_for(lock, std::chrono::milliseconds(100),
                 [this] { return !queue_.empty() || !g_running; });
    if (queue_.empty()) return g_running.load();
    out = std::move(queue_.front());
    queue_.pop_front();
    return true;
  }

  void Wake() { cv_.notify_all(); }
  uint64_t dropped() const { return dropped_; }

 private:
  std::mutex mutex_;
  std::condition_variable cv_;
  std::deque<std::vector<int16_t>> queue_;
  std::atomic<uint64_t> dropped_{0};
};

// Estado partilhado com o callback de áudio. Fica em ponteiro no
// ma_device_config::pUserData; nada aqui aloca no caminho quente além do
// vector do quadro pronto.
struct CaptureState {
  FrameQueue* queue = nullptr;
  std::vector<int16_t> accumulator;  // sobra entre callbacks
};

// Chamado pelo miniaudio numa thread de tempo real. Regra: nada de rede, nada
// de I/O, nada de lock demorado. Só acumula e empurra pra fila.
void OnCapture(ma_device* device, void* /*output*/, const void* input,
               ma_uint32 frameCount) {
  auto* state = static_cast<CaptureState*>(device->pUserData);
  if (state == nullptr || input == nullptr) return;

  const int16_t* samples = static_cast<const int16_t*>(input);
  state->accumulator.insert(state->accumulator.end(), samples, samples + frameCount);

  // O tamanho do buffer do WASAPI não é múltiplo de 20ms, então quase sempre
  // sobra um pedaço — ele fica no acumulador pro próximo callback. Cortar o
  // resto fora produziria estalos periódicos.
  while (state->accumulator.size() >= kSamplesPerFrame) {
    std::vector<int16_t> frame(state->accumulator.begin(),
                               state->accumulator.begin() + kSamplesPerFrame);
    state->accumulator.erase(state->accumulator.begin(),
                             state->accumulator.begin() + kSamplesPerFrame);
    state->queue->Push(std::move(frame));
  }
}

struct Options {
  uint32_t actor_id = 0;
  std::string ticket;
  std::string host = "127.0.0.1";
  uint16_t port = 7778;
  bool valid = false;
};

void PrintUsage(const char* argv0) {
  std::fprintf(stderr,
    "voice-helper — captura o microfone e envia pro voip-service do SkyMP\n"
    "\n"
    "Uso:\n"
    "  %s --actor-id <id> --ticket <token> [--host <host>] [--port <porta>]\n"
    "\n"
    "  --actor-id  formID do ator, decimal ou 0x-hex (ex.: 0xFF000A12)\n"
    "  --ticket    token de uso unico emitido pelo servidor (comando /voz)\n"
    "  --host      host do voip-service (padrao: 127.0.0.1)\n"
    "  --port      porta do voip-service (padrao: 7778)\n"
    "\n"
    "O ticket vale 30 segundos e so pode ser usado uma vez. Na Fase 1 ele e\n"
    "passado a mao — nao existe handoff automatico entre o jogo e o helper.\n"
    "Ver voice-helper/README.md.\n",
    argv0);
}

Options ParseArgs(int argc, char** argv) {
  Options opt;
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    const bool has_next = (i + 1 < argc);
    if (arg == "--actor-id" && has_next) {
      // stoul base 0: aceita 0xFF000A12 e decimal. FormIDs passam de 2^31,
      // então o tipo tem que ser sem sinal — com int, 0xFF000A12 estoura.
      try {
        opt.actor_id = static_cast<uint32_t>(std::stoul(argv[++i], nullptr, 0));
      } catch (const std::exception&) {
        std::fprintf(stderr, "[helper] --actor-id invalido: %s\n", argv[i]);
        return opt;
      }
    } else if (arg == "--ticket" && has_next) {
      opt.ticket = argv[++i];
    } else if (arg == "--host" && has_next) {
      opt.host = argv[++i];
    } else if (arg == "--port" && has_next) {
      opt.port = static_cast<uint16_t>(std::stoul(argv[++i]));
    } else if (arg == "--help" || arg == "-h") {
      return opt;
    } else {
      std::fprintf(stderr, "[helper] argumento desconhecido: %s\n", arg.c_str());
      return opt;
    }
  }
  opt.valid = (opt.actor_id != 0 && !opt.ticket.empty());
  return opt;
}

}  // namespace

int main(int argc, char** argv) {
  const Options opt = ParseArgs(argc, argv);
  if (!opt.valid) {
    PrintUsage(argv[0]);
    return 2;
  }

  std::signal(SIGINT, OnSignal);
  std::signal(SIGTERM, OnSignal);

  ix::initNetSystem();

  FrameQueue queue;
  CaptureState capture_state;
  capture_state.queue = &queue;
  capture_state.accumulator.reserve(kSamplesPerFrame * 4);

  // ── microfone (WASAPI em modo compartilhado) ────────────────────────────
  // Compartilhado, não exclusivo: em modo exclusivo o helper tomaria o
  // dispositivo do resto do sistema, e o jogador perderia o áudio do Discord,
  // do navegador e de qualquer outra coisa enquanto joga.
  ma_device_config config = ma_device_config_init(ma_device_type_capture);
  config.capture.format = ma_format_s16;
  config.capture.channels = kChannels;
  config.capture.shareMode = ma_share_mode_shared;
  config.sampleRate = kSampleRate;
  config.dataCallback = OnCapture;
  config.pUserData = &capture_state;

  ma_device device;
  if (ma_device_init(nullptr, &config, &device) != MA_SUCCESS) {
    std::fprintf(stderr, "[helper] Falha ao abrir o microfone padrao.\n");
    ix::uninitNetSystem();
    return 1;
  }

  // O que o miniaudio realmente conseguiu negociar pode não ser o que pedimos.
  // O servidor e a UI assumem 48kHz mono fixo, então divergência aqui viraria
  // áudio em velocidade errada do outro lado — falhar alto é melhor.
  if (device.capture.internalSampleRate != kSampleRate) {
    std::fprintf(stderr,
      "[helper] Aviso: dispositivo em %u Hz; miniaudio esta reamostrando pra %u Hz.\n",
      device.capture.internalSampleRate, kSampleRate);
  }

  // ── WebSocket ───────────────────────────────────────────────────────────
  // Mesma porta e mesmo handshake por ticket que o index.html já usa. Inventar
  // um segundo sistema de autenticação pra mesma coisa seria dobrar a
  // superfície de ataque em troca de nada.
  const std::string url = "ws://" + opt.host + ":" + std::to_string(opt.port);
  ix::WebSocket ws;
  ws.setUrl(url);
  ws.disableAutomaticReconnection();  // ticket e de uso unico: reconectar sozinho falharia

  std::atomic<bool> authed{false};
  std::atomic<bool> auth_failed{false};

  ws.setOnMessageCallback([&](const ix::WebSocketMessagePtr& msg) {
    if (msg->type == ix::WebSocketMessageType::Open) {
      std::printf("[helper] Conectado em %s; autenticando como sender.\n", url.c_str());
      // `role: "sender"` é o que permite este processo coexistir com o
      // index.html do MESMO jogador. Sem o campo o servidor assume "listener"
      // (o padrão de compatibilidade), e as duas conexões brigariam pelo mesmo
      // slot — quem autenticasse por último derrubaria o outro. O ticket também
      // é por papel: o `/voz` emite um pra UI e um pro helper.
      // Ver docs/technical/VOICE_NATIVE_HELPER.md §10.
      nlohmann::json auth{{"type", "auth"},
                          {"actorId", opt.actor_id},
                          {"ticket", opt.ticket},
                          {"role", "sender"}};
      ws.send(auth.dump());
    } else if (msg->type == ix::WebSocketMessageType::Message) {
      nlohmann::json parsed = nlohmann::json::parse(msg->str, nullptr, false);
      if (parsed.is_discarded() || !parsed.contains("type")) return;
      const std::string type = parsed["type"].get<std::string>();
      if (type == "auth_ok") {
        authed = true;
        std::printf("[helper] Autenticado. Capturando; Ctrl+C pra sair.\n");
      } else if (type == "auth_failed") {
        auth_failed = true;
        std::fprintf(stderr,
          "[helper] Auth recusada. O ticket vale 30s e so serve uma vez — "
          "rode /voz de novo e use o token novo.\n");
        g_running = false;
        queue.Wake();
      }
      // proximity_update / audio_frame chegam aqui tambem e sao ignorados de
      // proposito: quem toca audio e o navegador do jogo, nao este processo.
    } else if (msg->type == ix::WebSocketMessageType::Error) {
      std::fprintf(stderr, "[helper] Erro de socket: %s\n",
                   msg->errorInfo.reason.c_str());
      g_running = false;
      queue.Wake();
    } else if (msg->type == ix::WebSocketMessageType::Close) {
      std::fprintf(stderr, "[helper] Conexao fechada pelo servidor.\n");
      g_running = false;
      queue.Wake();
    }
  });

  ws.start();

  if (ma_device_start(&device) != MA_SUCCESS) {
    std::fprintf(stderr, "[helper] Falha ao iniciar a captura.\n");
    ma_device_uninit(&device);
    ws.stop();
    ix::uninitNetSystem();
    return 1;
  }

  // ── laço de envio ───────────────────────────────────────────────────────
  uint64_t seq = 0;
  uint64_t sent = 0;
  std::vector<int16_t> frame;

  while (g_running) {
    if (!queue.Pop(frame) || frame.empty()) continue;

    // Quadros capturados antes do auth_ok são descartados: o servidor os
    // ignoraria de qualquer forma, e guardá-los só adicionaria atraso à
    // primeira sílaba que alguém de fato ouvir.
    if (!authed) { frame.clear(); continue; }

    const std::string data = Base64Encode(
        reinterpret_cast<const uint8_t*>(frame.data()),
        frame.size() * sizeof(int16_t));

    nlohmann::json out{{"type", "audio_frame"}, {"seq", seq++}, {"data", data}};
    ws.send(out.dump());
    frame.clear();

    if (++sent % 250 == 0) {  // ~5s
      std::printf("[helper] %llu quadros enviados (%llu descartados na fila).\n",
                  static_cast<unsigned long long>(sent),
                  static_cast<unsigned long long>(queue.dropped()));
      std::fflush(stdout);
    }
  }

  std::printf("[helper] Encerrando. %llu quadros enviados.\n",
              static_cast<unsigned long long>(sent));

  ma_device_uninit(&device);
  ws.stop();
  ix::uninitNetSystem();
  return auth_failed ? 1 : 0;
}
