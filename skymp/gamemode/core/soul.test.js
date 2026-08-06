/**
 * core/soul.test.js
 *
 * Os testes obrigatórios do `docs/design/SOUL_AFFINITY.md` §III.12 que se
 * aplicam à camada de domínio. Os que dependem do serviço (vazamento em
 * `panelData`, consentimento em nó irreversível, firewall de identidade)
 * entram junto com ele, depois da Fase 0.
 *
 * O que estes testes protegem é diferente do usual: não é "a função devolve o
 * valor certo" — é **a distribuição e as invariantes do sistema**. Alma
 * enviesada ou rolagem que falha não aparecem em uma execução; aparecem com
 * centenas de jogadores, quando consertar significa mexer na alma de gente que
 * já tem apego ao personagem. É por isso que quase todo teste aqui roda em
 * lote grande.
 *
 * Executa com: node --test core/soul.test.js
 */

const assert = require('assert');
const { describe, it } = require('node:test');

const soul = require('./soul');

const SEGREDO = 'segredo-de-teste-nunca-usar-em-producao';

/** Uma amostra grande de almas, como o servidor teria depois de meses. */
function amostra(n) {
  const almas = [];
  for (let i = 1; i <= n; i++) {
    const seed = soul.deriveSeed(SEGREDO, i, {
      motivations: `motivacao ${i}`,
      weaknesses: `fraqueza ${i}`,
      socialTies: `laco ${i}`
    });
    almas.push(soul.generateSoul(seed));
  }
  return almas;
}

const AMOSTRA = amostra(3000);

// ─────────────────────────────────────────────────────────────────────────────

describe('III.12.1 — orçamento fixo é respeitado', () => {
  it('as quatro afinidades sempre somam exatamente o orçamento', () => {
    for (const alma of AMOSTRA) {
      const total = soul.AFFINITIES.reduce((s, k) => s + alma[k], 0);
      assert.equal(
        total, soul.AFFINITY_BUDGET,
        `soma de afinidades deu ${total}, deveria ser ${soul.AFFINITY_BUDGET}. ` +
        `Soma errada quebra em silencio a regra "nenhuma alma e melhor".`
      );
    }
  });

  it('os três traços sempre somam exatamente o orçamento', () => {
    for (const alma of AMOSTRA) {
      const total = soul.TRAITS.reduce((s, k) => s + alma[k], 0);
      assert.equal(total, soul.TRAIT_BUDGET);
    }
  });

  it('nenhum valor sai de [0, 100]', () => {
    for (const alma of AMOSTRA) {
      for (const k of [...soul.AFFINITIES, ...soul.TRAITS]) {
        assert.ok(alma[k] >= 0 && alma[k] <= 100, `${k}=${alma[k]} fora de [0,100]`);
      }
    }
  });

  it('nenhuma alma é boa em tudo — a garantia da regra 1', () => {
    // Com orçamento fixo isso é aritmética, não balanceamento. O teste existe
    // para que ninguem "otimize" o gerador e derrube a garantia sem perceber.
    const fortes = a => soul.AFFINITIES.filter(k => ['forte', 'raro'].includes(soul.band(a[k]))).length;
    for (const alma of AMOSTRA) {
      assert.ok(
        fortes(alma) <= 2,
        `alma com ${fortes(alma)} afinidades fortes/raras: ${JSON.stringify(alma)}`
      );
    }
  });
});

describe('III.12.2 — a distribuição concentra no meio', () => {
  const contagem = {};
  for (const b of soul.BANDS) contagem[b] = 0;
  for (const alma of AMOSTRA) {
    for (const k of soul.AFFINITIES) contagem[soul.band(alma[k])] += 1;
  }
  const totalBandas = AMOSTRA.length * soul.AFFINITIES.length;

  it('`comum` é a banda mais frequente', () => {
    const maior = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(maior, 'comum', `banda mais frequente foi '${maior}': ${JSON.stringify(contagem)}`);
  });

  it('`raro` é raro de verdade — abaixo de 5%', () => {
    const pct = contagem.raro / totalBandas;
    assert.ok(pct < 0.05, `'raro' apareceu em ${(pct * 100).toFixed(1)}% das afinidades`);
  });

  it('nenhuma banda é impossível — extremos existem', () => {
    // Se 'raro' ou 'surdo' nunca saissem, o sistema teria cinco degraus no
    // papel e tres na pratica.
    for (const b of soul.BANDS) {
      assert.ok(contagem[b] > 0, `banda '${b}' nunca apareceu em ${totalBandas} sorteios`);
    }
  });
});

describe('III.12.3 — determinismo', () => {
  const ficha = { motivations: 'vingar o pai', weaknesses: 'bebe demais', socialTies: 'irma em Riften' };

  it('mesma ficha, mesma alma', () => {
    const a = soul.generateSoul(soul.deriveSeed(SEGREDO, 42, ficha));
    const b = soul.generateSoul(soul.deriveSeed(SEGREDO, 42, ficha));
    assert.deepEqual(a, b);
  });

  it('espaço, maiúscula e acento não mudam a alma', () => {
    // Sem isso, reeditar a ficha sem mudar o conceito daria outra alma — e o
    // jogador aprenderia a "reeditar ate gostar".
    const a = soul.generateSoul(soul.deriveSeed(SEGREDO, 42, ficha));
    const b = soul.generateSoul(soul.deriveSeed(SEGREDO, 42, {
      motivations: '  VINGAR  o  PAI ', weaknesses: 'Bebe demais', socialTies: 'Irmã em Riften'
    }));
    assert.deepEqual(a, b);
  });

  it('ficha diferente, alma diferente', () => {
    const a = soul.generateSoul(soul.deriveSeed(SEGREDO, 42, ficha));
    const b = soul.generateSoul(soul.deriveSeed(SEGREDO, 42, { ...ficha, motivations: 'buscar a cura' }));
    assert.notDeepEqual(a, b);
  });

  it('personagem diferente com a mesma ficha tem alma diferente', () => {
    const a = soul.generateSoul(soul.deriveSeed(SEGREDO, 42, ficha));
    const b = soul.generateSoul(soul.deriveSeed(SEGREDO, 43, ficha));
    assert.notDeepEqual(a, b);
  });

  it('segredo diferente, alma diferente — é o que mantém o sistema oculto', () => {
    const a = soul.generateSoul(soul.deriveSeed(SEGREDO, 42, ficha));
    const b = soul.generateSoul(soul.deriveSeed('outro-segredo', 42, ficha));
    assert.notDeepEqual(
      a, b,
      'sem o segredo importar, qualquer um calcularia a alma alheia a partir da ficha publica'
    );
  });

  it('recusa derivar sem segredo, em vez de cair num padrão', () => {
    assert.throws(() => soul.deriveSeed('', 42, ficha), /segredo/i);
    assert.throws(() => soul.deriveSeed(undefined, 42, ficha), /segredo/i);
  });
});

describe('III.12.4 — a resolução NUNCA falha', () => {
  const alma = AMOSTRA[0];

  it('no pior peso possível, todo resultado ainda é um dos quatro', () => {
    for (let i = 0; i < 5000; i++) {
      const r = soul.resolve({
        soul: alma, affinity: 'arcana', seed: 'semente-fixa', eventId: `ato-${i}`,
        circumstance: -10, difficulty: 10, pressure: 4   // absurdamente ruim
      });
      assert.ok(
        soul.OUTCOMES.includes(r.outcome),
        `resultado fora dos quatro: ${JSON.stringify(r)}`
      );
    }
  });

  it('nenhum resultado tem peso zero, em nenhum ponto da escala', () => {
    // Se algum zerasse, o jogador experiente saberia o resultado antes de
    // tentar — e ai nao ha tensao nenhuma.
    for (let peso = -6; peso <= 8; peso++) {
      const w = soul.outcomeWeights(peso);
      for (const o of soul.OUTCOMES) {
        assert.ok(w[o] > 0, `peso ${peso}: '${o}' zerado`);
      }
    }
  });

  it('o dom melhora o resultado, mas não o garante', () => {
    const contar = (peso) => {
      const c = { limpo: 0, caro: 0, complicado: 0, marcado: 0 };
      for (let i = 0; i < 4000; i++) {
        c[soul.resolve({
          soul: alma, affinity: 'arcana', seed: 's', eventId: `e${i}`, circumstance: peso
        }).outcome] += 1;
      }
      return c;
    };
    const fraco = contar(-3);
    const forte = contar(5);

    assert.ok(forte.limpo > fraco.limpo * 2, 'peso alto deveria produzir muito mais limpo');
    assert.ok(fraco.marcado > forte.marcado * 2, 'peso baixo deveria produzir muito mais marcado');
    assert.ok(forte.marcado > 0, 'o talentoso ainda precisa poder se marcar num dia ruim');
    assert.ok(fraco.limpo > 0, 'quem nao tem dom ainda precisa poder ter um momento limpo');
  });

  it('mesma tentativa, mesmo resultado — auditável', () => {
    const args = { soul: alma, affinity: 'sombria', seed: 'sem', eventId: 'ritual-7', attempt: 2 };
    assert.deepEqual(soul.resolve(args), soul.resolve(args));
  });

  it('devolve as entradas para o audit log', () => {
    const r = soul.resolve({ soul: alma, affinity: 'divina', seed: 'sem', eventId: 'bencao-1' });
    assert.equal(typeof r.peso, 'number');
    assert.equal(typeof r.roll, 'number');
    assert.equal(r.inputs.affinity, 'divina');
    assert.ok(soul.BANDS.includes(r.inputs.banda));
    assert.equal(r.inputs.eventId, 'bencao-1');
  });

  it('recusa chamada sem eventId — sem ele a rolagem não é auditável', () => {
    assert.throws(
      () => soul.resolve({ soul: alma, affinity: 'arcana', seed: 'sem' }),
      /eventId/
    );
  });

  it('recusa afinidade inexistente em vez de escolher uma', () => {
    assert.throws(
      () => soul.resolve({ soul: alma, affinity: 'marcial', seed: 's', eventId: 'e' }),
      /afinidade desconhecida/
    );
  });
});

describe('III.12.5 — pressão empurra para marca, nunca para limpo', () => {
  const alma = AMOSTRA[1];

  const contarComPressao = (tentativasRecentes) => {
    const pressure = soul.pressureFrom(tentativasRecentes);
    const c = { limpo: 0, caro: 0, complicado: 0, marcado: 0 };
    for (let i = 0; i < 4000; i++) {
      c[soul.resolve({
        soul: alma, affinity: 'arcana', seed: 's', eventId: `e${i}`, pressure
      }).outcome] += 1;
    }
    return c;
  };

  it('insistir não converge para o sucesso limpo', () => {
    const primeira = contarComPressao(0);
    const insistindo = contarComPressao(12);

    assert.ok(
      insistindo.limpo < primeira.limpo,
      'tentar de novo nao pode aumentar a chance de limpo — seria o exploit de spam'
    );
    assert.ok(
      insistindo.marcado > primeira.marcado,
      'insistir precisa converger para marcas'
    );
  });

  it('a pressão tem teto — não vira uma segunda porta fechada', () => {
    assert.equal(soul.pressureFrom(1000), soul.pressureFrom(8));
    assert.equal(soul.pressureFrom(0), 0);
  });

  it('ignora entrada absurda em vez de propagar NaN', () => {
    assert.equal(soul.pressureFrom(-5), 0);
    assert.equal(soul.pressureFrom('abc'), 0);
    assert.equal(soul.pressureFrom(null), 0);
  });
});

describe('resistência à corrupção é derivada, não armazenada', () => {
  it('não existe como campo da alma', () => {
    for (const k of Object.keys(AMOSTRA[0])) {
      assert.ok(
        !/corrup/i.test(k),
        `'${k}' virou campo: a v1.1 cortou isso justamente por sobrepor Vontade e Estabilidade`
      );
    }
  });

  it('Vontade pesa mais que Estabilidade', () => {
    const teimoso = soul.corruptionResistance({ vontade: 100, estabilidade: 0 });
    const equilibrado = soul.corruptionResistance({ vontade: 0, estabilidade: 100 });
    assert.ok(
      teimoso > equilibrado,
      'resistir a ser mudado e mais recusa que equilibrio'
    );
  });
});

describe('bandas', () => {
  it('cobrem toda a escala sem buraco', () => {
    for (let v = 0; v <= 100; v++) {
      assert.ok(soul.BANDS.includes(soul.band(v)), `valor ${v} sem banda`);
    }
  });

  it('são monotônicas — valor maior nunca cai em banda menor', () => {
    let anterior = -1;
    for (let v = 0; v <= 100; v++) {
      const idx = soul.bandIndex(v);
      assert.ok(idx >= anterior, `banda caiu entre ${v - 1} e ${v}`);
      anterior = idx;
    }
  });

  it('valor fora da escala não explode', () => {
    assert.equal(soul.band(-50), 'surdo');
    assert.equal(soul.band(500), 'raro');
    assert.equal(soul.band(undefined), 'surdo');
  });
});
