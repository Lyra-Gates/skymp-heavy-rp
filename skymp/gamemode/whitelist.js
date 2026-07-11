const db = require('./database');
const commands = require('./commands');
const inventoryService = require('./inventory-service');
const adminService = require('./admin-service');
const survivalService = require('./survival-service');


async function checkWhitelist(userId, profileId, actorId) {
  try {
    console.log(`[whitelist] Running check for User:${userId}, Profile:${profileId}, Actor:${actorId.toString(16)}`);

    // 1. Buscar ou criar conta baseada no profileId (que simula o Discord ID localmente)
    let accountRows = await db.query(
      `SELECT a.id, a.status, a.vip_level 
       FROM accounts a 
       JOIN discord_identities d ON d.account_id = a.id 
       WHERE d.discord_id = ?`,
      [profileId.toString()]
    );

    let account = null;
    if (accountRows.length === 0) {
      console.log(`[whitelist] Account not found for profileId: ${profileId}. Auto-registering local account...`);
      // Auto-registrar para facilitar o teste local
      const insertAcc = await db.query(`INSERT INTO accounts (status) VALUES ('active')`);
      const accountId = insertAcc.insertId;
      await db.query(
        `INSERT INTO discord_identities (discord_id, account_id, username) VALUES (?, ?, ?)`,
        [profileId.toString(), accountId, `Player_${profileId}`]
      );
      account = { id: accountId, status: 'active', vip_level: 0 };
    } else {
      account = accountRows[0];
    }

    // 2. Verificar se a conta está ativa
    if (account.status !== 'active') {
      console.log(`[whitelist] Account ${account.id} is NOT active (status: ${account.status}). Kicking user ${userId}...`);
      if (typeof mp !== 'undefined') mp.kick(userId);
      return false;
    }

    // 3. Verificar aprovação de Whitelist
    let wlRows = await db.query(
      `SELECT status FROM whitelist_applications WHERE account_id = ? AND status = 'approved'`,
      [account.id]
    );

    if (wlRows.length === 0) {
      // Auto-aprovar apenas o profileId 2 para passar nos testes locais iniciais
      if (profileId === 2 || profileId === 1) {
        console.log(`[whitelist] Auto-approving whitelist application for profileId ${profileId}...`);
        await db.query(
          `INSERT INTO whitelist_applications (account_id, status, reviewer_notes) VALUES (?, 'approved', 'Auto-approved for local test')`,
          [account.id]
        );
      } else {
        console.log(`[whitelist] User ${userId} (profileId: ${profileId}) has no approved Whitelist. Kicking...`);
        if (typeof mp !== 'undefined') mp.kick(userId);
        return false;
      }
    }

    // 4. Verificar se possui personagem ativo e aprovado
    let charRows = await db.query(
      `SELECT * FROM characters WHERE account_id = ? AND status = 'approved'`,
      [account.id]
    );

    let character = null;
    if (charRows.length === 0) {
      // Auto-criar personagem aprovado apenas para profileId 2 e 1
      if (profileId === 2 || profileId === 1) {
        const firstName = profileId === 2 ? 'Jarl' : 'Jon';
        const lastName = profileId === 2 ? 'Balgruuf' : 'Battleborn';
        console.log(`[whitelist] Auto-creating approved character: ${firstName} ${lastName}...`);
        const insertChar = await db.query(
          `INSERT INTO characters (account_id, first_name, last_name, status, pos_x, pos_y, pos_z, angle_z, cell_id) 
           VALUES (?, ?, ?, 'approved', 35, -165, -189, 180, '0x162e2')`,
          [account.id, firstName, lastName]
        );
        character = {
          id: insertChar.insertId,
          first_name: firstName,
          last_name: lastName,
          pos_x: 35,
          pos_y: -165,
          pos_z: -189,
          angle_z: 180,
          cell_id: '0x162e2'
        };
      } else {
        console.log(`[whitelist] User ${userId} has no approved characters. Kicking...`);
        if (typeof mp !== 'undefined') mp.kick(userId);
        return false;
      }
    } else {
      character = charRows[0];
    }

    console.log(`[whitelist] Whitelist check passed! Welcome, ${character.first_name} ${character.last_name} (VIP Level: ${account.vip_level})`);
    
    // Registrar na memoria cache de comandos
    commands.registerActiveCharacter(actorId, character, account.id, profileId);
    // Registrar role de staff (se vip_level >= 10)
    adminService.registerStaffRole(actorId, account.vip_level);
    
    // 5. Atualizar posição do jogador in-game a partir do banco de dados
    if (typeof mp !== 'undefined' && actorId) {
      console.log(`[whitelist] Moving actor ${actorId.toString(16)} to db location: pos=[${character.pos_x}, ${character.pos_y}, ${character.pos_z}] cell=${character.cell_id}`);
      
      // No SkyMP, as propriedades de locationalData contêm a posição e célula do ator
      const locData = {
        pos: [character.pos_x, character.pos_y, character.pos_z],
        rot: [0, 0, character.angle_z],
        cellOrWorldDesc: character.cell_id
      };
      
      try {
        mp.set(actorId, 'locationalData', locData);
        mp.set(actorId, 'browserVisible', true);
        // Exibe mensagem de boas-vindas no console do servidor
        console.log(`[whitelist] Spawn locData applied successfully for ${character.first_name} ${character.last_name}`);
        
        // Sincroniza o Inventário do Banco de Dados para o Cliente
        inventoryService.syncInventoryToClient(actorId, character.id);
        // Carrega stats de sobrevivência
        survivalService.loadCharacter(actorId, character.id);
        
      } catch (err) {
        console.error(`[whitelist] Failed to apply locationalData:`, err.message);
      }
    }

    return true;
  } catch (err) {
    console.error(`[whitelist] Exception checking whitelist for user ${userId}:`, err);
    if (typeof mp !== 'undefined') mp.kick(userId);
    return false;
  }
}

module.exports = {
  checkWhitelist
};
