# 04 — NirnRP/skymp

## Resumo e diferença do upstream

Snapshot `ec41785`, branch default `Pospelove-patch-10` (2026-08-03): 4 commits à frente, 42 atrás, 41 arquivos divergentes. É um fork especializado, não uma base.

## Sistemas encontrados

- UI real em `adminPanel`, `animWheel`, `housingMenu`, `itemTransfer`, `skillMenu` e `housing-addon`: `FUNCTIONAL_PROTOTYPE` de apresentação.
- Extensões em `MagicApi`, `ObjectReferenceApi`, `PapyrusTESModPlatform`, `CloneAiThrottle` e `HorsePhysicsBlock`: `PARTIAL/EXPERIMENTAL`.
- Backups `.bak` dentro da árvore indicam trabalho manual/experimental e reduzem confiança de manutenção.

## Segurança, performance e compatibilidade

UI não prova enforcement. Item transfer, admin e housing devem enviar intent a um servidor autoritativo; qualquer `formId`, quantidade, target ou comando vindo do browser é hostil. APIs nativas exigem validação por versão Skyrim, thread safety, lifetime de referências e teste de clone/physics. Clone AI throttle pode melhorar performance ou introduzir dessincronização; medir A/B/C.

## Recomendação

`INSPIRE` para fluxos e componentes visuais; reimplementar no design system local. `RESEARCH_MORE` para ObjectReference/Magic/horse patches em um fork mínimo e isolado. Não copiar backend ou registrar addons sem state machine server-side. Licença raiz `TERMS.md` e licenças por subprojeto: `INSPIRE_ONLY` até revisão.
