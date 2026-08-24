# Sistema de crafting

**Estado: LAB, desligado por padrão e pronto para homologação no jogo.** O
módulo `crafting` depende do Interaction Framework e é habilitado por
`ENABLE_CRAFTING_SERVICE`. O fluxo do jogador não usa mais comandos de chat:
`/craft` e `/receitas` foram removidos porque permitiam contornar o alvo físico.

Arquivo principal: [`crafting-service.js`](../../skymp/gamemode/crafting-service.js).

## Fluxo autoritativo

```text
objeto próximo cadastrado em crafting_stations
  → prompt [E]
  → interaction-service revalida alvo e crafting.maxDistance
  → crafting.craft recebe recipeId + requestId
  → servidor resolve formDesc → station_type
  → profissão/rank e receita são validados
  → inventory.exchange consome ingredientes e entrega resultado atomicamente
  → XP e, quando permitido, assinatura do artesão
```

O cliente nunca informa `station_type`. A migration
`v28-crafting-stations.sql` cria o cadastro `form_desc → station_type`; somente
estações habilitadas e tipos conhecidos entram no `physical-anchor-registry`.
O Interaction Framework mede a distância no servidor antes de executar a ação.

As interações registradas são:

| ID | Uso | Auditoria |
|---|---|---|
| `crafting.recipes` | lista receitas da estação resolvida | `TRACE` |
| `crafting.craft` | executa receita com `requestId` obrigatório no pipeline | `ECONOMY` |

## Atomicidade e idempotência

O craft usa uma única chamada de `inventory.exchange` com duas pernas:

```text
personagem   → system:consume  (ingredientes)
system:craft → personagem      (resultado)
```

O estoque é travado com `FOR UPDATE` pelas primitivas do Inventory Framework.
O `requestId` da interação chega intacto ao ledger; um reenvio retorna o
resultado anterior e não consome nem produz novamente. Receita sem ingrediente
é recusada.

## Profissão, perk e assinatura

`required_profession` e `required_rank` (migration v23) são o gate adotado. O
campo legado `requires_perk` não participa da autorização; esta é uma decisão
explícita. Craft livre não concede XP.

Receita vinculada a profissão concede `crafting.xpPerCraft`. A partir de
`crafting.signatureMinRank`, uma dedicatória de até 64 caracteres pode ser
gravada em `crafted_item_signatures` (migration v24). Essa gravação ocorre após
o commit do inventário: perder a assinatura por falha não perde ou duplica item.
Hoje `owner_character_id` registra quem recebeu o craft e não acompanha uma
transferência posterior.

## Administração e conteúdo

Somente os comandos administrativos permanecem:

| Comando | Permissão |
|---|---|
| `/addrecipe` | `manage_recipes` |
| `/addingredient` | `manage_recipes` |

`seed-forging.sql` contém duas receitas vanilla de fundição. A antiga receita
1003 usava o FormID inventado `999999`; foi removida do seed e a migration v28
limpa instalações existentes. Não será criada uma receita de Ferreiro sem o
FormID confirmado do modpack distribuído.

Para ativar uma estação, a operação deve inserir um FormDesc real, por exemplo:

```sql
INSERT INTO crafting_stations (form_desc, station_type)
VALUES ('<formId>:<plugin>', 'forge');
```

Tipos aceitos: `forge`, `cooking_pot`, `tanning_rack`, `alchemy_lab` e
`enchanting_table`.

## Limites e evidência restante

- não há fila/duração; isso é uma escolha de escopo;
- não há UI dedicada de receitas além da resposta da interação;
- falta cadastrar FormDescs confirmados do mundo e uma receita real de Ferreiro;
- falta homologar prompt, alcance e animação no Skyrim/SkyMP com MariaDB;
- a assinatura ainda não acompanha posse em trade, venda ou depósito.

`crafting-service.test.js` cobre resolução da estação, publicação da âncora,
descritores, alcance configurado, payload sem `station_type`, idempotência,
profissão/rank, XP, assinatura e troca atômica. As integrações de governança
cobrem a exposição da autoria em revista institucional.
