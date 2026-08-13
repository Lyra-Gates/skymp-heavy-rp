// PARKED — ver docs/technical/PARKED_SERVICES_DECISION.md §6.
//
// Migrado em 13/08/2026 para o Inventory Framework (`core/inventory.js`).
// Migrar não é reativar: este módulo continua fora do `core/module-registry.js`.
//
// ─── O que estava errado ────────────────────────────────────────────────────
//
// `depositItem` fazia `inventoryService.removeItem()` — que **abre e commita a
// própria transação** — e só depois dois `db.query` soltos no
// `container_inventory`, sem `BEGIN` e sem lock. Se qualquer um dos dois
// falhasse, o item já tinha saído do personagem e não entrava no baú: **sumia**.
//
// É a forma do `economy-service.transfer` (apagado em 06/08/2026) e a do
// `craftItem` pré-Fase 3, agora em container. Terceira ocorrência do mesmo
// padrão — ver docs/research/INVENTORY_TRADE_CRAFTING_AUDIT.md §3.
//
// Agora as duas pontas commitam juntas, pela API que existe para isso.
const db = require('./database');
// Ver nota em economy-regional.js: ouro so pelo transaction-service.
const transactionService = require('./core/transaction-service');
const inventory = require('./core/inventory');
const commands = require('./commands');

const MODULE = 'housing';

// Cache de containers abertos para evitar conflitos concorrentes
// Chave: objectId (formDesc), Valor: { characterId, actorId, openedAt }
const openContainers = new Map();

/**
 * Depois disto, uma sessão de baú aberta é considerada abandonada.
 *
 * ─── Por que TTL e não um gancho de desconexão ──────────────────────────────
 *
 * `closeContainer` não tem nenhum chamador fora deste arquivo — grep confirma.
 * Um jogador que caísse com o baú aberto o deixava **trancado para sempre**,
 * até o restart do servidor, e nenhuma outra pessoa conseguia abrir.
 *
 * O gancho certo é o `removeActiveCharacter` do `commands.js`, e ele não pode
 * ser ligado aqui: este módulo está PARKED, e o `commands.js` não deve conhecer
 * um serviço que o `module-registry` não conhece — é exatamente o acoplamento
 * que o comentário do `governance-service` cita como a pior ideia possível.
 *
 * O TTL cura o caso sozinho, sem depender de quem desligou o módulo, e continua
 * valendo depois que o gancho existir. Quando este serviço for reativado, o
 * `initialize()` dele é que assina a desconexão.
 */
const CONTAINER_SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * Verifica se um personagem tem acesso a um container.
 * Retorna o container do banco ou null se nao tiver acesso.
 */
async function getContainerAccess(objectId, characterId) {
  const rows = await db.query('SELECT * FROM containers WHERE object_id = ?', [objectId]);
  if (rows.length === 0) {
    // Container nao registrado: qualquer um pode abrir (mundo aberto)
    return { isPublic: true };
  }

  const container = rows[0];

  // Dono tem acesso total
  if (container.owner_character_id === characterId) {
    return { ...container, isOwner: true };
  }

  // Verifica se eh convidado da propriedade associada
  const propRows = await db.query(
    `SELECT p.id FROM properties p
     INNER JOIN property_guests pg ON pg.property_id = p.id
     WHERE p.container_id = ? AND pg.guest_character_id = ?`,
    [container.id, characterId]
  );
  if (propRows.length > 0) {
    return { ...container, isGuest: true };
  }

  return null; // Sem acesso
}

/**
 * Tenta abrir um container. Intercepta a ativacao da porta/bau no servidor.
 */
async function openContainer(actorId, characterId, objectId) {
  try {
    const access = await getContainerAccess(objectId, characterId);
    if (!access) {
      if (typeof mp !== 'undefined') {
        mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Trancado. Você não tem permissão para abrir isto.']);
      }
      return false;
    }

    const sessaoAtual = openContainers.get(objectId);
    if (sessaoAtual && Date.now() - sessaoAtual.openedAt < CONTAINER_SESSION_TTL_MS) {
      if (sessaoAtual.characterId !== characterId) {
        if (typeof mp !== 'undefined') {
          mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Este container já está sendo usado por outra pessoa.']);
        }
        return false;
      }
    } else if (sessaoAtual) {
      // Sessão expirada: quem a abriu caiu, ou esqueceu o baú aberto.
      console.log(`[housing] Sessao expirada do container ${objectId} (char ${sessaoAtual.characterId}) liberada.`);
      openContainers.delete(objectId);
    }

    openContainers.set(objectId, { characterId, actorId, openedAt: Date.now() });
    console.log(`[housing] Char ${characterId} opened container ${objectId}`);

    // Injeta os itens do container na tela (UI futura ou abertura nativa)
    await syncContainerToClient(actorId, objectId);
    return true;
  } catch (err) {
    console.error(`[housing] Error opening container ${objectId}:`, err.message);
    return false;
  }
}

/**
 * Sincroniza o conteudo do container para a UI do cliente.
 */
async function syncContainerToClient(actorId, objectId) {
  const rows = await db.query(
    `SELECT ci.base_id, ci.count FROM container_inventory ci
     INNER JOIN containers c ON c.id = ci.container_id
     WHERE c.object_id = ?`,
    [objectId]
  );
  // Por ora: notifica o jogador com a contagem de itens
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Container: ${total} item(s).`]);
  }
  // No futuro: envia para a UI CEF via mp.triggerClient(actorId, 'openContainer', rows)
  console.log(`[housing] Synced container ${objectId} for actor ${actorId}: ${rows.length} item types`);
}

/**
 * Fecha o container liberando o lock.
 */
function closeContainer(objectId) {
  if (openContainers.has(objectId)) {
    openContainers.delete(objectId);
    console.log(`[housing] Container ${objectId} closed.`);
  }
}

/**
 * Confere a sessão de baú e devolve o `containers.id` do objeto, criando o
 * registro se ainda não existir.
 *
 * Forma única em vez de união discriminada, pela mesma razão explicada em
 * `core/inventory.js`: o `jsconfig.json` roda com `strictNullChecks: false` e o
 * TypeScript não estreita `{ok:true,…}|{ok:false,…}` sem ele.
 *
 * @returns {Promise<{ok: boolean, containerId: number|null, motivo: string|null}>}
 */
async function _resolveOpenContainer(characterId, objectId) {
  const recusar = (motivo) => ({ ok: false, containerId: null, motivo });

  const session = openContainers.get(objectId);
  if (!session || session.characterId !== characterId) {
    return recusar('Você precisa abrir o container primeiro.');
  }
  if (Date.now() - session.openedAt >= CONTAINER_SESSION_TTL_MS) {
    openContainers.delete(objectId);
    return recusar('A sessão do baú expirou. Abra novamente.');
  }

  let cRows = await db.query('SELECT id FROM containers WHERE object_id = ?', [objectId]);
  if (cRows.length === 0) {
    await db.query('INSERT INTO containers (object_id, owner_character_id) VALUES (?, ?)', [objectId, characterId]);
    cRows = await db.query('SELECT id FROM containers WHERE object_id = ?', [objectId]);
  }
  if (cRows.length === 0) return recusar('Não foi possível registrar este container.');

  return { ok: true, containerId: cRows[0].id, motivo: null };
}

/**
 * Transfere item do personagem para um container (depositar).
 *
 * Uma transação, duas pontas, razão nos dois lados. O `requestId` torna o
 * clique duplo idempotente: o segundo devolve o resultado do primeiro em vez de
 * depositar de novo.
 *
 * @param {number} actorId
 * @param {number} characterId
 * @param {string} objectId  formDesc do baú
 * @param {number} baseId
 * @param {number} count
 * @param {string} [requestId]
 */
async function depositItem(actorId, characterId, objectId, baseId, count, requestId) {
  const alvo = await _resolveOpenContainer(characterId, objectId);
  if (!alvo.ok) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [alvo.motivo]);
    return false;
  }

  const resultado = await inventory.transfer({
    from: inventory.character(characterId, actorId),
    to: inventory.container(alvo.containerId),
    items: [{ baseId, quantity: count }],
    reason: 'container_deposit',
    module: MODULE,
    requestId: requestId || inventory.newRequestId(`deposit.${characterId}`)
  });

  if (!resultado.ok) {
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [resultado.reason]);
    }
    return false;
  }

  console.log(`[housing] Char ${characterId} deposited ${count}x0x${Number(baseId).toString(16)} into ${objectId}`);
  return true;
}

/**
 * Transfere item do container para o personagem (retirar).
 *
 * Não existia. Um baú em que só se deposita não é um baú — e a ausência era
 * invisível porque nada chamava `depositItem` tampouco. Escrita agora porque a
 * simetria é o que torna o adaptador de container exercitável nos dois sentidos.
 */
async function withdrawItem(actorId, characterId, objectId, baseId, count, requestId) {
  const alvo = await _resolveOpenContainer(characterId, objectId);
  if (!alvo.ok) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [alvo.motivo]);
    return false;
  }

  const resultado = await inventory.transfer({
    from: inventory.container(alvo.containerId),
    to: inventory.character(characterId, actorId),
    items: [{ baseId, quantity: count }],
    reason: 'container_withdraw',
    module: MODULE,
    requestId: requestId || inventory.newRequestId(`withdraw.${characterId}`)
  });

  if (!resultado.ok) {
    if (typeof mp !== 'undefined') {
      mp.callPapyrusFunction('global', 'Debug', 'notification', null, [resultado.reason]);
    }
    return false;
  }

  console.log(`[housing] Char ${characterId} withdrew ${count}x0x${Number(baseId).toString(16)} from ${objectId}`);
  return true;
}

/**
 * Compra uma propriedade listada para venda.
 */
async function buyProperty(actorId, characterId, propertyId) {
  const propRows = await db.query('SELECT * FROM properties WHERE id = ? AND is_for_sale = 1 AND owner_character_id IS NULL', [propertyId]);
  if (propRows.length === 0) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, ['Esta propriedade não está à venda.']);
    return false;
  }

  const prop = propRows[0];
  const paid = await transactionService.removeGold({ characterId, amount: prop.price_gold, reason: 'property_purchase', module: 'housing' });
  if (!paid) {
    if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Ouro insuficiente. Preço: ${prop.price_gold} Septims.`]);
    return false;
  }

  await db.query('UPDATE properties SET owner_character_id = ?, is_for_sale = 0 WHERE id = ?', [characterId, propertyId]);
  if (typeof mp !== 'undefined') mp.callPapyrusFunction('global', 'Debug', 'notification', null, [`Você comprou "${prop.name}" por ${prop.price_gold} Septims!`]);
  console.log(`[housing] Char ${characterId} bought property ${propertyId} for ${prop.price_gold} gold.`);
  return true;
}

/**
 * Convida um personagem para uma propriedade.
 */
async function inviteToProperty(ownerCharId, targetCharId, propertyId) {
  const propRows = await db.query('SELECT id FROM properties WHERE id = ? AND owner_character_id = ?', [propertyId, ownerCharId]);
  if (propRows.length === 0) {
    return false;
  }

  await db.query(
    'INSERT IGNORE INTO property_guests (property_id, guest_character_id) VALUES (?, ?)',
    [propertyId, targetCharId]
  );
  console.log(`[housing] Char ${ownerCharId} invited Char ${targetCharId} to property ${propertyId}`);
  return true;
}

module.exports = {
  openContainer,
  closeContainer,
  depositItem,
  withdrawItem,
  buyProperty,
  inviteToProperty,
  getContainerAccess,

  // Só para teste: o TTL de sessão é tempo de relógio, e o teste precisa
  // envelhecer uma sessão sem esperar cinco minutos.
  _openContainers: openContainers,
  CONTAINER_SESSION_TTL_MS
};
