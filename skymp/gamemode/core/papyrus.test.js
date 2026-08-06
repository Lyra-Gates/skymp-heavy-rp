/**
 * papyrus.test.js
 *
 * Guarda o formato do `self` das chamadas Papyrus.
 *
 * Contexto: até 05/08/2026 o gamemode misturava duas formas — objeto
 * `{type,desc}` em 2 arquivos e FormID cru em 22 pontos. Os nove testes
 * oficiais do SkyMP (`misc/tests/` upstream) usam exclusivamente a forma de
 * objeto, inclusive para argumentos.
 *
 * A suíte passava com as duas formas porque o `mp` mockado aceita qualquer
 * coisa — foi exatamente por isso que a divergência sobreviveu tanto tempo.
 * Este arquivo existe pra fechar essa porta: agora existe teste que olha o
 * ARGUMENTO, não só o resultado.
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const papyrusCalls = [];
const originalMp = global.mp;

global.mp = {
  getDescFromId: (formId) => `${formId.toString(16)}:Skyrim.esm`,
  callPapyrusFunction: (callType, className, fnName, self, args) => {
    papyrusCalls.push({ callType, className, fnName, self, args });
    return null;
  }
};

const { actorRef, baseRef } = require('./papyrus');

after(() => {
  if (originalMp === undefined) delete global.mp;
  else global.mp = originalMp;
});

beforeEach(() => { papyrusCalls.length = 0; });

describe('actorRef / baseRef', () => {
  test('actorRef produz { type: "form", desc }', () => {
    assert.deepEqual(actorRef(0xff000000), { type: 'form', desc: 'ff000000:Skyrim.esm' });
  });

  test('baseRef produz { type: "espm", desc }', () => {
    // A distinção aparece nos testes oficiais: o ator é `form`, o Gold001 que
    // se adiciona ao inventário dele é `espm`.
    assert.deepEqual(baseRef(0xf), { type: 'espm', desc: 'f:Skyrim.esm' });
  });

  test('nunca devolve número cru', () => {
    const ref = actorRef(0x14);
    assert.equal(typeof ref, 'object');
    assert.notEqual(typeof ref, 'number');
  });
});

describe('transaction-service manda objeto, não FormID', () => {
  // O caso que mais importa: se a forma crua não funciona, o banco registrava
  // a transação e o item nunca chegava no inventário do jogador.
  const transactionService = require('./transaction-service');

  test('AddItem recebe self como objeto', () => {
    transactionService._applyToClient(0xff000abc, 0xf, 10);

    assert.equal(papyrusCalls.length, 1);
    const call = papyrusCalls[0];
    assert.equal(call.fnName, 'AddItem');
    assert.equal(typeof call.self, 'object', 'self precisa ser objeto, não o FormID');
    assert.equal(call.self.type, 'form');
    assert.equal(call.self.desc, 'ff000abc:Skyrim.esm');
  });

  test('RemoveItem recebe self como objeto', () => {
    transactionService._applyToClient(0xff000abc, 0xf, -3);

    assert.equal(papyrusCalls.length, 1);
    const call = papyrusCalls[0];
    assert.equal(call.fnName, 'RemoveItem');
    assert.equal(typeof call.self, 'object');
    assert.equal(call.self.type, 'form');
  });
});

/**
 * Varredura estática de TODO o gamemode, incluindo os módulos PARKED.
 *
 * Os testes acima exercitam os caminhos que rodam. O problema é que a forma
 * errada não quebra nada em teste — o `mp` mockado aceita qualquer coisa, e os
 * guards `if (typeof mp === 'undefined') return;` fazem a maioria dos arquivos
 * nem chegar na chamada. Foi assim que 22 pontos sobreviveram meses.
 *
 * PARKED entra na varredura de propósito: são justamente os arquivos que
 * ninguém executa, então são os que voltariam com a forma antiga sem que
 * nenhum teste de comportamento percebesse. Reativar um módulo não deveria ser
 * a hora de descobrir isso.
 */
describe('nenhuma chamada Papyrus usa FormID cru como self', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  const gamemodeDir = path.resolve(__dirname, '..');

  function arquivosJs(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
      const alvo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        if (['node_modules', 'types', 'scripts'].includes(entrada.name)) return [];
        return arquivosJs(alvo);
      }
      if (!entrada.name.endsWith('.js') || entrada.name.endsWith('.test.js')) return [];
      return [alvo];
    });
  }

  // Captura o 4o argumento de callPapyrusFunction(tipo, classe, fn, SELF, args).
  const CHAMADA = /callPapyrusFunction\(\s*(['"])(\w+)\1\s*,\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]\s*,\s*([^,]+?)\s*,/g;

  test("todo self de 'method' é objeto, actorRef() ou variável, nunca actorId", () => {
    const infratores = [];

    for (const arquivo of arquivosJs(gamemodeDir)) {
      // Comentários saem antes da varredura: o teste é sobre o que executa.
      // Exemplo comentado com a forma errada ainda é um problema — mas é um
      // problema de revisão, não de runtime, e fazer o teste falhar em prosa
      // é o caminho mais curto pra alguém enfraquecê-lo.
      const fonte = fs.readFileSync(arquivo, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const relativo = path.relative(gamemodeDir, arquivo).replace(/\\/g, '/');

      for (const [, , tipoChamada, self] of fonte.matchAll(CHAMADA)) {
        // 'global' não tem self: o valor correto ali é `null`.
        if (tipoChamada === 'global') {
          if (self.trim() !== 'null') {
            infratores.push(`${relativo}: chamada 'global' com self='${self.trim()}' (deveria ser null)`);
          }
          continue;
        }

        const limpo = self.trim();
        const ehFormIdCru = /^(actorId|targetActorId|releasedActorId|refId|neighborId|formId|baseId)$/.test(limpo);
        if (ehFormIdCru) {
          infratores.push(`${relativo}: self='${limpo}' e um FormID cru — use actorRef(${limpo})`);
        }
      }
    }

    assert.deepEqual(
      infratores, [],
      'Chamada Papyrus com self no formato invalido:\n  ' + infratores.join('\n  ') +
      '\nVer CONTRIBUTING.md 3.2 e o achado 2.13 do QA_REPORT: os testes oficiais do ' +
      'SkyMP usam exclusivamente { type, desc }. A forma crua nao lanca erro — ' +
      'ela simplesmente nao faz nada, e o banco fica dizendo que fez.'
    );
  });
});
