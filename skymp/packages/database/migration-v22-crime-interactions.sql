-- v22 - Tarefa 13: Interacoes Criminais e Autoridade de Guarda
--
-- `confiscations` JA EXISTE desde `migration-v3-governance.sql` (linha 132) —
-- verificado com `check:schema:list` antes de escrever esta migration, depois
-- de uma suposicao inicial errada de que a tabela nao existia. Esta migration
-- so ADICIONA a coluna de evidencia que a Tarefa 13 precisa: o vinculo com
-- `item_instances`, pra a Logica de Evidencia (core/crime-service.js
-- markItemConfiscated) saber qual instancia rastreada aquele confisco
-- corresponde.

ALTER TABLE `confiscations`
  ADD COLUMN `item_instance_id` CHAR(36) DEFAULT NULL COMMENT 'Vincula a item_instances (migration-v21-crime-provenance.sql) quando o item confiscado era roubado/hot',
  ADD CONSTRAINT `fk_confiscation_item_instance` FOREIGN KEY (`item_instance_id`) REFERENCES `item_instances` (`id`) ON DELETE SET NULL;
