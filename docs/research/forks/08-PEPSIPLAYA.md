# 08 — Pepsiplaya/skymp

## Resumo e diferença do upstream

Snapshot `5057472` (2026-07-02): 2 commits à frente, 6 atrás, 12 arquivos divergentes. Mudanças concentradas: `SFReader`, `SFStructure`, `SFWriter`, `CombineBrowser`, `LoadGame`, auth/browser/remote server e manifest.

## Análise

O fork é uma referência especializada de save/load e change forms, não um sistema completo de personagens. Pode conter correções de leitura/escrita e integração LoadGame úteis para reconnect, mas mexe em um formato sensível a corrupção e compatibilidade binária.

## Segurança e testes exigidos

Classificação `EXPERIMENTAL`, risco `HIGH` operacional. Antes de qualquer adoção: corpus de saves por versão, round-trip byte/semantic, truncamento, unknown records, inventário com stacks/enchants, load repetido, crash recovery e reconnect A/B/C. Fuzzing do parser é obrigatório. Nunca carregar path/save arbitrário fornecido por cliente.

## Recomendação

`RESEARCH_MORE / REFERENCE_ONLY`. Comparar cada um dos 12 arquivos contra upstream e portar apenas correção mínima com teste de regressão. Licença por `TERMS.md` e `savefile/LICENSE`; preservar notices e revisar compatibilidade.
