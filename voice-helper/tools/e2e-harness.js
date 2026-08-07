#!/usr/bin/env node
/**
 * e2e-harness.js — sobe o voip-service isolado, com posições falsas, pra provar
 * o pipeline de voz sem precisar de um servidor Skyrim rodando.
 *
 * ⚠️ FERRAMENTA DE TESTE LOCAL. Emite ticket de voz pra qualquer actorId que
 * pedir, sem autenticação nenhuma — é exatamente o furo que o handshake por
 * ticket existe pra fechar. Só faz sentido em 127.0.0.1, numa máquina de
 * desenvolvimento. Nunca perto de produção, nunca com bind público.
 *
 * O que ele monta:
 *   - `mp` mockado, com posições que você controla por HTTP;
 *   - o voip-service de verdade (mesmo código do gamemode), em porta conhecida;
 *   - um HTTP server que serve `skymp/ui/index.html` e emite tickets.
 *
 * Uso:
 *   node voice-helper/tools/e2e-harness.js [--voip-port 7778] [--http-port 8099]
 *
 * Rotas:
 *   GET /                          → o index.html real de skymp/ui/
 *   GET /ticket?actorId=0xFF000A12 → { actorId, ticket, host, port }
 *   GET /move?actorId=..&x=..&y=..&z=..  → reposiciona um ator
 *   GET /state                     → posições e conectados
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
function argOf(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const VOIP_PORT = Number.parseInt(argOf('--voip-port', '7778'), 10);
const HTTP_PORT = Number.parseInt(argOf('--http-port', '8099'), 10);

const UI_ROOT = path.resolve(__dirname, '..', '..', 'skymp', 'ui');
const GAMEMODE = path.resolve(__dirname, '..', '..', 'skymp', 'gamemode');

// Posições dos atores no mundo, em unidades do Skyrim.
const positions = new Map();

// O gamemode fala com o servidor por este global. O voip-service só lê
// `locationalData`, então é só isso que o mock precisa entregar.
global.mp = {
  get: (actorId, prop) => {
    if (prop !== 'locationalData') return null;
    const pos = positions.get(Number(actorId));
    return pos ? { pos } : null;
  },
  set: () => {}
};

// `database` é puxado transitivamente por `commands`; sem stub, o harness tenta
// abrir MySQL só pra emitir um ticket.
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('/database') || request === './database') {
    return { query: async () => [], init: () => {} };
  }
  return originalLoad.apply(this, arguments);
};
const voip = require(path.join(GAMEMODE, 'voip-service.js'));
const { VOICE_RANGES } = require(path.join(GAMEMODE, 'core', 'proximity-ranges.js'));
Module._load = originalLoad;

voip.startVoipServer(VOIP_PORT, '127.0.0.1');

function json(res, code, body) {
  const raw = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    // A página é servida daqui e conversa com o WebSocket noutra porta; sem isto
    // o fetch do /ticket feito pela própria página seria bloqueado.
    'Access-Control-Allow-Origin': '*'
  });
  res.end(raw);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${HTTP_PORT}`);
  const actorId = Number.parseInt(url.searchParams.get('actorId'), 0);

  if (url.pathname === '/ticket') {
    if (!Number.isFinite(actorId)) return json(res, 400, { error: 'actorId invalido' });
    // Ticket por papel: o mesmo jogador precisa de um pro helper (`sender`) e um
    // pra UI (`listener`), e um não serve no lugar do outro. Sem `role` a rota
    // devolve o de listener — que é o que a própria página busca ao carregar.
    const role = url.searchParams.get('role') || 'listener';
    if (!voip.VOIP_ROLES.includes(role)) {
      return json(res, 400, { error: `role invalido: ${role}` });
    }
    const ticket = voip.issueTicket(actorId, role);
    return json(res, 200, { actorId, ticket, role, host: '127.0.0.1', port: VOIP_PORT });
  }

  if (url.pathname === '/move') {
    if (!Number.isFinite(actorId)) return json(res, 400, { error: 'actorId invalido' });
    const pos = ['x', 'y', 'z'].map((k) => Number.parseFloat(url.searchParams.get(k) || '0'));
    positions.set(actorId, pos);
    voip.tickProximity(); // aplica agora em vez de esperar o ticker de 2s
    return json(res, 200, { actorId, pos });
  }

  if (url.pathname === '/state') {
    return json(res, 200, {
      ranges: VOICE_RANGES,
      positions: [...positions.entries()].map(([id, pos]) => ({
        actorId: id, hex: '0x' + id.toString(16), pos
      })),
      connected: voip.getConnectedVoipActors().map((id) => '0x' + id.toString(16)),
      audience: [...voip._audienceByActor.entries()].map(([id, list]) => ({
        speaker: '0x' + id.toString(16),
        listeners: list.map((l) => ({ actorId: '0x' + l.actorId.toString(16), volume: l.volume }))
      }))
    });
  }

  // Qualquer outra coisa: serve o diretório da UI.
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const file = path.resolve(UI_ROOT, rel);
  if (!file.startsWith(UI_ROOT)) { res.writeHead(403); return res.end('nope'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('nao encontrado'); }
    const ext = path.extname(file);
    const mime = ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.js' ? 'text/javascript; charset=utf-8'
        : ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`[harness] voip-service   ws://127.0.0.1:${VOIP_PORT}`);
  console.log(`[harness] UI + tickets   http://127.0.0.1:${HTTP_PORT}/`);
  console.log(`[harness] alcance normal ${VOICE_RANGES.normal} unidades`);
  console.log('[harness] ⚠️  emite ticket sem autenticacao — so em maquina local.');
});

process.on('SIGINT', () => {
  voip.stopVoipServer();
  server.close();
  process.exit(0);
});
