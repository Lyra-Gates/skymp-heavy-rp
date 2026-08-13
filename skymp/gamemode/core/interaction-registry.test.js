/**
 * core/interaction-registry.test.js
 *
 * O registro é puro: nada aqui precisa de `mp`, de banco ou de servidor. É de
 * propósito — a parte do framework que dá para provar fora do jogo fica onde dá
 * para provar, pelo mesmo motivo que `core/soul.js` é função pura.
 *
 * Executa com: node --test core/interaction-registry.test.js
 */

const assert = require('node:assert/strict');
const { describe, it, beforeEach } = require('node:test');

const registry = require('./interaction-registry');
const { TARGET_TYPES, AUDIT_LEVELS } = registry;

/** Descritor mínimo válido, para os testes só mudarem o que estão testando. */
function descriptor(overrides = {}) {
  return {
    id: 'test.action',
    module: 'test',
    target: TARGET_TYPES.PLAYER,
    label: 'Ação de teste',
    execute: async () => {},
    ...overrides
  };
}

describe('interaction-registry — registro', () => {
  beforeEach(() => registry._reset());

  it('registra e devolve pelo id', () => {
    registry.register(descriptor());
    const entry = registry.get('test.action');
    assert.equal(entry.id, 'test.action');
    assert.equal(entry.module, 'test');
    assert.equal(entry.audit, AUDIT_LEVELS.GAMEPLAY, 'o padrão de auditoria é gravar');
    assert.equal(entry.idempotent, false);
  });

  // Duplicata é erro, e não aviso como no command-registry. Um comando de chat
  // sobrescrito dá resposta na hora para quem digitou; uma ação sobrescrita
  // continua no menu com o MESMO rótulo, executando o código de outro módulo.
  it('recusa id duplicado, nomeando o dono anterior', () => {
    registry.register(descriptor({ module: 'primeiro' }));
    assert.throws(
      () => registry.register(descriptor({ module: 'segundo' })),
      /ja registrado pelo modulo 'primeiro'/
    );
    assert.equal(registry.get('test.action').module, 'primeiro', 'o primeiro sobrevive');
  });

  it('recusa id fora do formato <modulo>.<acao>', () => {
    for (const id of ['semponto', 'Maiuscula.acao', 'modulo.', '.acao', 'a.b.c', 'guard search', '']) {
      assert.throws(() => registry.register(descriptor({ id })), /id invalido/, `aceitou '${id}'`);
    }
  });

  // A regex antiga da governança era /^(guard|stall|npc)\.[a-z_]+$/ — três
  // namespaces fixos no core. Tudo do §14 do pedido morria nela.
  it('aceita namespaces que a regex antiga da governança recusava', () => {
    for (const id of ['identity.introduce', 'medical.help', 'carry.request', 'law.search']) {
      registry.register(descriptor({ id }));
      assert.ok(registry.get(id), `recusou '${id}'`);
    }
  });

  it('recusa target desconhecido e aceita os sete do vocabulário', () => {
    assert.throws(() => registry.register(descriptor({ target: 'dragao' })), /desconhecido/);
    for (const [i, target] of Object.values(TARGET_TYPES).entries()) {
      registry.register(descriptor({ id: `test.a${i}`, target }));
    }
    assert.equal(registry.list().length, 7);
  });

  it('recusa descritor sem execute, sem module ou com guardas que não são função', () => {
    assert.throws(() => registry.register(descriptor({ execute: undefined })), /sem funcao execute/);
    assert.throws(() => registry.register(descriptor({ module: undefined })), /sem 'module'/);
    assert.throws(() => registry.register(descriptor({ canSee: 'sim' })), /canSee deve ser funcao/);
    assert.throws(() => registry.register(descriptor({ canExecute: 42 })), /canExecute deve ser funcao/);
  });

  it('recusa distance não positiva e audit desconhecido', () => {
    assert.throws(() => registry.register(descriptor({ distance: 0 })), /distance/);
    assert.throws(() => registry.register(descriptor({ distance: -1 })), /distance/);
    assert.throws(() => registry.register(descriptor({ audit: 'DEBUG' })), /audit 'DEBUG' desconhecido/);
  });

  // Schema errado é bug de quem programa. O lugar de descobri-lo é o boot, e
  // não a tela de um jogador tentando pagar uma multa.
  it('recusa schema malformado no REGISTRO, não no primeiro clique', () => {
    assert.throws(
      () => registry.register(descriptor({ schema: { valor: { type: 'money' } } })),
      /tipo 'money'/
    );
    assert.throws(
      () => registry.register(descriptor({ schema: { tipo: { type: 'enum' } } })),
      /enum 'tipo' sem 'values'/
    );
    assert.throws(() => registry.register(descriptor({ schema: [] })), /schema deve ser um objeto/);
  });
});

describe('interaction-registry — consulta e limpeza', () => {
  beforeEach(() => registry._reset());

  it('listForTarget filtra por tipo e ordena por order, depois por id', () => {
    registry.register(descriptor({ id: 'z.tarde', order: 10 }));
    registry.register(descriptor({ id: 'a.cedo', order: 1 }));
    registry.register(descriptor({ id: 'b.empate', order: 10 }));
    registry.register(descriptor({ id: 'porta.abrir', target: TARGET_TYPES.DOOR }));

    const doPlayer = registry.listForTarget(TARGET_TYPES.PLAYER).map(e => e.id);
    assert.deepEqual(doPlayer, ['a.cedo', 'b.empate', 'z.tarde']);
    assert.deepEqual(registry.listForTarget(TARGET_TYPES.DOOR).map(e => e.id), ['porta.abrir']);
    assert.deepEqual(registry.listForTarget(TARGET_TYPES.CONTAINER), []);
  });

  it('section usa o módulo como padrão e respeita o explícito', () => {
    registry.register(descriptor({ id: 'law.search', module: 'governance' }));
    registry.register(descriptor({ id: 'law.arrest', module: 'governance', section: 'guarda' }));
    assert.equal(registry.get('law.search').section, 'governance');
    assert.equal(registry.get('law.arrest').section, 'guarda');
  });

  // Uma ação que sobrevive ao desligamento do módulo aparece no menu e executa
  // contra um serviço que não inicializou. É o mesmo motivo pelo qual o
  // module-registry remove os comandos.
  it('unregisterModule remove só o que aquele módulo registrou', () => {
    registry.register(descriptor({ id: 'gov.a', module: 'governance' }));
    registry.register(descriptor({ id: 'gov.b', module: 'governance' }));
    registry.register(descriptor({ id: 'stall.ver', module: 'market-stalls' }));

    assert.equal(registry.unregisterModule('governance'), 2);
    assert.equal(registry.get('gov.a'), undefined);
    assert.ok(registry.get('stall.ver'), 'o módulo alheio não foi tocado');
    assert.equal(registry.unregisterModule('inexistente'), 0);
  });

  it('o id fica livre para outro módulo depois do unregisterModule', () => {
    registry.register(descriptor({ id: 'x.y', module: 'antigo' }));
    registry.unregisterModule('antigo');
    registry.register(descriptor({ id: 'x.y', module: 'novo' }));
    assert.equal(registry.get('x.y').module, 'novo');
  });
});

describe('interaction-registry — validação de payload', () => {
  const { validatePayload } = registry;

  it('sem schema, nada do cliente atravessa', () => {
    const r = validatePayload(null, { characterId: 7, gold: 999999 });
    assert.deepEqual(r, { ok: true, data: {} });
  });

  // Validar não é o mesmo que sanear. Se o `execute` recebesse o objeto do
  // cliente, um campo extra viajaria junto até alguém, um dia, lê-lo.
  it('devolve objeto novo, só com os campos declarados', () => {
    const schema = { reason: { type: 'string' } };
    const r = validatePayload(schema, { reason: 'desordem', amount: 999999, allowed: true });
    assert.deepEqual(r.data, { reason: 'desordem' });
    assert.equal('amount' in r.data, false);
    assert.equal('allowed' in r.data, false);
  });

  it('string: apara, exige mínimo e tem teto mesmo sem max declarado', () => {
    const schema = { reason: { type: 'string', min: 3 } };
    assert.equal(validatePayload(schema, { reason: '  furto  ' }).data.reason, 'furto');
    assert.equal(validatePayload(schema, { reason: 'ab' }).ok, false);
    // O mínimo vale sobre o texto JÁ aparado: três espaços não são três letras.
    assert.equal(validatePayload(schema, { reason: '  a  ' }).ok, false);
    assert.equal(validatePayload(schema, { reason: 'x'.repeat(241) }).ok, false, 'teto padrão de 240');
    assert.equal(validatePayload({ r: { type: 'string', max: 5 } }, { r: 'x'.repeat(6) }).ok, false);
    assert.equal(validatePayload(schema, { reason: 42 }).ok, false);
  });

  // `Number("1e3")` é 1000 e `parseInt(" 1")` é 1: as duas formas frouxas
  // atravessariam uma validação ingênua de "dá pra converter".
  it('int: recusa notação científica, espaço, decimal e zero à esquerda', () => {
    const schema = { amount: { type: 'int', min: 1, max: 1000 } };
    assert.equal(validatePayload(schema, { amount: '150' }).data.amount, 150);
    assert.equal(validatePayload(schema, { amount: 150 }).data.amount, 150);
    for (const amount of ['1e3', ' 1', '1.5', 1.5, '0x10', 'abc', Infinity, NaN, []]) {
      assert.equal(validatePayload(schema, { amount }).ok, false, `aceitou ${JSON.stringify(amount)}`);
    }
    assert.equal(validatePayload(schema, { amount: 0 }).ok, false, 'abaixo do mínimo');
    assert.equal(validatePayload(schema, { amount: 1001 }).ok, false, 'acima do máximo');
  });

  it('int: aceita negativo quando não há mínimo (delta de ledger)', () => {
    assert.equal(validatePayload({ d: { type: 'int' } }, { d: '-5' }).data.d, -5);
  });

  it('formid: aceita com e sem 0x, recusa 0 e lixo', () => {
    const schema = { baseId: { type: 'formid' } };
    assert.equal(validatePayload(schema, { baseId: '0x0000000F' }).data.baseId, 15);
    assert.equal(validatePayload(schema, { baseId: '162e2' }).data.baseId, 0x162e2);
    assert.equal(validatePayload(schema, { baseId: 15 }).data.baseId, 15);
    for (const baseId of ['0x', 'gg', '0', 0, -1, '123456789']) {
      assert.equal(validatePayload(schema, { baseId }).ok, false, `aceitou ${JSON.stringify(baseId)}`);
    }
  });

  it('bool e enum', () => {
    assert.equal(validatePayload({ f: { type: 'bool' } }, { f: 'true' }).data.f, true);
    assert.equal(validatePayload({ f: { type: 'bool' } }, { f: false }).data.f, false);
    assert.equal(validatePayload({ f: { type: 'bool' } }, { f: 'sim' }).ok, false);

    const enumSchema = { tipo: { type: 'enum', values: ['add', 'remove'] } };
    assert.equal(validatePayload(enumSchema, { tipo: 'add' }).data.tipo, 'add');
    assert.equal(validatePayload(enumSchema, { tipo: 'drop' }).ok, false);
    assert.equal(validatePayload(enumSchema, { tipo: 0 }).ok, false);
  });

  it('required e default', () => {
    const schema = {
      reason: { type: 'string', required: true },
      count: { type: 'int', default: 1 }
    };
    assert.equal(validatePayload(schema, { reason: 'x' }).data.count, 1);
    assert.equal(validatePayload(schema, {}).ok, false);
    assert.equal(validatePayload(schema, { reason: '' }).ok, false, 'string vazia é ausência');
  });

  // Um payload que não é objeto é a forma mais barata de sondar o pipeline.
  it('recusa payload que não é objeto quando há schema', () => {
    const schema = { reason: { type: 'string' } };
    for (const payload of ['texto', 42, [], true]) {
      assert.equal(validatePayload(schema, payload).ok, false, `aceitou ${JSON.stringify(payload)}`);
    }
    assert.equal(validatePayload(schema, undefined).ok, true, 'ausência é ok se nada é obrigatório');
    assert.equal(validatePayload(schema, null).ok, true);
  });

  it('não confunde herança de protótipo com campo enviado', () => {
    const schema = { toString: { type: 'string' } };
    const r = validatePayload(schema, {});
    assert.deepEqual(r.data, {}, 'Object.prototype.toString não é um campo do payload');
  });
});
