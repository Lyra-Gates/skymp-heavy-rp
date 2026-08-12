# TASK-002 — Reduzir ruído do typecheck no Core

**Status:** concluída; typecheck limpo em 2026-08-11  
**Dono inicial:** Core / Gamemode  
**Última atualização:** 2026-08-11

## Objetivo

O gamemode é JavaScript carregado diretamente pelo SkyMP, mas usa `tsc --checkJs`
como detector informativo de contratos. Erros no core escondem erros de integração
mais importantes, especialmente no uso da API `mp`.

## Alterações desta entrega

| Local | Mudança | Por quê |
| --- | --- | --- |
| `core/character-state.js` | Anota internamente as coleções imutáveis de estados para a checagem JS | O código já validava os valores em runtime, mas o TypeScript não conseguia inferir a união de literais |
| `core/command-registry.js` | Corrige a anotação de `opts` como opcional | O valor padrão `{}` era válido em runtime, mas contradizia a anotação anterior |
| `voip-service.js` | Isola a inferência CommonJS de `ws` na fronteira da dependência | Evita falso positivo ESM sem mudar a versão ou o comportamento do relay |
| `jsconfig.json` | Define `maxNodeModuleJsDepth: 0` | Impede que o checkJs entre no fonte JavaScript interno de `ws`; a checagem fica restrita ao contrato do gamemode |

## Resolução posterior do módulo PARKED

- `economy-regional.js`: a referência a `getMembership` passou a usar a API
  exportada da governança, agora compatível com uma conexão transacional; a
  referência inexistente a `factionInfo` foi removida pela transferência de
  tesouro atômica. Isso eliminou os três erros restantes sem ativar o módulo.
- Tipos de bibliotecas em `node_modules`: a profundidade de JavaScript de
  dependências foi fixada em zero, para que não apareçam como falhas do
  gamemode no check informativo.

## Critério de aceite

- A execução de `npm run typecheck` não lista mais erro originado por
  `core/character-state.js` ou `core/command-registry.js`.
- Não há mudança de comportamento em runtime.
- `npm run typecheck` termina sem erros.
