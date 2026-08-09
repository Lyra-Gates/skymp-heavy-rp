/**
 * core/safe-zones.js — zonas onde certas ações não valem
 *
 * ─── Atribuição de origem (LICENSE_AND_AFFILIATION_POLICY.md §4) ────────────
 *
 *   Projeto : alekcey0211/red-house-public — build pública do Red House (SkyMP)
 *   Autor   : alekcey0211 e colaboradores
 *   Licença : GPL-3.0. Compatível com a AGPL-3.0-or-later deste projeto pela
 *             GPLv3 §13; o conjunto continua distribuído sob AGPL.
 *   Commit  : 65c66bb3e1b9f5765ed5fc036d69d75e3afbb53d (branch `master`,
 *             01/11/2021 — repositório parado, último push em 16/11/2021)
 *   Origem  : `functions-lib/src/` — a checagem da property `isInSafeLocation`
 *             feita por `hitSync` antes de aplicar dano
 *   Estudo  : docs/technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md §4.1
 *
 *   **O que foi adaptado é técnica, não código.** Nenhuma linha foi copiada. O
 *   que veio de lá são duas ideias: (a) que lugar pode barrar ação, e não só
 *   estado do personagem; e (b) **a regra dos dois lados** — checar alvo *e*
 *   agressor, senão dá para atirar de dentro da zona para fora dela. Essa
 *   segunda é o achado que valia a leitura, e tem teste próprio aqui.
 *
 *   O resto diverge: lá é uma property booleana por ator, consultada dentro do
 *   cálculo de dano; aqui é config declarativa em disco (célula/raio), com
 *   categorias da `action-policy`, e o veredicto é "esta ação não vale" em vez
 *   de "este dano não se aplica". Coerente com a decisão registrada em
 *   `core/hit-events.js`: o evento de hit é evidência, nunca autoridade.
 *
 *   Registrado também no CHANGELOG.md, seção `[Não lançado]`.
 *
 * ─── De onde veio ───────────────────────────────────────────────────────────
 *
 * Do Red House (`REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1). Antes de aplicar
 * dano, eles checam uma property `isInSafeLocation` **nos dois lados** — alvo e
 * agressor — e, se qualquer um estiver em zona segura, o dano não acontece. O
 * evento ainda é registrado; só não machuca.
 *
 * Checar os dois lados é o detalhe que importa: proteger só o alvo deixa o
 * agressor atirar de dentro da zona segura para fora dela, que é o abuso
 * óbvio. Este módulo mantém a mesma regra, e o teste cobre esse caso.
 *
 * ─── O que este arquivo faz, e o que deliberadamente não faz ────────────────
 *
 * Ele responde **onde** alguém está e **o que aquele lugar proíbe**. Não decide
 * quais lugares existem: isso vem de `skymp/config/safe-zones.json`, e a lista
 * nasce vazia.
 *
 * Zona segura é mecânica de mundo, e a Constituição §15 pede que mecânica de
 * mundo responda 15 perguntas antes de existir. Estas continuam em aberto e
 * são de quem desenha o servidor, não de quem escreve o módulo:
 *
 *   - Uma cidade sob trégua é zona segura, ou trégua é acordo IC que a guarda
 *     faz cumprir? (a segunda gera história; a primeira gera regra)
 *   - Zona segura protege de roubo, ou só de dano?
 *   - O que acontece com quem já está em combate e entra numa? Fugir para
 *     dentro de uma zona segura é tática legítima ou exploit?
 *   - A área de spawn precisa ser permanente, ou só até o personagem sair da
 *     primeira cena?
 *
 * Enquanto `zones` estiver vazia, este módulo responde "não há zona nenhuma" e
 * nada muda — mesmo padrão do `npc-cleaner.js`, pelo mesmo motivo: config
 * ausente não pode virar comportamento surpresa.
 *
 * ─── Custo ──────────────────────────────────────────────────────────────────
 *
 * `mp.get(actorId, 'locationalData')` é leitura de **property**, servida do
 * cache do servidor — não é ida ao Papyrus, então não paga os 13–35 ms que o
 * Red House mediu. Por isso dá pra consultar a cada ação sem orçamento
 * especial. Se um dia isso mudar, o cache entra aqui e em nenhum outro lugar.
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '..', '..', 'config', 'safe-zones.json');

/** Categorias da action-policy que uma zona pode proibir. */
const CATEGORIAS_VALIDAS = new Set([
  'gameplay', 'combat', 'trade', 'craft', 'gather', 'move', 'move_world', 'use_item', 'speak_rp', 'sell'
]);

let _zonas = null;

/**
 * `cellId` precisa ser um `FormDesc`, não um hexadecimal.
 *
 * **[DOC]** `FormDesc.cpp` (`SKYMP_UPSTREAM_REFERENCE.md` §8.5): `ToString()` é
 * `shortFormId` em hex **sem prefixo `0x`**, `:`, nome do arquivo —
 * `"162e2:Skyrim.esm"`. É essa string que `locationalData.cellOrWorldDesc`
 * devolve, e é contra ela que `zoneOf` compara por igualdade.
 *
 * ─── Por que isto precisa ser barulhento ────────────────────────────────────
 *
 * `FormDesc::FromString` **não valida**: sem `:` ela não falha, apenas cai no
 * ramo sem arquivo e resolve para a faixa de forms gerados pelo servidor. Do
 * lado de cá o efeito é ainda mais quieto — `"0x162e2" !== "162e2:Skyrim.esm"`
 * é só uma comparação de string que nunca casa. A zona carrega, aparece nos
 * logs como ativa, e **nunca dispara**.
 *
 * Uma zona segura que falha assim falha **aberta**: a proteção não existe e não
 * há erro em lugar nenhum. É o mesmo modo de falha do `safeRadius` fantasma já
 * catalogado no `npc-cleaner`, e o oposto do que o cabeçalho deste arquivo diz
 * querer — *"config ausente não pode virar comportamento surpresa"*. Config
 * **presente e errada** é pior, porque quem escreveu acha que criou uma regra.
 *
 * O exemplo em `safe-zones.example.json` trazia `"0x162e2"` até 09/08/2026, ou
 * seja: quem copiasse o exemplo — o caminho esperado — cairia exatamente aqui.
 *
 * @param {string} cellId
 * @returns {string|null} o motivo da recusa, ou `null` se estiver bem formado
 */
function motivoDeCellIdInvalido(cellId) {
  if (/^0x/i.test(cellId)) {
    return `comeca com '0x' — FormDesc e hex SEM prefixo (use '${cellId.replace(/^0x/i, '')}:Skyrim.esm')`;
  }
  const partes = cellId.split(':');
  if (partes.length !== 2) {
    return `nao tem a forma '<hex>:<arquivo.esm>' — sem o ':' o servidor resolve para outra faixa de FormID, em silencio`;
  }
  const [hex, arquivo] = partes;
  if (!/^[0-9a-f]+$/i.test(hex)) {
    return `'${hex}' antes do ':' nao e hexadecimal`;
  }
  if (!arquivo.trim()) {
    return `falta o nome do arquivo depois do ':'`;
  }
  return null;
}

/**
 * Lê a configuração. Ausência de arquivo não é erro — a lista vazia é o
 * estado correto até alguém desenhar as zonas.
 *
 * @returns {{id: string, cellId: string, pos: number[]|null, radius: number|null, blocks: string[], label: string}[]}
 */
function loadZones() {
  if (!fs.existsSync(CONFIG_PATH)) return [];

  let bruto;
  try {
    bruto = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    // Config quebrada não pode virar "tudo é zona segura" nem "nada é":
    // a primeira desliga o combate do servidor, a segunda remove a proteção
    // sem avisar. Fica inerte e grita.
    console.error(`[safe-zones] ${CONFIG_PATH} nao e JSON valido (${err.message}). Nenhuma zona ativa.`);
    return [];
  }

  return parseZones(bruto);
}

/**
 * A validação em si, separada da leitura de disco.
 *
 * Existe separada pelo mesmo motivo do `sweepOnce(policy = loadPolicy())` do
 * `npc-cleaner`: dá para exercitar config malformada sem escrever em
 * `skymp/config/safe-zones.json`, que é o caminho real do servidor. Um teste que
 * precisasse criar aquele arquivo deixaria, se falhasse no meio, uma config de
 * zona segura ativa para trás — que é justamente a classe de surpresa que este
 * módulo existe para não causar.
 *
 * @param {object} bruto  o conteúdo já desserializado de `safe-zones.json`
 * @returns {{id: string, cellId: string, pos: number[]|null, radius: number|null, blocks: string[], label: string}[]}
 */
function parseZones(bruto) {
  if (!bruto || bruto.enabled !== true) return [];
  if (!Array.isArray(bruto.zones)) return [];

  const zonas = [];
  for (const z of bruto.zones) {
    if (!z || typeof z.cellId !== 'string' || !z.cellId.trim()) {
      console.error('[safe-zones] Zona sem cellId ignorada:', JSON.stringify(z));
      continue;
    }

    const cellId = z.cellId.trim();
    const motivo = motivoDeCellIdInvalido(cellId);
    if (motivo) {
      // Mesma disciplina da categoria desconhecida logo abaixo: a zona sai da
      // lista em vez de entrar inerte. As duas coisas protegem tanto quanto
      // (nenhuma), mas so uma delas aparece.
      console.error(
        `[safe-zones] Zona '${z.id || cellId}' tem cellId invalido: '${cellId}' — ${motivo}. ` +
        `Esperado o formato FormDesc '<hex sem 0x>:<arquivo.esm>', como '162e2:Skyrim.esm'. ` +
        `Zona IGNORADA: um cellId que nao casa nunca dispara, e uma zona segura que ` +
        `falha em silencio falha ABERTA.`
      );
      continue;
    }

    const blocks = Array.isArray(z.blocks) ? z.blocks.filter(b => CATEGORIAS_VALIDAS.has(b)) : [];
    const invalidas = Array.isArray(z.blocks) ? z.blocks.filter(b => !CATEGORIAS_VALIDAS.has(b)) : [];
    if (invalidas.length > 0) {
      // Mesma logica do admin-service.hasPermission: categoria que nao existe
      // e uma regra que quem escreveu acha que criou e nao criou.
      console.error(
        `[safe-zones] Zona '${z.id || z.cellId}' lista categoria(s) desconhecida(s): ${invalidas.join(', ')}. ` +
        `Validas: ${[...CATEGORIAS_VALIDAS].join(', ')}. Ignoradas.`
      );
    }
    if (blocks.length === 0) {
      console.error(`[safe-zones] Zona '${z.id || z.cellId}' nao proibe nada — ignorada.`);
      continue;
    }

    const raio = Number(z.radius);
    const temRaio = Array.isArray(z.pos) && z.pos.length === 3 && Number.isFinite(raio) && raio > 0;

    zonas.push({
      id: String(z.id || cellId),
      label: String(z.label || z.id || cellId),
      cellId,
      // Sem pos/radius validos, a zona e a CELULA INTEIRA. E grosseiro de
      // proposito: "a taverna toda" e uma decisao mais facil de acertar que um
      // raio em unidades do Skyrim, e nao exige medir nada in-game.
      pos: temRaio ? z.pos.map(Number) : null,
      radius: temRaio ? raio : null,
      blocks
    });
  }
  return zonas;
}

/** Recarrega do disco. Chamado no boot; exposto pra teste e pra staff. */
function reload() {
  _zonas = loadZones();
  return _zonas;
}

function zones() {
  if (_zonas === null) _zonas = loadZones();
  return _zonas;
}

/**
 * A zona que contém o ator, ou `null`.
 *
 * @param {number} actorId
 * @returns {object|null}
 */
function zoneOf(actorId) {
  const lista = zones();
  if (lista.length === 0) return null;
  if (typeof mp === 'undefined') return null;

  let loc;
  try {
    loc = mp.get(actorId, 'locationalData');
  } catch (err) {
    console.error('[safe-zones] Falha ao ler locationalData:', err.message);
    return null;
  }
  if (!loc) return null;

  const celula = loc.cellOrWorldDesc || loc.cellOrWorldSpaceId || loc.cellId || loc.worldOrCell || null;
  if (!celula) return null;

  for (const zona of lista) {
    if (zona.cellId !== celula) continue;
    if (!zona.pos) return zona; // celula inteira

    const p = loc.pos;
    if (!Array.isArray(p) || p.length < 3) continue;
    const dx = p[0] - zona.pos[0];
    const dy = p[1] - zona.pos[1];
    const dz = p[2] - zona.pos[2];
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= zona.radius) return zona;
  }
  return null;
}

/**
 * @typedef {object} VeredictoDeZona
 * @property {boolean} blocked
 * @property {object} [zone]  a zona que barrou
 * @property {'actor'|'target'} [side]  de quem é a proteção (só em blocksBetween)
 */

/**
 * A categoria está proibida para este ator, pelo lugar onde ele está?
 *
 * @param {number} actorId
 * @param {string} categoria
 * @returns {VeredictoDeZona}
 */
function blocksCategory(actorId, categoria) {
  const zona = zoneOf(actorId);
  if (!zona) return { blocked: false };
  return zona.blocks.includes(categoria) ? { blocked: true, zone: zona } : { blocked: false };
}

/**
 * A regra dos dois lados: uma ação entre duas pessoas é barrada se QUALQUER
 * uma delas estiver protegida.
 *
 * É o que impede o abuso óbvio — ficar dentro da zona segura atirando para
 * fora. O Red House já fazia assim, e o motivo é o mesmo aqui.
 *
 * @param {number} actorId    quem age
 * @param {number} targetActorId  quem sofre
 * @param {string} categoria
 * @returns {VeredictoDeZona}
 */
function blocksBetween(actorId, targetActorId, categoria) {
  const doAgressor = blocksCategory(actorId, categoria);
  if (doAgressor.blocked) return { ...doAgressor, side: 'actor' };

  const doAlvo = blocksCategory(targetActorId, categoria);
  if (doAlvo.blocked) return { ...doAlvo, side: 'target' };

  return { blocked: false };
}

module.exports = {
  CATEGORIAS_VALIDAS,
  motivoDeCellIdInvalido,
  parseZones,
  loadZones,
  reload,
  zones,
  zoneOf,
  blocksCategory,
  blocksBetween,
  // Só pra teste: injeta zonas sem precisar de arquivo em disco.
  _setZones: (z) => { _zonas = z; }
};
