/**
 * fauna-census.test.js
 *
 * O censo é a Peça 1 da §16 do `HOSTILE_MOB_ACTIVATION_DECISION.md`, e a única
 * regra que ele tem é **olhar e não tocar**. O teste que importa é o primeiro:
 * a varredura não pode fazer uma única chamada Papyrus. Não é preciosismo de
 * performance — é a diferença entre um instrumento de observação e mais um
 * serviço que mexe no mundo, e este repositório já apagou por engano mercadores,
 * guardas e NPCs de quest a cada 60 s uma vez.
 *
 * ─── Mutações verificadas (CONTRIBUTING.md §6) ───────────────────────────────
 *
 *   1. Acrescentar qualquer `mp.callPapyrusFunction` dentro do laço de
 *      `levantarCenso` → reprova "a varredura nao toca Papyrus".
 *   2. Trocar `if (!baseDesc) { semBaseDesc++; continue; }` por um `continue` nu
 *      → reprova "ator sem baseDesc e contado, nao sumido".
 *   3. Tirar a conversão de `Infinity` para string no fim
 *      → reprova "distancia infinita nao vira null no JSON".
 *   4. Tirar o aviso de "nenhum jogador conectado"
 *      → reprova "sem jogador, o relatorio avisa em vez de fingir densidade".
 *
 * Executa com: node --test fauna-census.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, after } = require('node:test');

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request.endsWith('/database') || request === './database' || request === '../database') {
    return { query: async () => [], getConnection: async () => ({}), init: () => {} };
  }
  return originalLoad.apply(this, arguments);
};

const LOBO_PERTO = 0x000a0001;
const LOBO_LONGE = 0x000a0002;
const URSO = 0x000a0003;
const SEM_BASE = 0x000a0004;
const JOGADOR = 0xff000001;

const BASE_LOBO = '1a6a0:Skyrim.esm';
const BASE_URSO = 'be5c0:Skyrim.esm';
const CELULA = 'Tamriel';

const chamadasPapyrus = [];
const posicoes = new Map();
const basePorAtor = new Map();
let atoresDoMundo = [];
let jogadoresPorPerfil = new Map();

const originalMp = global.mp;
global.mp = {
  getDescFromId: (formId) => `${formId.toString(16)}:Skyrim.esm`,
  getActorsByProfileId: (profileId) => {
    if (profileId === 0) return atoresDoMundo;
    return jogadoresPorPerfil.get(profileId) || [];
  },
  get: (actorId, prop) => {
    if (prop === 'baseDesc') return basePorAtor.get(actorId) || null;
    if (prop === 'locationalData') return posicoes.get(actorId) || null;
    if (prop === 'type') return 'MpActor';
    return null;
  },
  set: () => { throw new Error('o censo nunca escreve property'); },
  callPapyrusFunction: (callType, className, fnName, self, args) => {
    chamadasPapyrus.push({ callType, className, fnName, self, args });
    return 100;
  }
};

const censo = require('./fauna-census');

Module._load = originalLoad;

after(() => {
  if (originalMp === undefined) delete global.mp;
  else global.mp = originalMp;
});

describe('fauna-census - captura de ponto de spawn', () => {
  it('devolve CELL, posicao e rotacao no formato de startPoint', () => {
    posicoes.set(JOGADOR, {
      pos: [273.63, 827.70, 397.34],
      rot: [0, 0, 91.5],
      cellOrWorldDesc: '95a39:Skyrim.esm'
    });

    assert.deepStrictEqual(censo.capturarLocalizacao(JOGADOR), {
      ok: true,
      cellOrWorldDesc: '95a39:Skyrim.esm',
      pos: [273.63, 827.70, 397.34],
      rot: [0, 0, 91.5],
      startPoint: {
        pos: [273.63, 827.70, 397.34],
        worldOrCell: '95a39:Skyrim.esm',
        angleZ: 91.5
      }
    });
  });

  it('recusa localizacao incompleta em vez de inventar celula', () => {
    posicoes.set(JOGADOR, { pos: [273.63, 827.70, 397.34] });
    assert.deepStrictEqual(censo.capturarLocalizacao(JOGADOR), {
      ok: false,
      code: 'localizacao_indisponivel'
    });
  });

  it('registra /ondestou junto dos comandos do laboratorio', () => {
    assert.ok(censo.commandDefs().some(def => def.name.includes('/ondestou')));
  });
});

const emCelula = (x, celula = CELULA) => ({ pos: [x, 0, 0], cellOrWorldDesc: celula });

beforeEach(() => {
  chamadasPapyrus.length = 0;
  posicoes.clear();
  basePorAtor.clear();
  jogadoresPorPerfil = new Map([[1, [JOGADOR]]]);
  atoresDoMundo = [LOBO_PERTO, LOBO_LONGE, URSO, SEM_BASE];

  posicoes.set(JOGADOR, emCelula(0));
  posicoes.set(LOBO_PERTO, emCelula(400));
  posicoes.set(LOBO_LONGE, emCelula(30000));
  posicoes.set(URSO, emCelula(3000));
  posicoes.set(SEM_BASE, emCelula(50));

  basePorAtor.set(LOBO_PERTO, BASE_LOBO);
  basePorAtor.set(LOBO_LONGE, BASE_LOBO);
  basePorAtor.set(URSO, BASE_URSO);
  // SEM_BASE fica sem baseDesc de proposito
});

describe('fauna-census — olhar e nao tocar', () => {
  it('a varredura nao toca Papyrus', () => {
    censo.levantarCenso();

    assert.strictEqual(
      chamadasPapyrus.length, 0,
      'uma ida ao Papyrus custa 13-35 ms (Anexo A.5); com 300 atores o censo congelaria o servidor. ' +
      'E, pior, um instrumento de observacao que chama funcao no motor deixou de ser observacao'
    );
  });

  it('nao escreve property nenhuma', () => {
    // `mp.set` do mock lanca. Se o censo escrever, o teste explode aqui.
    assert.doesNotThrow(() => censo.levantarCenso());
  });
});

describe('fauna-census — o que ele mede', () => {
  it('agrega por baseDesc, com contagem e a menor distancia a um jogador', () => {
    const r = censo.levantarCenso();

    assert.strictEqual(r.recordsDistintos, 2, 'lobo e urso — o ator sem baseDesc nao vira record');
    assert.strictEqual(r.porRecord[BASE_LOBO].quantidade, 2);
    assert.strictEqual(r.porRecord[BASE_LOBO].distanciaMinima, 400, 'a menor das duas, nao a ultima vista');
    assert.strictEqual(r.porRecord[BASE_URSO].quantidade, 1);
    assert.deepStrictEqual(r.porRecord[BASE_LOBO].celulas, [CELULA]);
  });

  it('ator sem baseDesc e contado, nao sumido', () => {
    const r = censo.levantarCenso();

    assert.strictEqual(r.atoresSemPerfil, 4, 'os quatro atores foram vistos');
    assert.strictEqual(
      r.semBaseDesc, 1,
      'sumir com ele faria o total nao fechar, e a curadoria da §4 do NPC_POLICY depende do total fechar'
    );
  });

  it('distribui por faixa usando o safeRadius do npc-cleaner como fronteira', () => {
    const r = censo.levantarCenso();

    assert.strictEqual(r.porFaixa['ate 1000 (na cara do jogador)'], 1, 'so o lobo a 400 — o ator sem baseDesc nao entra');
    assert.strictEqual(r.porFaixa['1000-5000 (dentro do safeRadius)'], 1, 'o urso a 3000');
    assert.strictEqual(r.porFaixa['5000-20000 (fora do safeRadius)'], 0);
    assert.strictEqual(r.porFaixa['acima de 20000'], 1, 'o lobo a 30000');
  });

  it('os totais reconciliam', () => {
    const r = censo.levantarCenso();

    assert.strictEqual(
      r.atoresComBaseDesc + r.semBaseDesc, r.atoresSemPerfil,
      'todo ator visto tem que estar de um lado ou do outro'
    );
    const somaDasFaixas = Object.values(r.porFaixa).reduce((a, b) => a + b, 0);
    assert.strictEqual(
      somaDasFaixas, r.atoresComBaseDesc,
      'a distribuicao por faixa cobre exatamente os atores com record — nem um a mais, nem um a menos'
    );
    const somaDosRecords = Object.values(r.porRecord).reduce((a, e) => a + e.quantidade, 0);
    assert.strictEqual(somaDosRecords, r.atoresComBaseDesc);
  });

  it('ator em outra celula cai na faixa de "sem posicao", nao numa distancia inventada', () => {
    posicoes.set(URSO, emCelula(10, 'Blackreach'));

    const r = censo.levantarCenso();

    assert.strictEqual(r.porFaixa['outra celula ou sem posicao'], 1);
    assert.strictEqual(
      r.porRecord[BASE_URSO].distanciaMinima, 'sem jogador na mesma celula',
      'distancia entre celulas nao e 10 unidades so porque os X sao parecidos'
    );
  });

  it('limita a amostra de actorIds por record', () => {
    atoresDoMundo = [0xb01, 0xb02, 0xb03, 0xb04, 0xb05];
    for (const id of atoresDoMundo) {
      basePorAtor.set(id, BASE_LOBO);
      posicoes.set(id, emCelula(100));
    }

    const r = censo.levantarCenso({ amostrasPorRecord: 2 });

    assert.strictEqual(r.porRecord[BASE_LOBO].quantidade, 5, 'conta todos');
    assert.strictEqual(r.porRecord[BASE_LOBO].amostraDeActorIds.length, 2, 'mas so amostra dois');
    assert.deepStrictEqual(r.porRecord[BASE_LOBO].amostraDeActorIds, ['0xb01', '0xb02']);
  });
});

describe('fauna-census — o relatorio nao mente', () => {
  it('sem jogador, avisa em vez de fingir densidade', () => {
    jogadoresPorPerfil = new Map();

    const r = censo.levantarCenso();

    assert.strictEqual(r.jogadoresConectados, 0);
    assert.ok(
      r.avisos.some(a => a.includes('NENHUM jogador conectado')),
      'um arquivo cheio de Infinity parece um resultado; sem o aviso alguem o leria como densidade zero'
    );
  });

  it('distancia infinita nao vira null no JSON', () => {
    jogadoresPorPerfil = new Map();

    const r = censo.levantarCenso();
    const serializado = JSON.parse(JSON.stringify(r));

    assert.strictEqual(
      serializado.porRecord[BASE_LOBO].distanciaMinima, 'sem jogador na mesma celula',
      'JSON.stringify transforma Infinity em null, e null aqui se leria como "distancia zero"'
    );
  });

  it('carrega a propria procedencia', () => {
    const r = censo.levantarCenso();
    assert.match(r.origem, /sem Papyrus, sem escrita/);
  });
});

describe('fauna-census — a leitura cara fica isolada', () => {
  it('inspecionarAtor e o UNICO caminho que chama Papyrus', () => {
    const leitura = censo.inspecionarAtor(LOBO_PERTO);

    assert.strictEqual(leitura.baseDesc, BASE_LOBO);
    assert.ok(chamadasPapyrus.length > 0, 'aqui a ida ao motor e o ponto');
    assert.ok(
      chamadasPapyrus.every(c => c.fnName === 'getActorValue'),
      'so leitura de valor — nada de disable, enable, delete ou additem'
    );
    assert.ok(
      chamadasPapyrus.every(c => typeof c.self === 'object' && c.self.type === 'form'),
      'o self precisa ser objeto {type, desc}, nunca o FormID cru (QA 2.13)'
    );
  });
});
