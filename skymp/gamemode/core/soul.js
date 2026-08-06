/**
 * core/soul.js — Afinidade da Alma, camada de domínio
 *
 * Desenho completo: `docs/design/SOUL_AFFINITY.md`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Por que este arquivo existe agora, se o sistema está bloqueado pela Fase 0
 * ─────────────────────────────────────────────────────────────────────────────
 * O desenho diz que nada da Afinidade da Alma vira código antes do teste
 * in-game. Isso vale para o **serviço** — o que fala com o mundo, entrega
 * sinais, grava marcas e avança árvores.
 *
 * Não vale para o **domínio**. Este módulo é função pura: não abre banco, não
 * toca `mp`, não tem efeito colateral e não sabe que existe um jogo. Ele é
 * provável inteiro fora do servidor, e é exatamente a peça onde estar errado
 * sai mais caro depois — distribuição enviesada ou rolagem que falha só
 * aparecem com centenas de jogadores, quando consertar já significa mexer na
 * alma de gente que tem apego ao personagem.
 *
 * É também a separação que a Constituição §13 pede entre domínio e
 * infraestrutura, feita de verdade e não como diagrama.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * As três regras inegociáveis (Constituição §8, emenda v1.1)
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Nenhuma alma é estritamente melhor que outra. Garantido aqui por
 *    ORÇAMENTO FIXO: afinidade alta obriga outra a ser baixa. Não depende de
 *    boa vontade de quem escrever conteúdo daqui a dois anos.
 * 2. O dado nunca diz não. `resolve()` devolve um de quatro resultados, e os
 *    quatro dão certo. Não existe caminho de retorno que signifique falha.
 * 3. Toda rolagem é auditável. Tudo aqui é determinístico a partir da semente,
 *    e `resolve()` devolve as entradas junto do resultado para que a staff
 *    possa reproduzir qualquer resultado contestado.
 */

const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulário
// ─────────────────────────────────────────────────────────────────────────────

/** Uma por árvore de transformação. */
const AFFINITIES = Object.freeze(['arcana', 'divina', 'sombria', 'bestial']);

/** Como o personagem aguenta o custo do que tentou. */
const TRAITS = Object.freeze(['vontade', 'sensibilidade', 'estabilidade']);

/**
 * O jogador nunca vê número. A resolução também não usa número cru — usa
 * banda. Ter só cinco degraus é o que impede o sistema de virar planilha:
 * a diferença entre 61 e 63 não existe para ninguém.
 */
const BANDS = Object.freeze(['surdo', 'fraco', 'comum', 'forte', 'raro']);

/** Os quatro resultados. TODOS dão certo — ver regra 2 no topo. */
const OUTCOMES = Object.freeze(['limpo', 'caro', 'complicado', 'marcado']);

/**
 * Orçamentos fixos. São a garantia mecânica da regra 1.
 *
 * 200 entre 4 afinidades = média 50. Para alguém tirar `raro` (85+) em Arcana,
 * as outras três precisam somar 115 — ou seja, ficam abaixo da média. Não há
 * como ser bom em tudo, e isso não é uma escolha de balanceamento que alguém
 * possa desfazer sem perceber: é aritmética.
 */
const AFFINITY_BUDGET = 200;
const TRAIT_BUDGET = 150;

/**
 * Fronteiras das bandas. Concentradas no meio de propósito: quase todo mundo é
 * `comum` em quase tudo, que é o que faz `raro` significar alguma coisa.
 */
const BAND_BOUNDS = Object.freeze([
  { band: 'surdo', max: 14 },
  { band: 'fraco', max: 34 },
  { band: 'comum', max: 64 },
  { band: 'forte', max: 84 },
  { band: 'raro', max: 100 }
]);

// ─────────────────────────────────────────────────────────────────────────────
// Aleatoriedade determinística
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gerador contado, não sequencial: cada valor sai de `HMAC(semente, rótulo:n)`.
 *
 * Escolhido em vez de um PRNG com estado por dois motivos que importam aqui:
 * reproduzir um resultado antigo não exige reproduzir a sequência inteira que
 * veio antes (a staff precisa auditar UMA rolagem, não replicar meses de
 * jogo), e fluxos com rótulos diferentes são independentes — mexer na geração
 * de traços não desloca a de afinidades.
 *
 * @param {string} seed  semente em hexadecimal
 * @param {string} label fluxo independente ('afinidades', 'tracos', 'resolve')
 */
function stream(seed, label) {
  let counter = 0;
  return function next() {
    const mac = crypto.createHmac('sha256', Buffer.from(String(seed), 'utf8'));
    mac.update(`${label}:${counter++}`);
    // 4 bytes bastam: 2^32 valores distintos é resolução muito acima do que
    // qualquer coisa aqui usa.
    return mac.digest().readUInt32BE(0) / 0x1_0000_0000;
  };
}

/**
 * Soma de três uniformes: distribuição em sino, barata e sem dependência.
 * É o que faz o meio ser comum e os extremos serem raros antes mesmo da
 * normalização.
 */
function bell(next) {
  return (next() + next() + next()) / 3;
}

// ─────────────────────────────────────────────────────────────────────────────
// Semente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A alma vem da ficha aprovada, nunca do acaso.
 *
 * Isso mata o reroll-farming (mesma ficha, mesma alma — matar o personagem e
 * recriar o mesmo conceito não muda nada) e faz a aplicação de whitelist valer
 * mecanicamente, o que melhora a qualidade das fichas sem precisar de regra
 * nova.
 *
 * ⚠️ O SEGREDO NUNCA SAI DO SERVIDOR. A ficha é pública: sem segredo, qualquer
 * pessoa calcularia a alma de qualquer personagem a partir do que está escrito
 * no painel, e o sistema inteiro deixaria de ser oculto. O segredo é passado
 * como argumento — este módulo não lê ambiente, porque domínio não conhece
 * infraestrutura.
 *
 * @param {string} secret        SOUL_SECRET, vindo de fora
 * @param {number} characterId
 * @param {{motivations?: string, weaknesses?: string, socialTies?: string}} ficha
 * @returns {string} semente hex
 */
function deriveSeed(secret, characterId, ficha = {}) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('soul: segredo do servidor ausente — a alma nao pode ser derivada sem ele');
  }
  if (!Number.isInteger(characterId) || characterId <= 0) {
    throw new Error(`soul: characterId invalido (${characterId})`);
  }

  // Normalizar antes de assinar: espaço a mais, maiúscula ou acento não podem
  // gerar uma alma diferente para a mesma ficha aprovada.
  const normalize = (texto) => String(texto || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const material = [
    characterId,
    normalize(ficha.motivations),
    normalize(ficha.weaknesses),
    normalize(ficha.socialTies)
  ].join(' ');

  return crypto.createHmac('sha256', secret).update(material).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Geração
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distribui `budget` entre `keys`, mantendo a soma exata e cada valor em
 * [0, 100].
 *
 * O arredondamento é feito por maior resto: normalizar e arredondar cada valor
 * isoladamente produziria somas erradas, e uma soma errada quebra a regra 1
 * silenciosamente — que é o pior jeito de quebrar.
 */
function distribute(keys, budget, next) {
  const raw = keys.map(() => bell(next));
  const total = raw.reduce((a, b) => a + b, 0) || 1;

  const exact = raw.map(v => (v / total) * budget);
  const floors = exact.map(v => Math.min(100, Math.floor(v)));

  let restante = budget - floors.reduce((a, b) => a + b, 0);

  // Sobra vai para quem tem o maior resto, respeitando o teto de 100.
  const ordem = exact
    .map((v, i) => ({ i, resto: v - Math.floor(v) }))
    .sort((a, b) => b.resto - a.resto);

  let volta = 0;
  while (restante > 0 && volta < keys.length * 100) {
    for (const { i } of ordem) {
      if (restante === 0) break;
      if (floors[i] < 100) {
        floors[i] += 1;
        restante -= 1;
      }
    }
    volta += 1;
  }

  const alma = {};
  keys.forEach((k, i) => { alma[k] = floors[i]; });
  return alma;
}

/**
 * Gera a alma a partir da semente. Determinístico: mesma semente, mesma alma,
 * entre execuções e entre processos.
 *
 * @param {string} seed
 * @returns {Object} sete valores — quatro afinidades e três traços
 */
function generateSoul(seed) {
  if (!seed || typeof seed !== 'string') {
    throw new Error('soul: semente invalida');
  }
  return {
    ...distribute(AFFINITIES, AFFINITY_BUDGET, stream(seed, 'afinidades')),
    ...distribute(TRAITS, TRAIT_BUDGET, stream(seed, 'tracos'))
  };
}

/** Traduz valor cru na banda. É o único jeito de olhar a alma daqui pra frente. */
function band(value) {
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  for (const { band: nome, max } of BAND_BOUNDS) {
    if (n <= max) return nome;
  }
  return 'raro';
}

/** Índice numérico da banda (0–4), para entrar na conta do peso. */
function bandIndex(value) {
  return BANDS.indexOf(band(value));
}

/**
 * Resistência à corrupção — valor DERIVADO, não armazenado.
 *
 * A proposta original tinha isto como oitavo atributo. Sobrepunha Vontade e
 * Estabilidade quase inteiramente, e botão a mais não é profundidade: é uma
 * dimensão a mais para balancear e para explicar, sem nada em troca.
 *
 * Vontade pesa mais que Estabilidade de propósito: resistir a ser mudado é
 * mais recusa que equilíbrio.
 */
function corruptionResistance(soul) {
  return Math.round((soul.vontade * 0.6) + (soul.estabilidade * 0.4));
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolução
// ─────────────────────────────────────────────────────────────────────────────

const PESO_MIN = -4;
const PESO_MAX = 6;

/**
 * Pesos dos quatro resultados em função do `peso`.
 *
 * **Nenhum peso é zero em nenhum ponto da escala.** Isso é deliberado e é o que
 * separa este sistema de uma tabela: o talentoso ainda pode se marcar num dia
 * ruim, e quem não tem dom nenhum ainda pode ter um momento limpo — que é a
 * história que a pessoa vai contar pelo resto do personagem.
 *
 * Se algum destes chegasse a zero, o jogador experiente saberia o resultado
 * antes de tentar, e aí não há tensão nenhuma.
 */
function outcomeWeights(peso) {
  const p = Math.max(PESO_MIN, Math.min(PESO_MAX, peso));
  const t = (p - PESO_MIN) / (PESO_MAX - PESO_MIN); // 0 = pior, 1 = melhor

  return {
    limpo:      2 + 60 * Math.pow(t, 2),
    caro:       10 + 30 * Math.sin(Math.PI * t),
    complicado: 8 + 40 * (1 - t),
    marcado:    2 + 45 * Math.pow(1 - t, 2)
  };
}

/**
 * Resolve uma tentativa ligada à alma.
 *
 * **Nunca devolve falha.** Devolve qual das quatro histórias você ganhou.
 *
 * @param {Object}  params
 * @param {Object}  params.soul
 * @param {string}  params.affinity      qual afinidade governa o ato
 * @param {string}  params.seed          semente da alma
 * @param {string}  params.eventId       identifica o ato; entra na rolagem
 * @param {number} [params.attempt]      tentativa nesta janela (0 = primeira)
 * @param {number} [params.circumstance] mestre, componente, lugar, preparo
 * @param {number} [params.difficulty]   dificuldade do ato
 * @param {number} [params.pressure]     ver `pressureFrom`
 * @returns {{outcome: string, peso: number, roll: number, inputs: Object}}
 *          `inputs` existe para ir direto ao audit log: sem as entradas
 *          gravadas, a staff não consegue reproduzir e a acusação de
 *          favorecimento vira infalsificável.
 */
function resolve({
  soul, affinity, seed, eventId,
  attempt = 0, circumstance = 0, difficulty = 0, pressure = 0
}) {
  if (!soul || typeof soul !== 'object') throw new Error('soul: alma ausente');
  if (!AFFINITIES.includes(affinity)) {
    throw new Error(`soul: afinidade desconhecida '${affinity}' — use uma de ${AFFINITIES.join(', ')}`);
  }
  if (!seed) throw new Error('soul: semente ausente');
  if (!eventId) throw new Error('soul: eventId ausente — sem ele a rolagem nao e auditavel');

  const peso = bandIndex(soul[affinity]) + circumstance - difficulty - pressure;

  const next = stream(seed, `resolve:${eventId}:${attempt}`);
  const roll = next();

  const weights = outcomeWeights(peso);
  const total = OUTCOMES.reduce((soma, o) => soma + weights[o], 0);

  let acumulado = 0;
  let outcome = OUTCOMES[OUTCOMES.length - 1];
  for (const o of OUTCOMES) {
    acumulado += weights[o] / total;
    if (roll < acumulado) { outcome = o; break; }
  }

  return {
    outcome,
    peso,
    roll,
    inputs: { affinity, banda: band(soul[affinity]), circumstance, difficulty, pressure, attempt, eventId }
  };
}

/**
 * Pressão a partir do número de tentativas recentes do mesmo ato.
 *
 * Sem isto o exploit é trivial: tentar cem vezes até sair `limpo`. Com isto,
 * insistir não converge para o sucesso limpo — converge para marcas.
 *
 * É anti-exploit sem precisar dizer "não" ao jogador, e é honesto com a
 * ficção: quem força a mesma coisa muitas vezes acaba pagando por isso no
 * corpo. O teto existe para que a pressão não vire uma segunda porta fechada.
 */
function pressureFrom(recentAttempts) {
  const n = Math.max(0, Number(recentAttempts) || 0);
  return Math.min(4, Math.floor(n / 2));
}

module.exports = {
  AFFINITIES,
  TRAITS,
  BANDS,
  OUTCOMES,
  AFFINITY_BUDGET,
  TRAIT_BUDGET,
  deriveSeed,
  generateSoul,
  band,
  bandIndex,
  corruptionResistance,
  outcomeWeights,
  resolve,
  pressureFrom
};
