-- v21 - Crime & Provenance: fundacao de instancia de item (Tarefa 12)
--
-- Objetivo tecnico: itens roubados (ou de alto valor, numa entrega futura)
-- deixam de ser fungiveis dentro da pilha comum (`character_inventory.count`)
-- e ganham uma linha propria em `item_instances`, com UUID e historico de
-- posse. A pilha comum continua sendo a fonte de verdade para tudo que nunca
-- foi roubado — nenhum item vira instancia so por existir.
--
-- Ver core/crime-service.js para quem le e escreve estas tabelas.

-- 1. Instancia de item rastreada (UUID)
CREATE TABLE IF NOT EXISTS `item_instances` (
  `id` CHAR(36) NOT NULL PRIMARY KEY COMMENT 'UUID v4 (crypto.randomUUID no crime-service)',
  `base_id` INT NOT NULL COMMENT 'FormID nativo do Skyrim (decimal), mesma convencao de character_inventory.base_id',
  `original_owner_id` INT NOT NULL COMMENT 'Personagem dono antes do primeiro roubo registrado; nunca muda depois',
  `current_owner_id` INT NOT NULL COMMENT 'Personagem que porta o item agora',
  `status` VARCHAR(16) NOT NULL DEFAULT 'hot' COMMENT 'hot, stolen, clean -- ver crime-service.STATUS',
  `stolen_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Momento do roubo mais recente; define a janela hot',
  `last_hold_id` VARCHAR(64) DEFAULT NULL COMMENT 'Hold onde o roubo mais recente ocorreu; usado pela Restituicao Tecnica (Depot-Service) para saber onde depositar',
  `provenance_data` JSON DEFAULT NULL COMMENT 'Historico de posse: [{ownerId, at, reason}, ...]',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_item_instance_original_owner` FOREIGN KEY (`original_owner_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_instance_current_owner` FOREIGN KEY (`current_owner_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  INDEX `idx_item_instance_current_owner` (`current_owner_id`, `status`),
  INDEX `idx_item_instance_status_stolen_at` (`status`, `stolen_at`)
) ENGINE=InnoDB;

-- 2. Anti-Combat-Log: alerta criado quando um personagem desloga portando item
-- 'hot'. Resolvido (`resolved=1`) quando o jogador volta antes da graca, ou
-- quando a Restituicao Tecnica devolve o item ao dono original.
CREATE TABLE IF NOT EXISTS `session_crime_alerts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `character_id` INT NOT NULL COMMENT 'Quem desconectou portando o item hot',
  `item_instance_id` CHAR(36) NOT NULL,
  `disconnected_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `resolved` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '0=Aguardando retorno ou restituicao, 1=Resolvido',
  `resolved_at` TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT `fk_session_alert_character` FOREIGN KEY (`character_id`) REFERENCES `characters` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_session_alert_item` FOREIGN KEY (`item_instance_id`) REFERENCES `item_instances` (`id`) ON DELETE CASCADE,
  INDEX `idx_session_alert_pending` (`resolved`, `disconnected_at`)
) ENGINE=InnoDB;

-- 3. `audit_logs` ganha a flag de crime e o vinculo com a instancia de item.
-- Toda transferencia de item instanciado grava aqui com `is_crime=1`
-- (crime-service._recordCrimeAudit), separado do ledger fungivel de
-- `inventory_transactions` (que continua registrando as mesmas duas pernas do
-- movimento, sem saber de proveniencia).
ALTER TABLE `audit_logs`
  ADD COLUMN `is_crime` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Marca acoes de crime-service; usado para filtrar o log de investigacao',
  ADD COLUMN `item_instance_id` CHAR(36) DEFAULT NULL COMMENT 'Vincula o log a instancia de item quando aplicavel',
  ADD CONSTRAINT `fk_audit_item_instance` FOREIGN KEY (`item_instance_id`) REFERENCES `item_instances` (`id`) ON DELETE SET NULL,
  ADD INDEX `idx_audit_is_crime` (`is_crime`);
