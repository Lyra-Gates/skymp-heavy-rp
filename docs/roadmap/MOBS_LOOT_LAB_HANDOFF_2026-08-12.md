# Mobs e loot — handoff de laboratório (2026-08-12)

## Achado do boot

O primeiro boot registrou `npcEnabled option is not found ... Disabling NPCs by default`.
Portanto, neste ambiente, a hipótese de que a fauna vanilla já estava ativa era falsa por configuração: o servidor desligava todos os NPCs.

`npcEnabled: true` foi acrescentado somente às configurações locais ignoradas pelo Git:

- `skymp/config/server-settings.local.json`
- `skymp/server/server-settings.json`

O segundo boot confirmou:

- `NPCs are enabled`;
- ausência de `npcSettings` permite todos os NPCs por padrão;
- `fauna-census` ativo;
- `corpse-probe` ativo;
- TCP 3000 e UDP 7777 abertos;
- zero falhas no boot dos módulos.

O erro periódico de conexão a `127.0.0.1:3001` é o Master API não iniciado e não invalida o teste de boot do servidor.

## Como iniciar a sessão

```powershell
.\scripts\phase0\Start-Phase0Server.ps1 -EnableFaunaCensus -EnableCorpseProbe
```

`EnableCorpseProbe` é deliberadamente explícito porque a sonda escreve e restaura o inventário do cadáver. Não deve permanecer ativo fora da sessão.

## Passos dentro do jogo

1. Entrar com personagem autorizado a executar `run_world_probe`.
2. No ponto escolhido dentro do Red Wave, ao lado da cama, usar `/ondestou` para registrar a CELL, posição e rotação completas do spawn inicial.
3. Usar `/censofauna` numa área exterior com fauna.
4. Usar `/censofauna alvo <actorId>` para fixar uma criatura observada por dois clientes.
5. Matar uma criatura de teste.
6. Executar `/sondacadaver <actorId>` no cadáver.
7. Guardar o relatório produzido e o veredito `LE_E_ESCREVE`, `LE_MAS_NAO_ESCREVE` ou `NAO_LE_NAO_ESVAZIA`.
8. Encerrar o servidor; as flags não ficam persistidas pelo script.

## Gate do próximo desenvolvimento

- `LE_E_ESCREVE`: implementar loot autoritativo, esvaziando o corpo e concedendo lote atômico pelo transaction service.
- `LE_MAS_NAO_ESCREVE`: avaliar fallback `/esfolar`, deixando claro o inventário vanilla duplicado.
- `NAO_LE_NAO_ESVAZIA`: não implementar loot econômico; fauna permanece perigo/ambientação.

Nenhum `hunt-loot-service`, tabela de drop ou migration foi criado antes desse resultado, conforme o gate de `HOSTILE_MOB_ACTIVATION_DECISION.md`.
