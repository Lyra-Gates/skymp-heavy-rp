/**
 * core/skymp-adapter/index.js
 *
 * A fronteira declarada entre o gamemode e o motor do SkyMP.
 *
 * ─── Por que isto existe ─────────────────────────────────────────────────────
 *
 * `mp` e um global que aceita qualquer property e devolve `undefined` para
 * qualquer erro de nome. O `mp` mockado dos testes tambem. Entre os dois, uma
 * chamada errada atravessa a suite inteira sem tocar em nada.
 *
 * A auditoria de 14/08/2026 encontrou seis defeitos dessa forma
 * (docs/research/SKYMP_INTEGRATION_AUDIT.md). Cinco sao a mesma doenca: a
 * fronteira nao e um objeto, e uma convencao nao escrita.
 *
 * Este modulo cobre **so o que aquela auditoria provou instavel**:
 *
 *   - identidade  — `userId` (slot de conexao) versus `actorId` (FormID);
 *   - Papyrus     — chamada conferida contra o que o VM do servidor implementa;
 *   - capacidade  — `supports()` responde se a API existe neste servidor.
 *
 * E deliberadamente **nao** cobre `get`, `set`, `makeProperty`, `place` ou
 * `lookupEspmRecordById`. Sao estaveis, nunca deram problema, e envolve-las so
 * acrescentaria indirecao. O briefing §8 diz isso com todas as letras: adapter
 * para boundary instavel, nao wrapper para cada funcao.
 *
 * ─── Como usar ───────────────────────────────────────────────────────────────
 *
 *     const adapter = require('./core/skymp-adapter');
 *     adapter.kick(actorId);                 // converte para userId sozinho
 *     adapter.supports('espmLoadOrder');     // false num servidor antigo
 *
 * Em teste, injete o `mp` falso em vez de mexer no global:
 *
 *     const { createAdapter } = require('./core/skymp-adapter');
 *     const adapter = createAdapter({ mp: fakeMp });
 */

'use strict';

const { isKnownPapyrusFunction, UPSTREAM_COMMIT } = require('./papyrus-catalog');

/**
 * Capacidades **detectaveis**: sao metodos do objeto `mp`, entao da para
 * perguntar se existem.
 *
 * @type {Record<string, string>}
 */
const CAPABILITY_METHODS = {
  espmLoadOrder: 'getEspmLoadOrder',
  neighborsByPosition: 'getNeighborsByPosition',
  userByActor: 'getUserByActor',
  clientEventSource: 'makeEventSource',
  customPacket: 'sendCustomPacket',
  registerPapyrusFunction: 'registerPapyrusFunction',
  papyrusReflection: '_sp3GetFunctionImplementation',
  headlessBot: 'createBot',
  packetHistory: 'getPacketHistory',
  prometheusMetrics: 'getPrometheusMetrics'
};

/**
 * Capacidades **nao detectaveis**, e o motivo de cada uma.
 *
 * Hook de gamemode e property que *nos* atribuimos: `typeof mp.onDeath` e
 * sempre `'undefined'` antes de escrevermos, e sempre `'function'` depois.
 * Perguntar nao responde nada. O que se sabe vem da leitura do upstream no
 * commit fixado em `patches/manifest.json`.
 *
 * Declarar isso explicitamente e melhor que fingir deteccao: quem le sabe que
 * a resposta vem de um documento, nao do servidor.
 *
 * @type {Record<string, {value: boolean, why: string}>}
 */
const DECLARED_CAPABILITIES = {
  nativeDeathEvent: {
    value: true,
    why: 'DeathEvent.cpp registra "onDeath"; traz o assassino em killerId'
  },
  nativeRespawnEvent: {
    value: true,
    why: 'RespawnEvent.cpp registra "onRespawn"'
  },
  loginAttemptHook: {
    value: true,
    why: 'login.ts chama mp.onLoginAttempt(profileId) antes do spawn; false recusa'
  },
  equipmentVeto: {
    value: true,
    why: 'UpdateEquipmentAttemptEvent.cpp registra "onUpdateEquipmentAttempt"'
  },
  appearanceVeto: {
    value: true,
    why: 'UpdateAppearanceAttemptEvent.cpp registra "onUpdateAppearanceAttempt"'
  },
  playerSpawnHook: {
    value: false,
    why: 'spawn.ts resolve o spawn sozinho. mp._onSpawnAllowed existe mas sobrescreve-lo nao intercepta: o EventEmitter guarda a referencia da funcao original'
  },
  cellTransitionEvent: {
    value: false,
    why: 'nao ha evento de celula em gamemode_events/. Use getActorCellOrWorld ou um event source de cliente'
  },
  eslPlugins: {
    value: false,
    why: 'libespm nao trata plugin light. FormDesc::ToFormId e aritmetica de indice de um byte'
  }
};

/** Erro de fronteira: nome proprio para nao se confundir com erro de dominio. */
class SkympBoundaryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SkympBoundaryError';
  }
}

/**
 * @param {object}  [deps]
 * @param {any}     [deps.mp]      objeto `mp`; por padrao o global
 * @param {boolean} [deps.strict]  true (padrao) faz chamada Papyrus desconhecida
 *                                 lancar em vez de devolver `null` em silencio
 * @param {{warn: Function, error: Function}} [deps.logger]
 */
function createAdapter({ mp: mpApi, strict = true, logger = console } = {}) {
  // Resolvido a cada chamada, e nao na criacao: o gamemode e carregado pelo
  // SkyMP com `globalThis.mp` ja pronto, mas os testes carregam este modulo
  // antes de existir `mp` nenhum. Fixar no `require` daria `undefined` para
  // sempre.
  const mpDe = () => (mpApi !== undefined ? mpApi : (typeof mp !== 'undefined' ? mp : undefined));

  const has = (nome) => {
    const mp = mpDe();
    return Boolean(mp) && typeof mp[nome] === 'function';
  };

  /** Cache da reflexao do VM: `${callType}:${classe}.${funcao}` → boolean. */
  const cacheDeReflexao = new Map();

  /**
   * A API existe neste servidor?
   *
   * Nomes de `CAPABILITY_METHODS` sao perguntados ao `mp`. Nomes de
   * `DECLARED_CAPABILITIES` vem da leitura do upstream — ver o comentario la.
   *
   * @param {string} capability
   * @returns {boolean}
   */
  function supports(capability) {
    if (Object.prototype.hasOwnProperty.call(CAPABILITY_METHODS, capability)) {
      return has(CAPABILITY_METHODS[capability]);
    }
    if (Object.prototype.hasOwnProperty.call(DECLARED_CAPABILITIES, capability)) {
      return DECLARED_CAPABILITIES[capability].value;
    }
    throw new SkympBoundaryError(
      `capacidade desconhecida "${capability}". ` +
      'Acrescente em CAPABILITY_METHODS (detectavel) ou DECLARED_CAPABILITIES (lida do upstream).'
    );
  }

  /**
   * Por que uma capacidade e o que e. Existe para o log de boot dizer o motivo
   * em vez de so o booleano.
   *
   * @param {string} capability
   * @returns {string}
   */
  function explain(capability) {
    if (Object.prototype.hasOwnProperty.call(CAPABILITY_METHODS, capability)) {
      const metodo = CAPABILITY_METHODS[capability];
      return has(metodo)
        ? `mp.${metodo} existe`
        : `mp.${metodo} ausente neste servidor`;
    }
    if (Object.prototype.hasOwnProperty.call(DECLARED_CAPABILITIES, capability)) {
      return `${DECLARED_CAPABILITIES[capability].why} (lido em ${UPSTREAM_COMMIT.slice(0, 8)})`;
    }
    throw new SkympBoundaryError(`capacidade desconhecida "${capability}"`);
  }

  /** Todas as capacidades e seus valores. Para o log de boot. */
  function capabilities() {
    const saida = {};
    for (const nome of Object.keys(CAPABILITY_METHODS)) saida[nome] = supports(nome);
    for (const nome of Object.keys(DECLARED_CAPABILITIES)) saida[nome] = supports(nome);
    return saida;
  }

  /**
   * Desconecta o jogador **dono deste ator**.
   *
   * `mp.kick` recebe `userId` — o slot de conexao — e nao o FormID:
   *
   *     Napi::Value ScampServer::Kick(const Napi::CallbackInfo& info) {
   *       auto userId = info[0].As<Napi::Number>().Uint32Value();
   *       server->CloseConnection(userId);
   *     }
   *
   * Ator criado pelo servidor vive em 0xFF000000+. Passar isso para
   * `CloseConnection` fecha um slot que nao existe: kick de staff, permakill e
   * permadeath falhavam em silencio (auditoria §6).
   *
   * Devolve `false` quando nao havia ninguem conectado naquele ator — o que e
   * resposta legitima, nao erro.
   *
   * @param {number} actorId FormID do ator
   * @returns {boolean} true se um usuario foi desconectado
   */
  function kick(actorId) {
    const mp = mpDe();
    if (!mp || typeof mp.kick !== 'function') return false;

    if (!Number.isInteger(actorId) || actorId < 0) {
      throw new SkympBoundaryError(`kick: actorId invalido (${actorId})`);
    }

    if (!has('getUserByActor')) {
      // Sem o conversor nao da para adivinhar. Recusar e melhor que chutar:
      // chutar aqui significa desconectar a pessoa errada.
      logger.error('[skymp-adapter] mp.getUserByActor ausente — kick recusado para nao desconectar o slot errado.');
      return false;
    }

    const userId = mp.getUserByActor(actorId);
    if (!Number.isInteger(userId) || userId < 0) return false;

    mp.kick(userId);
    return true;
  }

  /**
   * Desconecta por slot de conexao, quando o `userId` ja e o que se tem —
   * `whitelist.js` e `connection-monitor.js` estao nesse caso e sempre
   * estiveram certos.
   *
   * @param {number} userId
   * @returns {boolean}
   */
  function kickUser(userId) {
    const mp = mpDe();
    if (!mp || typeof mp.kick !== 'function') return false;
    if (!Number.isInteger(userId) || userId < 0) {
      throw new SkympBoundaryError(`kickUser: userId invalido (${userId})`);
    }
    mp.kick(userId);
    return true;
  }

  /**
   * A funcao Papyrus existe neste servidor?
   *
   * Prefere a reflexao do VM em runtime — que e a verdade — e so cai para o
   * catalogo estatico quando ela nao esta disponivel. E o ponto do adaptador:
   * a resposta certa vem do servidor, nao de um arquivo nosso que envelhece.
   *
   * @param {'method'|'global'} callType
   * @param {string} className
   * @param {string} functionName
   * @returns {boolean}
   */
  function papyrusFunctionExists(callType, className, functionName) {
    const chave = `${callType}:${className}.${functionName}`.toLowerCase();
    if (cacheDeReflexao.has(chave)) return cacheDeReflexao.get(chave);

    let existe;
    if (has('_sp3GetFunctionImplementation')) {
      try {
        existe = Boolean(mpDe()._sp3GetFunctionImplementation(className, functionName, callType === 'global'));
      } catch (err) {
        logger.warn(`[skymp-adapter] reflexao do VM falhou para ${className}.${functionName}: ${err.message}`);
        existe = isKnownPapyrusFunction(callType, className, functionName);
      }
    } else {
      existe = isKnownPapyrusFunction(callType, className, functionName);
    }

    cacheDeReflexao.set(chave, existe);
    return existe;
  }

  /**
   * Chama Papyrus conferindo o nome antes.
   *
   * O VM nao lanca quando a funcao nao existe: loga e devolve `VarValue::None()`,
   * que chega ao JS como `null`. E `null <= 0` e `true` — foi assim que o
   * `death-service` passou a derrubar todo jogador conectado.
   *
   * Em `strict` (padrao), nome desconhecido **lanca**, com o nome no texto.
   * Fora de `strict`, avisa e segue — util so em diagnostico.
   *
   * @param {'method'|'global'} callType
   * @param {string} className
   * @param {string} functionName
   * @param {object|null} self  `{type, desc}`, nunca FormID cru — ver core/papyrus.js
   * @param {unknown[]} args
   */
  function callPapyrus(callType, className, functionName, self, args = []) {
    if (callType !== 'method' && callType !== 'global') {
      throw new SkympBoundaryError(`callType deve ser 'method' ou 'global', veio "${callType}"`);
    }
    const mp = mpDe();
    if (!mp || typeof mp.callPapyrusFunction !== 'function') {
      throw new SkympBoundaryError('mp.callPapyrusFunction indisponivel');
    }

    if (!papyrusFunctionExists(callType, className, functionName)) {
      const recado =
        `${className}.${functionName} nao existe no VM Papyrus do servidor. ` +
        'A chamada devolveria null em silencio. Ver docs/technical/PAPYRUS_USAGE_POLICY.md';
      if (strict) throw new SkympBoundaryError(recado);
      logger.warn(`[skymp-adapter] ${recado}`);
    }

    return mp.callPapyrusFunction(callType, className, functionName, self, args);
  }

  return {
    supports,
    explain,
    capabilities,
    kick,
    kickUser,
    callPapyrus,
    papyrusFunctionExists,
    SkympBoundaryError
  };
}

/** Instancia unica ligada ao `mp` global. Guarda o cache de reflexao do VM. */
const padrao = createAdapter();

module.exports = {
  createAdapter,
  SkympBoundaryError,
  CAPABILITY_METHODS,
  DECLARED_CAPABILITIES,

  supports: padrao.supports,
  explain: padrao.explain,
  capabilities: padrao.capabilities,
  kick: padrao.kick,
  kickUser: padrao.kickUser,
  callPapyrus: padrao.callPapyrus,
  papyrusFunctionExists: padrao.papyrusFunctionExists
};
