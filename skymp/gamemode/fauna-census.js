/**
 * fauna-census.js — instrumento de observação, não mecânica
 *
 * ─── O que é, e o que explicitamente NÃO é ───────────────────────────────────
 *
 * É a **Peça 1** do `docs/technical/HOSTILE_MOB_ACTIVATION_DECISION.md` §16:
 * um varredor somente-leitura que percorre `mp.getActorsByProfileId(0)`, lê
 * `baseDesc` e distância, agrega por record e escreve um arquivo.
 *
 * **Não desabilita, não habilita, não apaga, não cria, não dá item e não grava
 * property nenhuma.** Não é um "ativador de mobs" — a §11.1 daquele documento
 * demole essa ideia: não há nada para ativar, porque nunca desativamos nada. O
 * `npc-cleaner` é inerte por construção (`blockedBaseDescs` vazia = não remove
 * nada) e `skymp/config/npc-policy.json` sequer existe no disco. A hipótese que
 * este arquivo existe para verificar é a inversa:
 *
 *   > O mundo provavelmente já está cheio de lobos, ursos e bandidos vanilla,
 *   > ativos e hostis, agora. Nunca desligamos nada. Nunca ninguém olhou.
 *
 * Marcada como 🟡 **hipótese não verificada** na §15. Esta é a ferramenta que a
 * verifica.
 *
 * ─── Por que é isento do portão das 15 perguntas ─────────────────────────────
 *
 * Anexo A.1(b) da Constituição: validação do que já existe não é mecânica nova.
 * É a mesma isenção que permite a Fase 0 existir. Um censo não muda decisão de
 * jogador nenhuma porque nenhum jogador o vê.
 *
 * ─── As quatro perguntas que ele precisa responder ───────────────────────────
 *
 *   1. Criaturas hostis vanilla já estão ativas?     → `porRecord`, contagem
 *   2. Quais são os `baseDesc` reais?                → `porRecord`, chaves
 *      (desbloqueia também a §4 do NPC_POLICY_DECISION, pendente desde 05/08)
 *   3. Qual a densidade real perto de onde se joga?  → `distanciaMinima`, `porFaixa`
 *   4. ⚠️ Encontros escalam por jogador?             → `/censofauna alvo <actorId>`
 *
 * A quarta é a que pode anular a §II.3 inteira, e é a única que este arquivo
 * **não responde sozinho** — ver o comentário de `inspecionarAtor()`.
 *
 * ─── Custo ───────────────────────────────────────────────────────────────────
 *
 * A varredura lê só properties (`baseDesc`, `locationalData`), servidas do cache
 * do servidor — é CPU em Node, não ida ao Papyrus. É a mesma distinção que o
 * `core/safe-zones.js` documenta e o mesmo custo que o `npc-cleaner` já paga a
 * cada 60 s. **Nenhum timer**: só roda quando alguém digita o comando, o que
 * respeita a §7.1 ("ativação de mobs hostis não pode adicionar nenhum timer
 * novo") por um caminho ainda mais barato.
 *
 * O caminho caro — `getActorValue` via Papyrus, 13–35 ms por chamada (Anexo
 * A.5) — está isolado em `inspecionarAtor()`, que roda para **um** ator por vez
 * e nunca dentro da varredura. Um censo que lesse nível de 300 atores
 * congelaria o servidor por até nove segundos.
 */

const fs = require('fs');
const path = require('path');
const commands = require('./commands');
const admin = require('./admin-service');
const rangeUtils = require('./core/range-utils');
const { actorRef } = require('./core/papyrus');

// Mesmo teto usado em npc-cleaner.js, phase0-basic.js e death-service.js. O
// censo mede o que o `npc-cleaner` enxergaria, então precisa enxergar jogador
// do mesmo jeito que ele — usar outra fonte daria um número que não conversa
// com o `safeRadius`.
const MAX_PLAYER_PROFILE_ID = 50;

const ARTIFACTS_DIR = path.resolve(__dirname, '../artifacts');

// Faixas de distância ao jogador mais próximo, em unidades do jogo. A primeira
// fronteira é o `safeRadius` padrão do `npc-cleaner` (5000) de propósito: é o
// número que decide o que aquele serviço tocaria, então o censo precisa dizer
// quantos atores caem de cada lado dele.
const FAIXAS = [
  { rotulo: 'ate 1000 (na cara do jogador)', ate: 1000 },
  { rotulo: '1000-5000 (dentro do safeRadius)', ate: 5000 },
  { rotulo: '5000-20000 (fora do safeRadius)', ate: 20000 },
  { rotulo: 'acima de 20000', ate: Infinity },
  { rotulo: 'outra celula ou sem posicao', ate: null }
];

/**
 * actorIds de jogadores conectados.
 * @returns {number[]}
 */
function _jogadoresConectados() {
  const ids = [];
  for (let profileId = 1; profileId <= MAX_PLAYER_PROFILE_ID; profileId++) {
    const atores = mp.getActorsByProfileId(profileId);
    if (atores && atores.length > 0) ids.push(...atores);
  }
  return ids;
}

/**
 * Distância ao jogador conectado mais próximo. `Infinity` quando não há
 * ninguém, ou quando todos estão em outra célula.
 */
function _distanciaAoJogadorMaisProximo(actorId, jogadores) {
  let menor = Infinity;
  for (const jogadorId of jogadores) {
    const d = rangeUtils.distanceBetween(actorId, jogadorId);
    if (d === null) continue;
    if (d < menor) menor = d;
  }
  return menor;
}

function _faixaDe(distancia) {
  if (!Number.isFinite(distancia)) return FAIXAS[FAIXAS.length - 1].rotulo;
  for (const faixa of FAIXAS) {
    if (faixa.ate !== null && distancia <= faixa.ate) return faixa.rotulo;
  }
  return FAIXAS[FAIXAS.length - 2].rotulo;
}

/**
 * Uma passada somente-leitura pelo mundo.
 *
 * Separada da escrita em disco e do comando para ser testável sem `fs` e sem
 * jogador: é aqui que mora a única regra que este arquivo tem — *olhar e não
 * tocar*.
 *
 * @param {{amostrasPorRecord?: number}} [opcoes]
 * @returns {object} relatório
 */
function levantarCenso(opcoes = {}) {
  const amostrasPorRecord = Number.isFinite(opcoes.amostrasPorRecord) ? opcoes.amostrasPorRecord : 3;

  const relatorio = {
    geradoEm: new Date().toISOString(),
    // A procedência viaja junto com o dado, como no `combat:episode`: quem ler
    // este arquivo daqui a um mês precisa saber que ele é um retrato de um
    // instante, com N jogadores conectados, e não "o mundo".
    origem: 'fauna-census — leitura de property no servidor, sem Papyrus, sem escrita',
    jogadoresConectados: 0,
    // Os três primeiros fecham: atoresSemPerfil = atoresComBaseDesc + semBaseDesc,
    // e a soma de `porFaixa` é igual a `atoresComBaseDesc`. Um censo cujos
    // números não reconciliam é um censo em que ninguém confia — e a curadoria
    // da §4 do NPC_POLICY_DECISION vai ser escrita a partir daqui.
    atoresSemPerfil: 0,
    atoresComBaseDesc: 0,
    semBaseDesc: 0,
    porRecord: {},
    // Só atores com `baseDesc`: um ator que não diz qual record é não pode
    // entrar numa contagem de densidade por record. Ele está em `semBaseDesc`.
    porFaixa: {},
    avisos: []
  };

  if (typeof mp === 'undefined') {
    relatorio.avisos.push('mp indisponivel — nada foi varrido');
    return relatorio;
  }

  const atores = mp.getActorsByProfileId(0) || [];
  const jogadores = _jogadoresConectados();

  relatorio.atoresSemPerfil = atores.length;
  relatorio.jogadoresConectados = jogadores.length;

  if (jogadores.length === 0) {
    // Sem jogador toda distância é Infinity, e a pergunta 3 ("densidade perto
    // de onde se joga") fica sem resposta. Melhor dizer isso alto do que
    // entregar um arquivo cheio de Infinity que parece um resultado.
    relatorio.avisos.push(
      'NENHUM jogador conectado: as distancias sao todas Infinity e a pergunta de densidade ' +
      'da §16 nao foi respondida. Rode de novo com alguem em jogo.'
    );
  }

  for (const rotulo of FAIXAS.map(f => f.rotulo)) relatorio.porFaixa[rotulo] = 0;

  for (const actorId of atores) {
    if (!actorId) continue;

    const baseDesc = mp.get(actorId, 'baseDesc');
    if (!baseDesc) {
      relatorio.semBaseDesc++;
      continue;
    }

    relatorio.atoresComBaseDesc++;
    const distancia = _distanciaAoJogadorMaisProximo(actorId, jogadores);
    const loc = rangeUtils.getLoc(actorId);
    const celula = rangeUtils.getCell(loc);

    let entrada = relatorio.porRecord[baseDesc];
    if (!entrada) {
      entrada = relatorio.porRecord[baseDesc] = {
        quantidade: 0,
        distanciaMinima: Infinity,
        celulas: [],
        amostraDeActorIds: []
      };
    }

    entrada.quantidade++;
    if (distancia < entrada.distanciaMinima) entrada.distanciaMinima = distancia;
    if (celula && !entrada.celulas.includes(celula)) entrada.celulas.push(celula);
    // Amostra, não lista completa: com 300 atores no mundo a lista inteira
    // torna o arquivo ilegível, e o que se faz com um actorId é apontar o
    // `/censofauna alvo` para ele — três bastam.
    if (entrada.amostraDeActorIds.length < amostrasPorRecord) {
      entrada.amostraDeActorIds.push('0x' + actorId.toString(16));
    }

    relatorio.porFaixa[_faixaDe(distancia)]++;
  }

  relatorio.recordsDistintos = Object.keys(relatorio.porRecord).length;

  // `Infinity` não sobrevive a JSON.stringify (vira null). Trocar por string
  // antes de escrever é o que impede o arquivo de mentir por omissão.
  for (const entrada of Object.values(relatorio.porRecord)) {
    if (!Number.isFinite(entrada.distanciaMinima)) {
      entrada.distanciaMinima = 'sem jogador na mesma celula';
    }
  }

  return relatorio;
}

/**
 * Grava o relatório em `skymp/artifacts/` (diretório fora do git).
 * @returns {string|null} caminho escrito, ou null se falhou
 */
function gravarRelatorio(relatorio, prefixo = 'fauna-census') {
  try {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const carimbo = relatorio.geradoEm.replace(/[:.]/g, '-');
    const destino = path.join(ARTIFACTS_DIR, `${prefixo}-${carimbo}.json`);
    fs.writeFileSync(destino, JSON.stringify(relatorio, null, 2), 'utf8');
    return destino;
  } catch (err) {
    console.error(`[fauna-census] Falha ao gravar relatorio: ${err.message}`);
    return null;
  }
}

/**
 * Leitura cara de UM ator, para a pergunta 4 da §16.
 *
 * ⚠️ **Isto sozinho não responde "encontros escalam por jogador?".** O servidor
 * tem uma leitura só; se o Skyrim escala o encontro no cliente, os dois clientes
 * mostram forças diferentes para o mesmo ator e o servidor não vê a diferença.
 *
 * O que este comando faz é **fixar a identidade do ator** — mesmo `actorId`,
 * mesmo `baseDesc` — para que A e B saibam que estão olhando a mesma criatura, e
 * registrar o que o servidor acha que ela é. A comparação que decide é entre o
 * que A vê na tela dele e o que B vê na tela dele. Ver
 * `FAUNA_CENSUS_PROTOCOL.md` passo 4.
 *
 * Custa 13–35 ms por `getActorValue` (Anexo A.5), então são poucas chamadas e
 * uma por vez, nunca em laço sobre o mundo.
 */
function inspecionarAtor(actorId) {
  const leitura = {
    actorId: '0x' + actorId.toString(16),
    baseDesc: null,
    valores: {},
    erros: []
  };

  if (typeof mp === 'undefined') {
    leitura.erros.push('mp indisponivel');
    return leitura;
  }

  leitura.baseDesc = mp.get(actorId, 'baseDesc') || null;

  for (const nome of ['Health', 'Stamina', 'Magicka', 'Level']) {
    try {
      leitura.valores[nome] = mp.callPapyrusFunction(
        'method', 'Actor', 'getActorValue', actorRef(actorId), [nome]
      );
    } catch (err) {
      leitura.erros.push(`${nome}: ${err.message}`);
    }
  }

  return leitura;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comandos
// ─────────────────────────────────────────────────────────────────────────────

function _resumoParaTela(relatorio) {
  const linhas = [
    `Censo: ${relatorio.atoresSemPerfil} ator(es) sem perfil, ` +
    `${relatorio.recordsDistintos} record(s) distinto(s), ` +
    `${relatorio.jogadoresConectados} jogador(es) conectado(s).`
  ];

  const topo = Object.entries(relatorio.porRecord)
    .sort((a, b) => b[1].quantidade - a[1].quantidade)
    .slice(0, 5);

  for (const [baseDesc, dados] of topo) {
    linhas.push(`  ${baseDesc} x${dados.quantidade} (mais perto: ${dados.distanciaMinima})`);
  }
  if (relatorio.recordsDistintos > topo.length) {
    linhas.push(`  ... e mais ${relatorio.recordsDistintos - topo.length}. O arquivo tem a lista inteira.`);
  }
  return linhas;
}

function commandDefs() {
  return [
    {
      name: ['/censofauna'],
      description: 'Censo somente-leitura dos atores do mundo (Peça 1 da §16 de HOSTILE_MOB_ACTIVATION_DECISION)',
      usage: '/censofauna | /censofauna alvo <actorId>',
      handler: (actorId, args) => {
        if (!admin.hasPermission(actorId, 'run_world_probe')) {
          commands.sendNotification(actorId, 'Sem permissao.');
          return;
        }

        const partes = String(args || '').trim().split(/\s+/).filter(Boolean);

        if (partes[0] === 'alvo') {
          const alvo = Number.parseInt(String(partes[1] || '').replace(/^0x/i, ''), 16);
          if (!Number.isFinite(alvo)) {
            commands.sendNotification(actorId, 'Uso: /censofauna alvo <actorId em hex>');
            return;
          }
          const leitura = inspecionarAtor(alvo);
          console.log('[fauna-census] Inspecao de ator:', JSON.stringify(leitura));
          commands.sendNotification(
            actorId,
            `${leitura.baseDesc || 'sem baseDesc'} — ` +
            Object.entries(leitura.valores).map(([k, v]) => `${k}=${v}`).join(' ')
          );
          commands.sendNotification(
            actorId,
            'Compare com o que a outra pessoa ve NA TELA dela para o mesmo actorId (§7.4).'
          );
          return;
        }

        const relatorio = levantarCenso();
        const destino = gravarRelatorio(relatorio);

        for (const linha of _resumoParaTela(relatorio)) {
          commands.sendNotification(actorId, linha);
        }
        for (const aviso of relatorio.avisos) {
          commands.sendNotification(actorId, `AVISO: ${aviso}`);
        }
        commands.sendNotification(
          actorId,
          destino ? `Relatorio em ${destino}` : 'Relatorio NAO foi gravado — ver o log do servidor.'
        );
        console.log(`[fauna-census] ${relatorio.atoresSemPerfil} atores, ${relatorio.recordsDistintos} records. Arquivo: ${destino}`);
      }
    },
    {
      name: ['/ondestou'],
      description: 'Mostra CELL, posicao e rotacao exatas conhecidas pelo servidor',
      usage: '/ondestou',
      handler: (actorId) => {
        if (!admin.hasPermission(actorId, 'run_world_probe')) {
          commands.sendNotification(actorId, 'Sem permissao.');
          return;
        }

        const leitura = capturarLocalizacao(actorId);
        if (!leitura.ok) {
          commands.sendNotification(actorId, `Localizacao indisponivel (${leitura.code}).`);
          return;
        }

        console.log('[fauna-census] Ponto de spawn capturado:', JSON.stringify(leitura));
        commands.sendNotification(actorId, `CELL: ${leitura.cellOrWorldDesc}`);
        commands.sendNotification(actorId, `POS: ${leitura.pos.join(', ')} ROT-Z: ${leitura.rot[2]}`);
        commands.sendNotification(actorId, 'O JSON completo foi gravado no log do servidor.');
      }
    }
  ];
}

function capturarLocalizacao(actorId) {
  if (typeof mp === 'undefined') return { ok: false, code: 'mp_indisponivel' };

  const loc = mp.get(actorId, 'locationalData');
  if (!loc || !Array.isArray(loc.pos) || loc.pos.length !== 3 || !loc.cellOrWorldDesc) {
    return { ok: false, code: 'localizacao_indisponivel' };
  }

  const pos = loc.pos.map(Number);
  const rot = Array.isArray(loc.rot) && loc.rot.length === 3 ? loc.rot.map(Number) : [0, 0, 0];
  if (![...pos, ...rot].every(Number.isFinite)) {
    return { ok: false, code: 'localizacao_invalida' };
  }

  return {
    ok: true,
    cellOrWorldDesc: String(loc.cellOrWorldDesc),
    pos,
    rot,
    startPoint: { pos, worldOrCell: String(loc.cellOrWorldDesc), angleZ: rot[2] }
  };
}

function initFaunaCensus() {
  console.log(
    '[fauna-census] Instrumento de observacao carregado. Somente leitura: ' +
    'nao desabilita, nao habilita, nao apaga e nao da item. Use /censofauna.'
  );
}

module.exports = {
  commandDefs,
  initFaunaCensus,
  levantarCenso,
  gravarRelatorio,
  inspecionarAtor,
  capturarLocalizacao,
  FAIXAS,
  ARTIFACTS_DIR
};
