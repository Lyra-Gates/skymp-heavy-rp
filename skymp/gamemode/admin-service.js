/**
 * admin-service.js
 * Comandos de Staff com auditoria obrigatória.
 *
 * IMPORTANTE: A autoridade de staff é derivada EXCLUSIVAMENTE da tabela `staff_roles`.
 * O campo `vip_level` em `accounts` é SOMENTE para monetização (VIP/Apoiador).
 * NUNCA usar vip_level como critério de permissão administrativa.
 */
const db = require('./database');
const commands = require('./commands');
const { actorRef } = require('./core/papyrus');

// Roles e permissões por nível
const ROLE_PERMISSIONS = {
  moderator: ['kick', 'teleport', 'view_audit', 'manage_whitelist'],
  admin:     ['kick', 'teleport', 'view_audit', 'manage_whitelist', 'ban', 'add_item', 'set_gold', 'retire_character'],
  owner:     ['kick', 'teleport', 'view_audit', 'manage_whitelist', 'ban', 'add_item', 'set_gold', 'manage_staff', 'retire_character']
};

// Cache em memória: actorId → { role, permissions: Set<string> }
// Carregado na whitelist a partir da tabela staff_roles (não de vip_level)
const staffCache = new Map();

/**
 * Carrega o cargo de staff de uma conta a partir do banco.
 * Chamado no login pelo whitelist.js.
 *
 * @param {number} actorId
 * @param {number} accountId - ID da conta (não o vip_level!)
 */
async function registerStaffRole(actorId, accountId) {
  try {
    const rows = await db.query(
      `SELECT role FROM staff_roles WHERE account_id = ?`,
      [accountId]
    );

    if (rows.length === 0) {
      // Conta não tem cargo de staff
      return;
    }

    const role = rows[0].role;
    const permissions = new Set(ROLE_PERMISSIONS[role] || []);
    staffCache.set(actorId, { role, permissions });
    console.log(`[admin] Actor ${actorId.toString(16)} registrado como staff (role: ${role}, permissões: ${[...permissions].join(', ')})`);
  } catch (err) {
    console.error(`[admin] Erro ao carregar cargo de staff para account ${accountId}:`, err.message);
  }
}

/**
 * Remove o cache de staff ao desconectar.
 * @param {number} actorId
 */
function removeStaffRole(actorId) {
  staffCache.delete(actorId);
}

/** Toda permissão que existe, derivada dos cargos. Fonte da validação abaixo. */
const KNOWN_PERMISSIONS = new Set(Object.values(ROLE_PERMISSIONS).flat());

/**
 * Verifica se um ator tem uma permissão específica.
 *
 * @param {number} actorId
 * @param {string} permission - 'kick', 'ban', 'teleport', 'add_item', 'set_gold', etc.
 * @returns {boolean}
 *
 * Sobre a validação do argumento: doze chamadas nos módulos PARKED passam um
 * NÚMERO (`hasPermission(actorId, 20)`), herança de um modelo antigo de níveis
 * de staff. Como `permissions` é um `Set` de strings, `Set.has(20)` é sempre
 * `false` — a checagem "funcionava" no sentido de nunca explodir, e negava
 * tudo em silêncio.
 *
 * Um nome de permissão que não existe é igualmente perigoso na direção
 * oposta: quem escreve `hasPermission(actorId, 'manage_factions')` acha que
 * criou uma regra, e criou uma porta que nunca abre.
 *
 * Nos dois casos preferimos gritar no log a negar caladamente. Não lançamos
 * exceção porque isso derrubaria o comando do jogador por um erro de
 * programação — negar é o resultado seguro, o log é o que faz alguém corrigir.
 */
function hasPermission(actorId, permission) {
  if (typeof permission !== 'string') {
    console.error(
      `[admin] hasPermission recebeu ${typeof permission} (${JSON.stringify(permission)}) em vez de um nome de permissão. ` +
      `Provavelmente um nível numérico legado — use um destes: ${[...KNOWN_PERMISSIONS].join(', ')}. Negando.`
    );
    return false;
  }
  if (!KNOWN_PERMISSIONS.has(permission)) {
    console.error(
      `[admin] hasPermission recebeu a permissão desconhecida '${permission}'. ` +
      `Nenhum cargo a concede, então isso nega sempre. Conhecidas: ${[...KNOWN_PERMISSIONS].join(', ')}.`
    );
    return false;
  }

  const staff = staffCache.get(actorId);
  if (!staff) return false;
  return staff.permissions.has(permission);
}

/**
 * Retorna o cargo de staff de um ator, ou null se não for staff.
 * @param {number} actorId
 * @returns {string|null}
 */
function getRole(actorId) {
  const staff = staffCache.get(actorId);
  return staff ? staff.role : null;
}

/**
 * Registra uma ação de staff no audit_log.
 */
async function auditLog(actorAccountId, targetAccountId, action, details) {
  try {
    await db.query(
      'INSERT INTO audit_logs (action, actor_account_id, target_account_id, details) VALUES (?, ?, ?, ?)',
      [action, actorAccountId, targetAccountId || null, details || null]
    );
  } catch (err) {
    console.error('[admin] Failed to write audit_log:', err.message);
  }
}

/**
 * /anim [actorId] [animName] - Reproduz animação em ator (para eventos RP)
 * Permissão: 'teleport' (nível moderador+)
 */
async function playAnimation(actorId, targetActorId, animName) {
  if (!hasPermission(actorId, 'teleport')) {
    sendDenied(actorId);
    return;
  }
  if (typeof mp !== 'undefined') {
    mp.callPapyrusFunction('method', 'Actor', 'PlayIdle', actorRef(targetActorId), [animName]);
  }
  const charData = commands.getActiveCharacterData(actorId);
  const targetData = commands.getActiveCharacterData(targetActorId);
  await auditLog(
    charData?.accountId, targetData?.accountId,
    'staff:playAnimation',
    `role=${getRole(actorId)} anim=${animName} target=${targetActorId.toString(16)}`
  );
  console.log(`[admin] ${actorId.toString(16)} (${getRole(actorId)}) played animation '${animName}' on ${targetActorId.toString(16)}`);
}

/**
 * /additem [actorId] [baseId] [count] - Entrega item a jogador (eventos, testes)
 * Permissão: 'add_item' (nível admin+)
 */
async function giveItemAdmin(actorId, targetActorId, baseId, count) {
  if (!hasPermission(actorId, 'add_item')) {
    sendDenied(actorId);
    return;
  }
  const transactionService = require('./core/transaction-service');
  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) {
    sendDenied(actorId);
    return;
  }

  const success = await transactionService.giveItem({
    actorId: targetActorId,
    characterId: targetChar.characterId,
    baseId,
    count,
    reason: 'admin_give',
    module: 'admin'
  });

  if (!success) {
    commands.sendNotification(actorId, '[Staff] Falha ao entregar item.');
    return;
  }

  const charData = commands.getActiveCharacterData(actorId);
  await auditLog(
    charData?.accountId, targetChar.accountId,
    'staff:addItem',
    `role=${getRole(actorId)} baseId=0x${baseId.toString(16)} count=${count}`
  );
  console.log(`[admin] ${actorId.toString(16)} (${getRole(actorId)}) gave 0x${baseId.toString(16)} x${count} to ${targetActorId.toString(16)}`);
}

/**
 * /tp [actorId] - Teleporta para jogador
 * Permissão: 'teleport'
 */
async function teleportTo(actorId, targetActorId) {
  if (!hasPermission(actorId, 'teleport')) {
    sendDenied(actorId);
    return;
  }
  if (typeof mp !== 'undefined') {
    const targetPos = mp.get(targetActorId, 'locationalData');
    if (targetPos) {
      mp.set(actorId, 'locationalData', targetPos);
    }
  }
  const charData = commands.getActiveCharacterData(actorId);
  await auditLog(charData?.accountId, null, 'staff:teleport', `role=${getRole(actorId)} target=${targetActorId.toString(16)}`);
}

/**
 * /kick [actorId] [motivo] - Expulsa jogador com motivo e audit
 * Permissão: 'kick'
 */
async function kickPlayer(actorId, targetActorId, reason) {
  if (!hasPermission(actorId, 'kick')) {
    sendDenied(actorId);
    return;
  }
  const charData = commands.getActiveCharacterData(actorId);
  const targetData = commands.getActiveCharacterData(targetActorId);
  await auditLog(charData?.accountId, targetData?.accountId, 'staff:kick', `role=${getRole(actorId)} reason=${reason}`);
  commands.sendNotification(targetActorId, `Você foi expulso: ${reason}`);
  if (typeof mp !== 'undefined') {
    setTimeout(() => {
      if (typeof mp !== 'undefined') mp.kick(targetActorId);
    }, 3000);
  }
  console.log(`[admin] ${actorId.toString(16)} (${getRole(actorId)}) kicked ${targetActorId.toString(16)}: ${reason}`);
}

/**
 * /setgold [actorId] [valor] - Define ouro de um jogador
 * Permissão: 'set_gold' (nível admin+)
 *
 * ─── Por que isto passou a ser um delta ─────────────────────────────────────
 *
 * A versão anterior fazia `UPDATE characters SET gold = ?` direto — sem
 * transação, sem `SELECT ... FOR UPDATE` e, principalmente, **sem linha em
 * `gold_transactions`**. Era o único caminho de dinheiro do gamemode que
 * escapava do ledger, e é exatamente o padrão que motivou apagar o
 * `economy-service.js` em 06/08/2026 (ver `CONTRIBUTING.md` §3.1 e
 * `PARKED_SERVICES_DECISION.md` §2).
 *
 * O custo não era teórico: `/setgold` é o comando que mais precisa de rastro.
 * Ouro que aparece na conta de um jogador sem nenhum registro de origem é
 * indistinguível de duplicação por bug — e a única pessoa capaz de fazer isso
 * é a staff, que é justamente de quem a auditoria precisa proteger o servidor.
 * O `audit_logs` registrava a intenção do comando; o ledger da economia não
 * registrava nada, então o saldo deixava de fechar com a soma das transações.
 *
 * `transaction-service` só move saldo por delta (é o que permite
 * `gold = gold + ?` sob lock, sem sobrescrever escrita concorrente). Um "set
 * absoluto" vira leitura + delta. A leitura fora da transação é aceitável aqui
 * e em nenhum outro lugar: se o saldo mudar entre o `getGold` e o
 * `addGold`/`removeGold`, o resultado é o valor pedido pela staff com um
 * desvio do tamanho da operação concorrente — e o ledger mostra as duas linhas,
 * então a divergência é visível em vez de silenciosa. Travar a linha por fora
 * exigiria expor a conexão do transaction-service, que é o encapsulamento que
 * mantém esse arquivo como o único lugar que sabe mexer em ouro.
 */
async function setGold(actorId, targetActorId, amount) {
  if (!hasPermission(actorId, 'set_gold')) {
    sendDenied(actorId);
    return;
  }
  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) return;

  const alvo = Number(amount);
  if (!Number.isFinite(alvo) || alvo < 0) {
    // `parseInt(parts[1])` no handler devolve NaN pra `/setgold <id>` sem
    // valor. Antes isso virava `SET gold = NaN`, que o MySQL grava como 0 —
    // um erro de digitação zerava o patrimônio do jogador em silêncio.
    commands.sendNotification(actorId, '[Staff] Valor invalido. Uso: /setgold <actorId> <valor>');
    return;
  }

  const transactionService = require('./core/transaction-service');
  const saldoAtual = await transactionService.getGold(targetChar.characterId);
  const delta = alvo - saldoAtual;

  if (delta !== 0) {
    const ok = delta > 0
      ? await transactionService.addGold({
        characterId: targetChar.characterId,
        amount: delta,
        reason: 'staff_setgold',
        module: 'admin'
      })
      : await transactionService.removeGold({
        characterId: targetChar.characterId,
        amount: -delta,
        reason: 'staff_setgold',
        module: 'admin'
      });

    if (!ok) {
      commands.sendNotification(actorId, '[Staff] Falha ao ajustar o ouro. Nada foi alterado.');
      return;
    }
  }

  commands.sendNotification(actorId, `[Staff] Ouro definido para ${alvo} Septims.`);
  const charData = commands.getActiveCharacterData(actorId);
  await auditLog(
    charData?.accountId, targetChar.accountId,
    'staff:setGold',
    `role=${getRole(actorId)} amount=${alvo} anterior=${saldoAtual} delta=${delta}`
  );
  console.log(`[admin] ${actorId.toString(16)} (${getRole(actorId)}) set gold=${alvo} (delta ${delta}) for char ${targetChar.characterId}`);
}

/**
 * /permakill [actorId] [motivo] - Aposenta (soft-delete) um personagem permanentemente.
 * Permissão: 'retire_character' (nível admin+, nunca moderador — morte permanente
 * exige revisão da staff sênior, não decisão de linha de frente).
 *
 * Nunca faz DELETE — characters.status vira 'retired'. whitelist.js só permite
 * spawn com status='approved', então um personagem retired nunca mais entra em
 * jogo, sem precisar de nenhuma outra mudança. O jogador precisa criar um
 * personagem novo (nova aplicação de whitelist).
 */
async function retireCharacter(actorId, targetActorId, reason) {
  if (!hasPermission(actorId, 'retire_character')) {
    sendDenied(actorId);
    return;
  }
  if (!reason || !reason.trim()) {
    commands.sendNotification(actorId, 'Motivo obrigatorio: /permakill <actorId> <motivo>');
    return;
  }

  const targetChar = commands.getActiveCharacterData(targetActorId);
  if (!targetChar) {
    commands.sendNotification(actorId, 'Alvo nao encontrado ou personagem nao carregado.');
    return;
  }

  await db.query('UPDATE characters SET status = ? WHERE id = ?', ['retired', targetChar.characterId]);

  const charData = commands.getActiveCharacterData(actorId);
  await auditLog(
    charData?.accountId, targetChar.accountId,
    'staff:retireCharacter',
    `role=${getRole(actorId)} characterId=${targetChar.characterId} reason=${reason}`
  );

  commands.sendNotification(targetActorId, `Seu personagem foi permanentemente encerrado pela staff. Motivo: ${reason}`);
  console.log(`[admin] ${actorId.toString(16)} (${getRole(actorId)}) retired character ${targetChar.characterId}: ${reason}`);

  if (typeof mp !== 'undefined') {
    setTimeout(() => {
      if (typeof mp !== 'undefined') mp.kick(targetActorId);
    }, 3000);
  }
}

function sendDenied(actorId) {
  commands.sendNotification(actorId, '[Staff] Permissão negada.');
}

module.exports = {
  registerStaffRole,
  removeStaffRole,
  hasPermission,
  getRole,
  auditLog,
  playAnimation,
  giveItemAdmin,
  teleportTo,
  kickPlayer,
  setGold,
  retireCharacter
};
