/**
 * core/interaction-service.test.js
 *
 * O pipeline inteiro, sem servidor. Cobre a matriz do
 * `docs/testing/INTERACTION_TEST_MATRIX.md`.
 *
 * A pergunta que quase todo caso aqui faz é a mesma: **o que acontece quando o
 * cliente mente?** Distância, dono, permissão, alvo, tipo de alvo e requestId
 * chegam todos da máquina de outra pessoa.
 *
 * Executa com: node --test core/interaction-service.test.js
 */

const assert = require('node:assert/strict');
const { describe, it, beforeEach } = require('node:test');

const registry = require('./interaction-registry');
const { createTargetResolvers } = require('./interaction-targets');
const { createInteractionService, STAGES } = require('./interaction-service');
const { TARGET_TYPES, AUDIT_LEVELS } = registry;

const ATOR = 0x100;
const ALVO = 0x200;

/** Silencia o log esperado dos casos de recusa sem esconder um erro real. */
const mudo = { log() {}, warn() {}, error() {} };

/**
 * Monta o serviço com o mundo todo mockado. Cada teste ajusta só o que precisa.
 */
function montar(overrides = {}) {
  const registrados = new Map([
    [ATOR, { characterId: 1, accountId: 11, name: 'Ator' }],
    [ALVO, { characterId: 2, accountId: 22, name: 'Alvo' }]
  ]);
  const auditoria = [];
  const notificacoes = [];
  const modais = [];

  const getCharacter = overrides.getCharacter || (actorId => registrados.get(actorId) || null);
  const targets = createTargetResolvers({ getCharacter, logger: mudo });

  const service = createInteractionService({
    registry,
    targets,
    getCharacter,
    checkPermission: overrides.checkPermission,
    actionPolicy: overrides.actionPolicy,
    rateLimiter: overrides.rateLimiter,
    audit: entrada => { auditoria.push(entrada); },
    notify: (actorId, message) => notificacoes.push({ actorId, message }),
    sendModal: (actorId, type, data) => modais.push({ actorId, type, data }),
    now: overrides.now,
    logger: mudo
  });

  return { service, targets, registrados, auditoria, notificacoes, modais };
}

function registrar(overrides = {}) {
  const executadas = [];
  registry.register({
    id: 'test.acao',
    module: 'test',
    target: TARGET_TYPES.PLAYER,
    label: 'Ação',
    execute: async ctx => { executadas.push(ctx); },
    ...overrides
  });
  return executadas;
}

describe('interaction-service — envelope e ação desconhecida', () => {
  beforeEach(() => registry._reset());

  it('recusa pedido que não é objeto', async () => {
    const { service } = montar();
    for (const pedido of [null, undefined, 'texto', 42]) {
      const r = await service.execute(ATOR, pedido);
      assert.equal(r.ok, false);
      assert.equal(r.stage, STAGES.ENVELOPE);
    }
  });

  // Dizer "essa ação não existe" transformaria o menu num oráculo de
  // enumeração: dá para varrer o servidor inteiro comparando mensagens.
  it('ação desconhecida e ação indisponível dão a MESMA resposta', async () => {
    registrar({ id: 'test.existe', canSee: () => false });
    const { service } = montar();

    const inexistente = await service.execute(ATOR, { action: 'test.inventada', targetId: ALVO });
    const indisponivel = await service.execute(ATOR, { action: 'test.existe', targetId: ALVO });

    assert.equal(inexistente.reason, indisponivel.reason);
    assert.equal(inexistente.stage, STAGES.UNKNOWN_ACTION);
    assert.equal(indisponivel.stage, STAGES.CAN_SEE);
  });

  it('recusa action que não é string', async () => {
    const { service } = montar();
    for (const action of [null, 42, {}, ['test.acao']]) {
      const r = await service.execute(ATOR, { action, targetId: ALVO });
      assert.equal(r.ok, false);
      assert.equal(r.stage, STAGES.UNKNOWN_ACTION);
    }
  });

  // O tipo de alvo vem do DESCRITOR, nunca do pedido. Aceitá-lo do cliente
  // permitiria chamar uma ação de `player` declarando o alvo como `container` e
  // cair num resolvedor que não faz as recusas daquela ação.
  it('ignora targetType enviado pelo cliente no execute', async () => {
    const executadas = registrar();
    const { service } = montar();

    const r = await service.execute(ATOR, {
      action: 'test.acao',
      targetId: ALVO,
      targetType: TARGET_TYPES.CONTAINER // mentira do cliente
    });

    assert.equal(r.ok, true);
    assert.equal(executadas[0].target.type, TARGET_TYPES.PLAYER);
  });
});

describe('interaction-service — alvo', () => {
  beforeEach(() => registry._reset());

  it('recusa alvo inexistente, mal formado e sem personagem carregado', async () => {
    registrar();
    const { service } = montar();

    for (const targetId of [undefined, null, 'abacaxi', '0xZZ', -1, 0, 0x999]) {
      const r = await service.execute(ATOR, { action: 'test.acao', targetId });
      assert.equal(r.ok, false, `aceitou alvo ${JSON.stringify(targetId)}`);
      assert.equal(r.stage, STAGES.TARGET);
    }
  });

  // Número é decimal; string é SEMPRE hexadecimal, com ou sem `0x`. Não é
  // arbitrário: é o que o `parseActorId` da governança sempre fez, e é o que o
  // menu manda (`formatActorId` emite `0x...`). A consequência a lembrar é que
  // `"512"` não é 512 — é 0x512. Mudar isso quebraria o menu atual.
  it('número é decimal e string é hexadecimal, com ou sem 0x', async () => {
    const executadas = registrar();
    const { service } = montar();

    for (const targetId of [ALVO, '0x200', '200', '0X200']) {
      const r = await service.execute(ATOR, { action: 'test.acao', targetId });
      assert.equal(r.ok, true, `recusou ${JSON.stringify(targetId)}`);
    }
    assert.equal(executadas.length, 4);
    assert.ok(executadas.every(ctx => ctx.target.actorId === ALVO));

    // `String(0x200)` é `"512"`, que como hex é 0x512 — outro ator, e ele não
    // existe. Recusa limpa, e não um alvo errado.
    const r = await service.execute(ATOR, { action: 'test.acao', targetId: String(ALVO) });
    assert.equal(r.ok, false);
    assert.equal(r.stage, STAGES.TARGET);
  });

  it('ninguém é alvo de si mesmo por este caminho', async () => {
    registrar();
    const { service } = montar();
    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ATOR });
    assert.equal(r.ok, false);
    assert.equal(r.stage, STAGES.TARGET);
  });

  // Um tipo sem resolvedor falha fechado e por nome, nunca com `undefined`
  // seguindo pipeline abaixo.
  it('tipo de alvo sem resolvedor falha fechado', async () => {
    registrar({ id: 'test.porta', target: TARGET_TYPES.DOOR });
    const { service } = montar();

    const r = await service.execute(ATOR, { action: 'test.porta', targetId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.stage, STAGES.TARGET);
    assert.match(r.reason, /nao suportado/);
  });

  it('resolvedor registrado por um módulo passa a funcionar sem tocar o core', async () => {
    const executadas = registrar({ id: 'test.bau', target: TARGET_TYPES.CONTAINER });
    const { service, targets } = montar();

    targets.registerResolver(TARGET_TYPES.CONTAINER, rawId => (
      rawId === 'bau-7' ? { type: TARGET_TYPES.CONTAINER, id: 'container:7', label: 'Baú' } : null
    ));

    assert.equal((await service.execute(ATOR, { action: 'test.bau', targetId: 'bau-7' })).ok, true);
    assert.equal((await service.execute(ATOR, { action: 'test.bau', targetId: 'bau-8' })).ok, false);
    assert.equal(executadas[0].target.id, 'container:7');
  });

  // Desconexão entre a consulta e o clique: o alvo sai, `getCharacter` para de
  // responder por ele, e o alvo deixa de resolver. Nada de especial precisa ser
  // escrito para isso — é consequência de o `execute` refazer o pipeline.
  it('alvo que desconecta entre a consulta e a execução recusa no execute', async () => {
    registrar();
    const { service, registrados } = montar();

    const antes = await service.query(ATOR, { targetType: TARGET_TYPES.PLAYER, targetId: ALVO });
    assert.equal(antes.sections[0].actions.length, 1);

    registrados.delete(ALVO); // o alvo saiu

    const depois = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(depois.ok, false);
    assert.equal(depois.stage, STAGES.TARGET);
  });

  it('ator que desconecta recusa antes de qualquer coisa', async () => {
    registrar();
    const { service, registrados } = montar();
    registrados.delete(ATOR);

    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(r.ok, false);
    assert.equal(r.stage, STAGES.TARGET);
    assert.match(r.reason, /Personagem nao carregado/);
  });
});

describe('interaction-service — permissão, política e distância', () => {
  beforeEach(() => registry._reset());

  it('nega quando a permissão é negada, e passa o alvo ao verificador', async () => {
    registrar({ permission: 'guard.search' });
    const consultas = [];
    const { service } = montar({
      checkPermission: async (actorId, permission, ctx) => {
        consultas.push({ actorId, permission, alvo: ctx.target.actorId, acao: ctx.interactionId });
        return { allowed: false, reason: 'Voce nao e da guarda.' };
      }
    });

    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(r.ok, false);
    assert.equal(r.stage, STAGES.PERMISSION);
    assert.equal(r.reason, 'Voce nao e da guarda.');
    assert.deepEqual(consultas, [{ actorId: ATOR, permission: 'guard.search', alvo: ALVO, acao: 'test.acao' }]);
  });

  // Uma interação que exige permissão num servidor sem verificador injetado não
  // pode virar "todo mundo pode".
  it('sem checkPermission injetado, uma ação com permissão NEGA', async () => {
    registrar({ permission: 'guard.search' });
    const { service } = montar({ checkPermission: undefined });

    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(r.ok, false);
    assert.equal(r.stage, STAGES.PERMISSION);
  });

  it('a política de ação recebe ator e alvo, e sua recusa vira a resposta', async () => {
    registrar({ policyAction: 'trade' });
    const chamadas = [];
    const { service } = montar({
      actionPolicy: {
        canPerform(characterId, actionId, context) {
          chamadas.push({ characterId, actionId, context });
          return { allowed: false, reason: 'Voce esta algemado e nao pode realizar essa acao.' };
        }
      }
    });

    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(r.stage, STAGES.POLICY);
    assert.equal(r.reason, 'Voce esta algemado e nao pode realizar essa acao.');
    // `targetActorId` é o que liga a regra dos dois lados das zonas seguras.
    assert.deepEqual(chamadas[0], {
      characterId: 1,
      actionId: 'trade',
      context: { actorId: ATOR, targetActorId: ALVO }
    });
  });

  it('permissão é checada ANTES da política — a resposta útil vem primeiro', async () => {
    registrar({ permission: 'guard.search', policyAction: 'trade' });
    let politicaChamada = false;
    const { service } = montar({
      checkPermission: async () => ({ allowed: false, reason: 'Voce nao e da guarda.' }),
      actionPolicy: { canPerform: () => { politicaChamada = true; return { allowed: false, reason: 'x' }; } }
    });

    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(r.stage, STAGES.PERMISSION);
    assert.equal(politicaChamada, false);
  });

  it('distância fora do alcance recusa, e a medida vem do servidor', async () => {
    registrar({ distance: 200 });
    const { service, targets } = montar();

    // Sobrescreve o resolvedor de player para controlar a distância no teste,
    // do mesmo jeito que `rangeUtils` faria com `mp` presente.
    const originais = targets.resolve;
    let longe = true;
    targets.resolve = (tipo, raw, actorId) => {
      const r = originais(tipo, raw, actorId);
      if (r.ok) {
        r.target.assertRange = (_from, max) => (longe
          ? { ok: false, reason: 'Alvo fora de alcance.' }
          : { ok: true });
      }
      return r;
    };

    const recusa = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(recusa.stage, STAGES.DISTANCE);
    assert.equal(recusa.reason, 'Alvo fora de alcance.');

    longe = false;
    assert.equal((await service.execute(ATOR, { action: 'test.acao', targetId: ALVO })).ok, true);
  });

  // Sem `mp`, `rangeUtils.assertRange` deixa passar — e precisa deixar, senão
  // nada disto seria testável. O que não pode é a auditoria dizer que mediu.
  it('marca a distância como NÃO verificada quando não havia como medir', async () => {
    const executadas = registrar({ distance: 200, audit: AUDIT_LEVELS.SECURITY });
    const { service, auditoria } = montar();

    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(r.ok, true);
    assert.equal(executadas[0].distanceVerified, false);
    assert.equal(executadas[0].distanceUnverified, true);
    assert.equal(auditoria[0].distanceVerified, false);
  });

  it('sem distance declarada, nenhuma checagem acontece', async () => {
    const executadas = registrar();
    const { service } = montar();
    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(executadas[0].distanceVerified, false);
    assert.equal(executadas[0].distanceUnverified, false);
  });
});

describe('interaction-service — canSee e canExecute', () => {
  beforeEach(() => registry._reset());

  // A regra central do §11: `canSee` decide um menu montado num instante
  // anterior, na máquina de outra pessoa. `execute` roda os DOIS de novo.
  it('execute roda canSee E canExecute, nesta ordem', async () => {
    const ordem = [];
    registrar({
      canSee: () => { ordem.push('canSee'); return true; },
      canExecute: () => { ordem.push('canExecute'); return true; },
      execute: async () => { ordem.push('execute'); }
    });
    const { service } = montar();

    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.deepEqual(ordem, ['canSee', 'canExecute', 'execute']);
  });

  it('uma ação vista antes não vale nada se canSee mudar de ideia', async () => {
    let ehGuarda = true;
    const executadas = registrar({ canSee: () => ehGuarda });
    const { service } = montar();

    const menu = await service.query(ATOR, { targetType: TARGET_TYPES.PLAYER, targetId: ALVO });
    assert.equal(menu.sections[0].actions[0].action, 'test.acao');

    ehGuarda = false; // perdeu o cargo entre o menu e o clique

    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(r.ok, false);
    assert.equal(r.stage, STAGES.CAN_SEE);
    assert.equal(executadas.length, 0);
  });

  it('canExecute nega o que canSee mostrou', async () => {
    const executadas = registrar({
      canSee: () => true,
      canExecute: () => ({ allowed: false, reason: 'O alvo ja esta preso.' })
    });
    const { service } = montar();

    const menu = await service.query(ATOR, { targetType: TARGET_TYPES.PLAYER, targetId: ALVO });
    assert.equal(menu.sections[0].actions.length, 1, 'aparece no menu');

    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(r.stage, STAGES.CAN_EXECUTE);
    assert.equal(r.reason, 'O alvo ja esta preso.');
    assert.equal(executadas.length, 0);
  });

  it('canExecute NÃO é consultado na montagem do menu', async () => {
    let chamou = false;
    registrar({ canExecute: () => { chamou = true; return true; } });
    const { service } = montar();

    await service.query(ATOR, { targetType: TARGET_TYPES.PLAYER, targetId: ALVO });
    assert.equal(chamou, false);
  });

  // Um módulo com bug não pode abrir o menu de ninguém.
  it('guarda que lança vira NEGA, não vira passa', async () => {
    const executadas = registrar({ canSee: () => { throw new Error('bug do módulo'); } });
    const { service } = montar();

    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(r.ok, false);
    assert.equal(r.stage, STAGES.CAN_SEE);
    assert.equal(executadas.length, 0);

    const menu = await service.query(ATOR, { targetType: TARGET_TYPES.PLAYER, targetId: ALVO });
    assert.deepEqual(menu.sections, []);
  });

  it('aceita os três formatos de veredicto que um módulo escreve naturalmente', async () => {
    registrar({ id: 'test.bool', canSee: () => true });
    registrar({ id: 'test.obj', canSee: () => ({ allowed: true }) });
    registrar({ id: 'test.nada', canSee: () => undefined });
    const { service } = montar();

    assert.equal((await service.execute(ATOR, { action: 'test.bool', targetId: ALVO })).ok, true);
    assert.equal((await service.execute(ATOR, { action: 'test.obj', targetId: ALVO })).ok, true);
    assert.equal((await service.execute(ATOR, { action: 'test.nada', targetId: ALVO })).ok, false,
      'retorno vazio é NEGA — quem não decidiu não autorizou');
  });
});

describe('interaction-service — query', () => {
  beforeEach(() => registry._reset());

  it('agrupa por seção e só devolve o que o cliente precisa desenhar', async () => {
    registrar({ id: 'law.search', module: 'gov', section: 'guarda', label: 'Revistar',
      permission: 'p', schema: { reason: { type: 'string', label: 'Motivo' } } });
    registrar({ id: 'law.fine', module: 'gov', section: 'guarda', label: 'Multar' });
    registrar({ id: 'social.apresentar', module: 'identity', section: 'social', label: 'Apresentar-se' });

    const { service } = montar({ checkPermission: async () => ({ allowed: true }) });
    const menu = await service.query(ATOR, { targetType: TARGET_TYPES.PLAYER, targetId: ALVO });

    assert.deepEqual(menu.sections.map(s => s.id).sort(), ['guarda', 'social']);
    const guarda = menu.sections.find(s => s.id === 'guarda');
    assert.deepEqual(guarda.actions.map(a => a.action).sort(), ['law.fine', 'law.search']);

    const revistar = guarda.actions.find(a => a.action === 'law.search');
    assert.deepEqual(revistar.fields, [{ name: 'reason', type: 'string', label: 'Motivo', required: false }]);
    // A permissão que liberou a ação não vai para a tela.
    assert.equal('permission' in revistar, false);
    assert.equal('distance' in revistar, false);
  });

  it('cada interação é avaliada com o próprio contexto — alcances diferentes não se contaminam', async () => {
    registrar({ id: 'test.perto', distance: 100 });
    registrar({ id: 'test.longe', distance: 3000 });

    const { service, targets } = montar();
    const original = targets.resolve;
    targets.resolve = (tipo, raw, actorId) => {
      const r = original(tipo, raw, actorId);
      if (r.ok) r.target.assertRange = (_f, max) => (max >= 3000 ? { ok: true } : { ok: false, reason: 'Alvo fora de alcance.' });
      return r;
    };

    const menu = await service.query(ATOR, { targetType: TARGET_TYPES.PLAYER, targetId: ALVO });
    const acoes = menu.sections.flatMap(s => s.actions.map(a => a.action));
    assert.deepEqual(acoes, ['test.longe'], 'a de alcance curto não aparece só porque a outra coube');
  });

  it('alvo inválido devolve menu vazio, não erro cru', async () => {
    registrar();
    const { service } = montar();
    const menu = await service.query(ATOR, { targetType: TARGET_TYPES.PLAYER, targetId: 0x999 });
    assert.equal(menu.ok, true);
    assert.deepEqual(menu.sections, []);
    assert.equal(menu.target, null);
  });

  it('tipo de alvo sem nenhuma interação registrada devolve vazio', async () => {
    registrar();
    const { service } = montar();
    const menu = await service.query(ATOR, { targetType: TARGET_TYPES.DOOR, targetId: 1 });
    assert.equal(menu.ok, true);
    assert.deepEqual(menu.sections, []);
  });

  it('recusa query sem targetType', async () => {
    const { service } = montar();
    const r = await service.query(ATOR, { targetId: ALVO });
    assert.equal(r.ok, false);
    assert.equal(r.stage, STAGES.ENVELOPE);
  });
});

describe('interaction-service — requestId, duplicata e replay', () => {
  beforeEach(() => registry._reset());

  const REQ = 'req-1234-abcd';

  it('duplo clique cobra UMA vez e devolve o mesmo resultado', async () => {
    let vezes = 0;
    registrar({ idempotent: true, execute: async () => { vezes++; return { message: 'Multa aplicada.' }; } });
    const { service } = montar();

    const primeira = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: REQ });
    const segunda = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: REQ });

    assert.equal(vezes, 1, 'executou duas vezes — este é o bug que o §19 existe para impedir');
    assert.equal(primeira.ok, true);
    assert.equal(segunda.ok, true);
    assert.equal(segunda.message, 'Multa aplicada.');
    assert.equal(segunda.duplicate, true);
  });

  it('duas chamadas concorrentes com o mesmo requestId: uma executa, a outra é recusada', async () => {
    let vezes = 0;
    let liberar;
    const bloqueio = new Promise(resolve => { liberar = resolve; });
    registrar({ idempotent: true, execute: async () => { vezes++; await bloqueio; } });
    const { service } = montar();

    const a = service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: REQ });
    const b = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: REQ });

    assert.equal(b.ok, false);
    assert.equal(b.stage, STAGES.DUPLICATE);
    liberar();
    assert.equal((await a).ok, true);
    assert.equal(vezes, 1);
  });

  it('requestId diferente executa de novo — não é um bloqueio de ação', async () => {
    let vezes = 0;
    registrar({ idempotent: true, execute: async () => { vezes++; } });
    const { service } = montar();

    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: 'req-aaaa-1111' });
    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: 'req-bbbb-2222' });
    assert.equal(vezes, 2);
  });

  it('o mesmo requestId de OUTRO jogador não colide', async () => {
    let vezes = 0;
    registrar({ idempotent: true, execute: async () => { vezes++; } });
    const { service } = montar();

    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: REQ });
    await service.execute(ALVO, { action: 'test.acao', targetId: ATOR, requestId: REQ });
    assert.equal(vezes, 2);
  });

  it('ação idempotente exige requestId com formato mínimo', async () => {
    registrar({ idempotent: true });
    const { service } = montar();

    for (const requestId of [undefined, '', 'curto', 'x'.repeat(49), 42, {}]) {
      const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId });
      assert.equal(r.ok, false, `aceitou requestId ${JSON.stringify(requestId)}`);
      assert.equal(r.stage, STAGES.DUPLICATE);
    }
  });

  // Um pedido que ia ser recusado não pode consumir o requestId: o retry
  // legítimo, já corrigido, seria recusado como duplicata.
  it('recusa antes do execute NÃO consome o requestId', async () => {
    let vezes = 0;
    let temPermissao = false;
    registrar({ idempotent: true, permission: 'p', execute: async () => { vezes++; } });
    const { service } = montar({ checkPermission: async () => ({ allowed: temPermissao, reason: 'nao' }) });

    const recusa = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: REQ });
    assert.equal(recusa.stage, STAGES.PERMISSION);

    temPermissao = true;
    const depois = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: REQ });
    assert.equal(depois.ok, true, 'o mesmo requestId foi recusado como duplicata sem nunca ter executado');
    assert.equal(vezes, 1);
  });

  it('execute que lança libera o requestId para o retry', async () => {
    let vezes = 0;
    registrar({ idempotent: true, execute: async () => { vezes++; if (vezes === 1) throw new Error('banco caiu'); } });
    const { service } = montar();

    const falha = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: REQ });
    assert.equal(falha.ok, false);
    assert.equal(falha.stage, STAGES.EXECUTE);

    const retry = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: REQ });
    assert.equal(retry.ok, true);
    assert.equal(vezes, 2);
  });

  it('ação não idempotente ignora requestId por completo', async () => {
    let vezes = 0;
    registrar({ idempotent: false, execute: async () => { vezes++; } });
    const { service } = montar();

    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: REQ });
    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: REQ });
    assert.equal(vezes, 2);
  });

  it('a memória de deduplicação expira e não cresce para sempre', async () => {
    let agora = 0;
    registrar({ idempotent: true });
    const { service } = montar({ now: () => agora });

    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: REQ });
    assert.equal(service.snapshot().pendingRequests, 1);

    agora += service.snapshot().dedupTtlMs;
    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, requestId: 'req-outro-9999' });
    assert.equal(service.snapshot().pendingRequests, 1, 'a entrada velha foi varrida');
  });
});

describe('interaction-service — rate limit', () => {
  beforeEach(() => registry._reset());

  it('separa a política de query da de execute', async () => {
    registrar();
    const vistos = [];
    const { service } = montar({
      rateLimiter: {
        observe(actorId, type) {
          vistos.push(type);
          return { allowed: type !== 'interaction:execute' };
        }
      }
    });

    const menu = await service.query(ATOR, { targetType: TARGET_TYPES.PLAYER, targetId: ALVO });
    assert.equal(menu.ok, true);

    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(r.ok, false);
    assert.equal(r.stage, STAGES.RATE_LIMIT);
    assert.deepEqual(vistos, ['interaction:query', 'interaction:execute']);
  });

  // O ponto do rate limit é não pagar o resto do pipeline.
  it('o limite corta ANTES de resolver alvo, permissão ou canSee', async () => {
    let tocou = false;
    registrar({ permission: 'p', canSee: () => { tocou = true; return true; } });
    const { service } = montar({
      rateLimiter: { observe: () => ({ allowed: false }) },
      checkPermission: async () => { tocou = true; return { allowed: true }; }
    });

    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    await service.query(ATOR, { targetType: TARGET_TYPES.PLAYER, targetId: ALVO });
    assert.equal(tocou, false);
  });
});

describe('interaction-service — auditoria', () => {
  beforeEach(() => registry._reset());

  it('TRACE não grava; os outros níveis gravam', async () => {
    registrar({ id: 'test.olhar', audit: AUDIT_LEVELS.TRACE });
    registrar({ id: 'test.multar', audit: AUDIT_LEVELS.ECONOMY });
    const { service, auditoria } = montar();

    await service.execute(ATOR, { action: 'test.olhar', targetId: ALVO });
    assert.equal(auditoria.length, 0);

    await service.execute(ATOR, { action: 'test.multar', targetId: ALVO });
    assert.equal(auditoria.length, 1);
    assert.equal(auditoria[0].level, AUDIT_LEVELS.ECONOMY);
    assert.equal(auditoria[0].interactionId, 'test.multar');
    assert.equal(auditoria[0].actorId, ATOR);
    assert.equal(auditoria[0].accountId, 11);
    assert.equal(auditoria[0].target.accountId, 22);
    assert.equal(auditoria[0].outcome, 'ok');
  });

  it('grava a falha do execute com o motivo', async () => {
    registrar({ audit: AUDIT_LEVELS.SECURITY, execute: async () => { throw new Error('estoque insuficiente'); } });
    const { service, auditoria } = montar();

    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(auditoria[0].outcome, 'error');
    assert.equal(auditoria[0].detail, 'estoque insuficiente');
  });

  // Auditoria que falha não desfaz o que já aconteceu.
  it('auditoria que lança não derruba a ação já executada', async () => {
    let executou = false;
    registrar({ execute: async () => { executou = true; } });
    const { service: _ignorado } = montar();

    const targets = createTargetResolvers({
      getCharacter: id => (id === ATOR ? { characterId: 1 } : id === ALVO ? { characterId: 2 } : null),
      logger: mudo
    });
    const service = createInteractionService({
      registry, targets,
      getCharacter: id => (id === ATOR ? { characterId: 1 } : id === ALVO ? { characterId: 2 } : null),
      audit: () => { throw new Error('banco de auditoria fora'); },
      logger: mudo
    });

    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(r.ok, true);
    assert.equal(executou, true);
  });

  // Recusa não gera linha: um jogador clicando num botão que ele não pode usar
  // não pode encher a tabela que a staff usa para arbitrar.
  it('recusa de permissão não gera linha de auditoria', async () => {
    registrar({ permission: 'p', audit: AUDIT_LEVELS.SECURITY });
    const { service, auditoria } = montar({ checkPermission: async () => ({ allowed: false, reason: 'nao' }) });

    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO });
    assert.equal(auditoria.length, 0);
  });
});

describe('interaction-service — ponte com a UI', () => {
  beforeEach(() => registry._reset());

  it('só reconhece interaction:query e interaction:execute', async () => {
    const { service } = montar();
    assert.equal(await service.handleUiEvent(ATOR, { type: 'panel:open' }), false);
    assert.equal(await service.handleUiEvent(ATOR, { type: 'governance:interaction:actions' }), false);
    assert.equal(await service.handleUiEvent(ATOR, null), false);
    assert.equal(await service.handleUiEvent(ATOR, { type: 'interaction:query', data: {} }), true);
  });

  it('query responde pelo modal, e o menu NÃO vai para o chat', async () => {
    registrar({ label: 'Revistar' });
    const { service, modais, notificacoes } = montar();

    await service.handleUiEvent(ATOR, {
      type: 'interaction:query',
      data: { targetType: TARGET_TYPES.PLAYER, targetId: ALVO }
    });

    assert.equal(modais.length, 1);
    assert.equal(modais[0].type, 'interaction:actions');
    assert.equal(modais[0].data.sections[0].actions[0].label, 'Revistar');
    assert.deepEqual(notificacoes, [], 'a versão anterior despejava o JSON das ações no chat-log');
  });

  it('execute responde por notificação e recusa vira mensagem', async () => {
    registrar({ execute: async () => ({ message: 'Multa de 150 septims aplicada.' }) });
    const { service, notificacoes } = montar();

    await service.handleUiEvent(ATOR, {
      type: 'interaction:execute',
      data: { action: 'test.acao', targetId: ALVO }
    });
    assert.equal(notificacoes[0].message, 'Multa de 150 septims aplicada.');

    await service.handleUiEvent(ATOR, {
      type: 'interaction:execute',
      data: { action: 'test.acao', targetId: 0x999 }
    });
    assert.equal(notificacoes[1].message, 'Alvo invalido.');
  });

  it('data que não é objeto não derruba a ponte', async () => {
    const { service } = montar();
    for (const data of ['texto', 42, [], null]) {
      assert.equal(await service.handleUiEvent(ATOR, { type: 'interaction:execute', data }), true);
    }
  });
});

describe('interaction-service — contexto entregue ao módulo', () => {
  beforeEach(() => registry._reset());

  it('entrega o contexto do §12, com o payload já saneado', async () => {
    const executadas = registrar({
      idempotent: true,
      schema: { reason: { type: 'string' }, amount: { type: 'int', min: 1 } }
    });
    const { service } = montar();

    await service.execute(ATOR, {
      action: 'test.acao',
      targetId: ALVO,
      requestId: 'req-1234-abcd',
      data: { reason: '  desordem  ', amount: '150', gold: 999999 }
    });

    const ctx = executadas[0];
    assert.equal(ctx.actorId, ATOR);
    assert.equal(ctx.characterId, 1);
    assert.equal(ctx.accountId, 11);
    assert.equal(ctx.target.actorId, ALVO);
    assert.equal(ctx.target.characterId, 2);
    assert.equal(ctx.interactionId, 'test.acao');
    assert.equal(ctx.requestId, 'req-1234-abcd');
    assert.deepEqual(ctx.data, { reason: 'desordem', amount: 150 });
    assert.equal('gold' in ctx.data, false, 'campo não declarado atravessou o schema');
  });

  it('aceita o payload no nível de cima quando não há data (formato antigo da CEF)', async () => {
    const executadas = registrar({ schema: { reason: { type: 'string' } } });
    const { service } = montar();

    await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, reason: 'furto' });
    assert.equal(executadas[0].data.reason, 'furto');
  });

  it('payload que falha no schema recusa antes de qualquer execução', async () => {
    const executadas = registrar({ schema: { amount: { type: 'int', min: 1, required: true } } });
    const { service } = montar();

    const r = await service.execute(ATOR, { action: 'test.acao', targetId: ALVO, data: { amount: '-5' } });
    assert.equal(r.ok, false);
    assert.equal(r.stage, STAGES.SCHEMA);
    assert.equal(executadas.length, 0);
  });
});
