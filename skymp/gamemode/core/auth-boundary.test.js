const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('auth boundary — staging e runtime versionado nunca usam offlineMode', () => {
  const staging = JSON.parse(read('skymp/config/server-settings.staging.example.json'));
  const runtime = JSON.parse(read('skymp/server/server-settings.json'));

  assert.equal(staging.offlineMode, false);
  assert.equal(runtime.offlineMode, false);
  assert.equal(typeof staging.master, 'string');
  assert.ok(staging.master.length > 0);
});

test('auth boundary — Master API resolve a sessão para accountId', () => {
  const web = read('apps/web/server.js');

  assert.match(web, /SELECT id, account_id, discord_id FROM game_sessions/);
  assert.match(web, /user:\s*\{\s*id:\s*rows\[0\]\.account_id/);
  assert.doesNotMatch(web, /user:\s*\{\s*id:\s*rows\[0\]\.discord_id/);
});

test('auth boundary — sessão inválida não possui fallback para identidade do cliente', () => {
  const web = read('apps/web/server.js');
  const sessionRouteStart = web.indexOf("app.get('/api/servers/:masterKey/sessions/:session'");
  const launcherSection = web.indexOf('// ── API: Launcher', sessionRouteStart);

  assert.ok(sessionRouteStart >= 0, 'rota Master API não encontrada');
  assert.ok(launcherSection > sessionRouteStart, 'fim da rota Master API não encontrado');
  const route = web.slice(sessionRouteStart, launcherSection);

  assert.match(route, /rows\.length === 0\) return res\.status\(404\)/);
  assert.doesNotMatch(route, /req\.(body|query).*profileId/);
});

test('auth boundary — launcher online injeta sessão opaca e remove profileId da config principal', () => {
  const launcher = read('apps/launcher/electron/main.ts');

  assert.match(launcher, /config\.session\s*=\s*`ticket:\$\{ticket \|\| ''\}`/);
  assert.match(launcher, /delete config\.profileId/);
});

test('auth boundary — documenta o profileId legado ainda escrito no client settings', () => {
  // Caracterização deliberada do blocker AUTH-01. Este teste deve ser invertido
  // em AUTH-003 quando o fluxo online deixar de escrever a identidade legada.
  const launcher = read('apps/launcher/electron/main.ts');

  assert.match(launcher, /clientSettings\.gameData\.profileId\s*=/);
  assert.match(launcher, /clientSettings\.gameData\.launcherTicket\s*=/);
});

test('auth boundary — consumo do launch ticket é um UPDATE condicional atômico', () => {
  const gameApi = read('apps/game-api/server.js');
  const start = gameApi.indexOf('async function consumeLaunchTicket');
  const end = gameApi.indexOf('async function isEligible', start);
  assert.ok(start >= 0 && end > start, 'consumeLaunchTicket não encontrado');
  const implementation = gameApi.slice(start, end);

  assert.match(implementation, /UPDATE launch_tickets SET consumed_at = NOW\(\)/);
  assert.match(implementation, /consumed_at IS NULL AND expires_at > NOW\(\)/);
  assert.match(implementation, /result\.affectedRows !== 1/);
  assert.doesNotMatch(implementation, /SELECT[\s\S]+consumed_at[\s\S]+UPDATE launch_tickets/);
});
