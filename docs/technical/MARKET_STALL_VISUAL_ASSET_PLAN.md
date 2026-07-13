# Market Stall Visual Asset Plan

Data: 2026-07-13

## Decisao

O sistema de barracas de venda deve continuar sendo server-authoritative pelo `market-stalls-service.js`.
Mods de Skyrim podem ajudar somente como referencia visual, layout de mercado ou fonte de assets se a permissao de redistribuicao/modificacao for confirmada e registrada.

Nao usar scripts de economia, AI package, compra/venda ou inventario desses mods como dependencia de gameplay.

## Candidatos

| Mod | Link | Uso recomendado | Risco SkyMP | Decisao |
|---|---|---|---|---|
| Your Market Stall | https://www.nexusmods.com/skyrimspecialedition/mods/15814 | Referencia de fluxo de abrir barraca e vender itens | Alto: SKSE/script singleplayer/economia local | Nao depender; estudar gameplay |
| Your Market Stall Plus | https://www.nexusmods.com/skyrimspecialedition/mods/92351 | Referencia para limites por Speech/progressao de vendedor | Alto: deriva de sistema singleplayer | Nao depender; estudar progressao |
| Regional Merchants - Stalls of Skyrim | https://www.nexusmods.com/skyrimspecialedition/mods/116343 | Referencia de distribuicao regional de mercadores/barracas | Medio: adiciona NPCs/mercadores | Referencia visual/economica |
| Medieval Markets | https://www.nexusmods.com/skyrimspecialedition/mods/161479 | Layout e visual de mercados mais vivos | Medio: overhaul de mercados/cidades | Candidato visual, revisar permissao |
| Medieval Markets Animated | https://www.nexusmods.com/skyrimspecialedition/mods/161927 | Replacer animado para Medieval Markets | Medio/alto: depende do mod base | Apenas se o mod base for aprovado |
| Rally's Market Stalls Animated | https://www.nexusmods.com/skyrimspecialedition/mods/81282 | Mesh/textura de barracas vanilla, telhados animados opcionais | Medio: opcional Base Object Swapper para animado | Candidato visual leve; preferir versao sem script |
| Market Stalls Animated | https://www.nexusmods.com/skyrimspecialedition/mods/110246 | Barracas vanilla animadas | Medio: Base Object Swapper | Candidato somente apos teste com SkyMP |
| Majestic Markets | https://creations.bethesda.net/de/skyrim/details/f0950d67-8c07-4334-b157-4b9db0ed6180/Majestic_Markets | Barraca, prateleiras, stands e objetos de feira | A revisar: Creations/licenca | Referencia; nao redistribuir sem permissao |

## Pipeline aprovado

1. Escolher visual de barraca.
2. Verificar permissoes na pagina original e registrar evidencia.
3. Se permissao nao for aberta, pedir autorizacao expressa ao autor.
4. Inserir somente assets aprovados no plugin proprio `HeavyRP_Props.esm` ou equivalente.
5. Fixar FormID estavel do objeto visual de barraca.
6. Copiar `skymp/config/market-stalls.visual.example.json` para `market-stalls.visual.json`.
7. Configurar `defaultStallBaseId` com o FormID do objeto aprovado.
8. Testar com dois clientes: spawn, late join, recolhimento, troca de celula e restart.

## Configuracao runtime

Arquivo esperado:

```text
skymp/config/market-stalls.visual.json
```

Exemplo:

```json
{
  "enabled": true,
  "strategy": "server_place_static",
  "defaultStallBaseId": "0x123456",
  "fallbackDisplayName": "Barraca de Comerciante",
  "scale": 1.0
}
```

Sem esse arquivo ou com `enabled=false`, o sistema funciona apenas via banco/comandos/UI, sem objeto visual no mundo.

## Regras de compatibilidade

- O servidor cria a referencia visual preferencialmente com `Game.getFormEx` + `ObjectReference.PlaceAtMe` via `mp.callPapyrusFunction`.
- `mp.place`, quando existir em algum build custom, deve ser tratado apenas como fallback.
- A referencia visual nao decide estoque, preco, imposto ou permissao.
- O `visual_ref_id` fica salvo em `market_stalls` apenas para disable/recolhimento e diagnostico.
- Se o spawn visual falhar, a barraca ainda pode existir logicamente, mas deve gerar log.
- Nao aprovar mods que adicionem economia local, scripts de venda ou AI packages como fonte de verdade.

## Registro legal

Antes de empacotar qualquer asset no launcher, atualizar:

```text
docs/legal/ASSET_LICENSE_REGISTRY.md
```

O registro deve incluir autor, link, licenca/permissao, modificacoes realizadas e creditos obrigatorios.
