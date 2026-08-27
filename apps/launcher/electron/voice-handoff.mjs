import http from 'node:http';

/**
 * Porta loopback fixa onde o launcher escuta o handoff do ticket de voz.
 * A CEF (`skymp/ui/index.html`, `forwardVoiceHandoff`) faz POST aqui com o
 * ticket de 'sender' + actorId, e o launcher sobe o `voice-helper.exe`.
 *
 * Fixa e conhecida dos dois lados, igual à porta 19847 do callback do OAuth —
 * a CEF é um terceiro processo, não há canal pra negociar porta.
 */
export const VOICE_HANDOFF_PORT = 19848;

const MAX_BODY_BYTES = 4096;
const TICKET_RE = /^[a-f0-9]{8,128}$/i;

/**
 * Servidor HTTP loopback pro handoff de voz.
 *
 * "Armado" só entre um `launch-game` e o fim daquela sessão de jogo: um POST
 * fora dessa janela responde 409. Reduz a chance de um processo local qualquer
 * disparar o helper quando não há jogo rodando — dentro da janela, a CEF do
 * jogo é o remetente esperado, e o ticket já é de uso único e 30s de TTL.
 *
 * @param {{ onHandoff: (h: { actorId: number, ticket: string, host: string, port: number }) => Promise<{ pid?: number }>, host?: string, port?: number }} opts
 */
export function createVoiceHandoffServer({ onHandoff, host = '127.0.0.1', port = VOICE_HANDOFF_PORT }) {
  let armed = false;

  const server = http.createServer((req, res) => {
    // A CEF carrega o index.html como file:// (origin "null") — sem CORS liberado
    // o fetch nem sai.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method !== 'POST' || (req.url || '').split('?')[0] !== '/voice-handoff') {
      res.writeHead(404); return res.end();
    }
    if (!armed) {
      res.writeHead(409); return res.end(JSON.stringify({ ok: false, error: 'disarmed' }));
    }

    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      res.writeHead(413); return res.end(JSON.stringify({ ok: false, error: 'too_large' }));
    }

    let raw = '';
    let aborted = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) { aborted = true; req.destroy(); }
    });
    req.on('end', async () => {
      if (aborted) return;

      let body;
      try { body = JSON.parse(raw); } catch {
        res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'bad_json' }));
      }

      const actorId = Number(body && body.actorId);
      const ticket = body && typeof body.ticket === 'string' ? body.ticket : '';
      const vhost = body && typeof body.host === 'string' && body.host ? body.host : '127.0.0.1';
      const vport = Number(body && body.port) || 7778;

      if (!Number.isInteger(actorId) || actorId <= 0 || !TICKET_RE.test(ticket) || !Number.isInteger(vport) || vport <= 0) {
        res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'bad_body' }));
      }

      try {
        const result = await onHandoff({ actorId, ticket, host: vhost, port: vport });
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, pid: result && result.pid }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: (err && err.message) || 'spawn_failed' }));
      }
    });
  });

  return {
    listen() {
      return new Promise((resolve, reject) => {
        const onErr = (e) => reject(e);
        server.once('error', onErr);
        server.listen(port, host, () => {
          server.removeListener('error', onErr);
          resolve(server.address());
        });
      });
    },
    arm() { armed = true; },
    disarm() { armed = false; },
    isArmed() { return armed; },
    address() { return server.address(); },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
