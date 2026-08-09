/**
 * corpse-probe.js — a Peça 2 do HOSTILE_MOB_ACTIVATION_DECISION §16
 *
 * ─── A pergunta, e por que ela vem antes da feature ──────────────────────────
 *
 * **O servidor consegue ler e sobrescrever o inventário de um ator morto?**
 *
 * Loot vanilla nasce dentro do corpo, do lado do cliente, fora do
 * `core/transaction-service`. Isso é uma torneira de item sem linha no ledger,
 * sem `reason` e sem origem — o "dinheiro sem cunhagem" da §4.4, e a §11 da
 * Constituição ("nada nasce do nada") não tem como ser cumprida enquanto ela
 * existir.
 *
 * A resposta desta sonda decide entre **três desenhos incompatíveis**, e é por
 * isso que o documento é explícito: *"Nenhuma linha de `hunting-service` deve
 * ser escrita antes desta resposta."*
 *
 *   | Resposta | Desenho |
 *   |---|---|
 *   | Lê e escreve | O pedido: corpo esvaziado, loot pelo `transaction-service`, origem rastreável |
 *   | Lê, não escreve | Plano C (§14): loot por comando de RP (`/esfolar`), com dois inventários visíveis |
 *   | Não esvazia | Plano B (§14): a mecânica **perde o loot inteiro** e vira ambientação perigosa |
 *
 * ─── Procedência das APIs, e o estado delas ──────────────────────────────────
 *
 * `mp.get(id,'inventory')` / `mp.set(id,'inventory',…)` são **[DOC]** —
 * `SKYMP_UPSTREAM_REFERENCE.md` §2.5 — e **nunca foram exercitadas por este
 * projeto**. Nem o formato de retorno é conhecido: a §7.5 registra que a
 * property não está em `types/mp.d.ts` justamente porque ninguém a viu. Por isso
 * o relatório grava o retorno **verbatim**: o formato observado vale tanto
 * quanto o veredito.
 *
 * As duas vezes em que este projeto assumiu formato de API sem ver — o `self` do
 * Papyrus e o require nu de `dotenv` — custaram caro e só apareceram em jogo.
 *
 * ─── Por que a sonda restaura o inventário ───────────────────────────────────
 *
 * O passo que prova a escrita é esvaziar o corpo. Esvaziar e ir embora
 * destruiria o loot daquele cadáver sem necessidade, então a sonda **restaura o
 * conteúdo original** logo depois — e isso é ganho duplo: prova a escrita duas
 * vezes (esvaziar e repor) e devolve o mundo ao estado anterior. Se a restauração
 * falhar, o relatório diz alto, e o conteúdo original está gravado no arquivo
 * para reposição manual.
 *
 * ─── O que esta sonda nunca faz ──────────────────────────────────────────────
 *
 * **Nunca toca o inventário de um jogador.** É a única recusa dura do arquivo, e
 * é dupla: `commands.getActiveCharacterData` (personagem ativo) e a varredura de
 * `profileId` 1..50 (conectado sem personagem). Um `mp.set(…, 'inventory', …)`
 * num ator de jogador apagaria o inventário de alguém — e ao contrário de um
 * cadáver de lobo, aquilo passou pelo `transaction-service` e tem meses de jogo
 * dentro.
 */

const fs = require('fs');
const path = require('path');
const commands = require('./commands');
const admin = require('./admin-service');
const { actorRef } = require('./core/papyrus');

// Mesmo teto de npc-cleaner.js / death-service.js / fauna-census.js.
const MAX_PLAYER_PROFILE_ID = 50;

const ARTIFACTS_DIR = path.resolve(__dirname, '../artifacts');

const VAZIO = { entries: [] };

/**
 * O ator pertence a alguém conectado?
 *
 * Duas fontes de propósito. `getActiveCharacterData` cobre quem tem personagem
 * carregado; a varredura de profileId cobre quem está conectado e ainda não
 * escolheu personagem — e é a mesma que o `npc-cleaner` usa para o `safeRadius`.
 * Uma sozinha deixaria uma janela em que o ator é de gente e a sonda não sabe.
 *
 * @returns {string|null} motivo da recusa, ou null se pode prosseguir
 */
function motivoDeRecusa(actorId) {
  if (commands.getActiveCharacterData(actorId)) {
    return 'esse ator e um personagem ativo — a sonda nunca toca inventario de jogador';
  }
  if (typeof mp === 'undefined') return 'mp indisponivel';

  for (let profileId = 1; profileId <= MAX_PLAYER_PROFILE_ID; profileId++) {
    const atores = mp.getActorsByProfileId(profileId);
    if (atores && atores.includes(actorId)) {
      return `esse ator pertence ao profileId ${profileId} (jogador conectado) — recusado`;
    }
  }
  return null;
}

/**
 * Um inventário lido está vazio?
 *
 * Tolerante ao formato porque o formato é desconhecido: aceita `{entries: []}`,
 * um array nu, e o objeto vazio. Um formato que não caiba em nenhum desses casos
 * devolve `null` — "não sei dizer" —, que o veredito trata como escrita não
 * confirmada em vez de como sucesso.
 *
 * @returns {boolean|null}
 */
function _estaVazio(inventario) {
  if (inventario === null || inventario === undefined) return null;
  if (Array.isArray(inventario)) return inventario.length === 0;
  if (typeof inventario !== 'object') return null;
  if (Array.isArray(inventario.entries)) return inventario.entries.length === 0;
  if (Object.keys(inventario).length === 0) return true;
  return null;
}

/**
 * Traduz o resultado bruto no desenho que ele implica. Pura, e testada
 * diretamente: é a única regra deste arquivo, e é ela que alguém vai citar numa
 * decisão de arquitetura.
 *
 * @param {boolean} leituraOk
 * @param {boolean|null} esvaziou  `null` = formato não reconhecido
 */
function classificar(leituraOk, esvaziou) {
  if (!leituraOk && esvaziou !== true) {
    return {
      veredito: 'NAO_LE_NAO_ESVAZIA',
      desenho: 'Plano B (§14): a mecanica perde o loot inteiro e vira ambientacao perigosa. ' +
               'A profissao de Cacador volta a estaca zero.'
    };
  }
  if (esvaziou === true) {
    return {
      veredito: leituraOk ? 'LE_E_ESCREVE' : 'ESCREVE_MAS_NAO_LE',
      desenho: leituraOk
        ? 'Desenho pedido: corpo esvaziado, loot concedido pelo transaction-service, origem rastreavel.'
        : 'Escrita funciona mas a leitura nao — da pra esvaziar sem saber o que tinha. ' +
          'Suficiente para fechar a torneira, insuficiente para uma tabela de loot fiel ao vanilla.'
    };
  }
  if (esvaziou === null) {
    return {
      veredito: 'INDETERMINADO',
      desenho: 'O formato do inventario nao foi reconhecido. NAO trate como sucesso: ' +
               'leia o campo `formatoObservado` do relatorio e ajuste `_estaVazio` antes de decidir.'
    };
  }
  return {
    veredito: 'LE_MAS_NAO_ESCREVE',
    desenho: 'Plano C (§14): loot por comando de RP (/esfolar), ao custo de dois inventarios visiveis.'
  };
}

/**
 * A sonda. Quatro passos: ler, esvaziar, reler, restaurar.
 *
 * @param {number} actorId ator de um cadáver — nunca de jogador
 * @returns {object} relatório
 */
function sondar(actorId) {
  const relatorio = {
    geradoEm: new Date().toISOString(),
    origem: 'corpse-probe — mp.get/mp.set em "inventory", APIs [DOC] nunca exercitadas',
    actorId: '0x' + actorId.toString(16),
    baseDesc: null,
    recusado: null,
    passos: [],
    formatoObservado: null,
    inventarioOriginal: null,
    restaurado: null,
    veredito: null,
    desenho: null
  };

  const recusa = motivoDeRecusa(actorId);
  if (recusa) {
    relatorio.recusado = recusa;
    return relatorio;
  }

  relatorio.baseDesc = mp.get(actorId, 'baseDesc') || null;

  // Vida no momento da sonda: não é critério de recusa (um mob vivo também
  // responde a pergunta), mas muda a leitura do resultado, então vai no arquivo.
  try {
    relatorio.health = mp.callPapyrusFunction('method', 'Actor', 'getActorValue', actorRef(actorId), ['Health']);
  } catch (err) {
    relatorio.health = `erro: ${err.message}`;
  }

  // ── Passo 1: ler ──────────────────────────────────────────────────────────
  let original;
  let leituraOk = false;
  try {
    original = mp.get(actorId, 'inventory');
    leituraOk = original !== undefined && original !== null;
    relatorio.inventarioOriginal = original ?? null;
    relatorio.formatoObservado = _descreverFormato(original);
    relatorio.passos.push({ passo: 'ler', ok: leituraOk, formato: relatorio.formatoObservado });
  } catch (err) {
    relatorio.passos.push({ passo: 'ler', ok: false, erro: err.message });
  }

  // ── Passo 2: esvaziar ─────────────────────────────────────────────────────
  let escritaLancou = null;
  try {
    mp.set(actorId, 'inventory', VAZIO);
    relatorio.passos.push({ passo: 'esvaziar', ok: true, nota: 'mp.set nao lancou — falta confirmar relendo' });
  } catch (err) {
    escritaLancou = err.message;
    relatorio.passos.push({ passo: 'esvaziar', ok: false, erro: err.message });
  }

  // ── Passo 3: reler ────────────────────────────────────────────────────────
  //
  // O passo que separa "mp.set nao lancou" de "mp.set funcionou". Uma API que
  // aceita a chamada e ignora o valor em silencio e o caso mais provavel de
  // todos, e o unico que uma checagem de excecao nunca pegaria.
  let esvaziou = null;
  if (escritaLancou === null) {
    try {
      const depois = mp.get(actorId, 'inventory');
      esvaziou = _estaVazio(depois);
      relatorio.passos.push({
        passo: 'reler',
        ok: esvaziou === true,
        vazio: esvaziou,
        valor: depois ?? null
      });
    } catch (err) {
      relatorio.passos.push({ passo: 'reler', ok: false, erro: err.message });
    }
  } else {
    esvaziou = false;
  }

  // ── Passo 4: restaurar ────────────────────────────────────────────────────
  if (leituraOk && esvaziou === true) {
    try {
      mp.set(actorId, 'inventory', original);
      const conferido = mp.get(actorId, 'inventory');
      relatorio.restaurado = JSON.stringify(conferido) === JSON.stringify(original);
      relatorio.passos.push({ passo: 'restaurar', ok: relatorio.restaurado });
    } catch (err) {
      relatorio.restaurado = false;
      relatorio.passos.push({ passo: 'restaurar', ok: false, erro: err.message });
    }
    if (relatorio.restaurado === false) {
      relatorio.avisoDeRestauracao =
        'O cadaver ficou VAZIO. O conteudo original esta em `inventarioOriginal` neste arquivo.';
    }
  }

  const classificacao = classificar(leituraOk, esvaziou);
  relatorio.veredito = classificacao.veredito;
  relatorio.desenho = classificacao.desenho;

  return relatorio;
}

function _descreverFormato(valor) {
  if (valor === undefined) return 'undefined';
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return `array[${valor.length}]`;
  if (typeof valor !== 'object') return typeof valor;
  return `object{${Object.keys(valor).join(',')}}`;
}

function gravarRelatorio(relatorio) {
  try {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const carimbo = relatorio.geradoEm.replace(/[:.]/g, '-');
    const destino = path.join(ARTIFACTS_DIR, `corpse-probe-${carimbo}.json`);
    fs.writeFileSync(destino, JSON.stringify(relatorio, null, 2), 'utf8');
    return destino;
  } catch (err) {
    console.error(`[corpse-probe] Falha ao gravar relatorio: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Comando
// ─────────────────────────────────────────────────────────────────────────────

function commandDefs() {
  return [
    {
      name: ['/sondacadaver'],
      description: 'Prova do cadaver: o servidor le e sobrescreve o inventario de um ator morto? (Peça 2 da §16)',
      usage: '/sondacadaver <actorId em hex>',
      handler: (actorId, args) => {
        if (!admin.hasPermission(actorId, 'run_world_probe')) {
          commands.sendNotification(actorId, 'Sem permissao.');
          return;
        }

        const alvo = Number.parseInt(String(args || '').trim().replace(/^0x/i, ''), 16);
        if (!Number.isFinite(alvo)) {
          commands.sendNotification(actorId, 'Uso: /sondacadaver <actorId em hex>');
          return;
        }

        const relatorio = sondar(alvo);

        if (relatorio.recusado) {
          commands.sendNotification(actorId, `Recusado: ${relatorio.recusado}`);
          console.warn(`[corpse-probe] Recusado em 0x${alvo.toString(16)}: ${relatorio.recusado}`);
          return;
        }

        const destino = gravarRelatorio(relatorio);

        commands.sendNotification(actorId, `Veredito: ${relatorio.veredito}`);
        commands.sendNotification(actorId, relatorio.desenho);
        commands.sendNotification(actorId, `Formato lido: ${relatorio.formatoObservado}`);
        if (relatorio.avisoDeRestauracao) {
          commands.sendNotification(actorId, `ATENCAO: ${relatorio.avisoDeRestauracao}`);
        }
        commands.sendNotification(
          actorId,
          destino ? `Relatorio em ${destino}` : 'Relatorio NAO foi gravado — ver o log do servidor.'
        );
        console.log(`[corpse-probe] ${relatorio.veredito} em 0x${alvo.toString(16)}. Arquivo: ${destino}`);
      }
    }
  ];
}

function initCorpseProbe() {
  console.warn(
    '[corpse-probe] Sonda de cadaver carregada. Este modulo ESCREVE no inventario do ator ' +
    'sondado (e restaura em seguida). Nunca toca ator de jogador. Desligue apos a sessao.'
  );
}

module.exports = {
  commandDefs,
  initCorpseProbe,
  sondar,
  classificar,
  motivoDeRecusa,
  gravarRelatorio,
  _estaVazio,
  ARTIFACTS_DIR
};
