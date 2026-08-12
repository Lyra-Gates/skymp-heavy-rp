# 06 — FusRoBra-SkyrimRP

## Resumo

Repositório ativo localizado em `FusRoBra-SkyrimRP/FusRoBra-SkyrimRP`, snapshot `e450982` (2026-08-03), 1.849 arquivos. Mistura alterações reais com planos e estudos; cada item foi separado abaixo.

## Classificação

| Tema | Classe | Evidência |
|---|---|---|
| Mineração/HUD | PROTOTYPE | front inclui `MinerHud`; plano `minerador.md` |
| MongoDB driver | IMPLEMENTED/TESTED unitariamente | `MongoDatabase.cpp/.h`, `MongoDatabaseTest.cpp` |
| Backup/restore Mongo | IMPLEMENTED scripts | `scripts/mongo/*`, docs ops |
| Montaria como estado | RESEARCH | `ESTUDO-montaria-como-estado.md` |
| NPC host travado | RESEARCH | `ESTUDO-npc-host-travado.md` |
| Objetos persistentes | RESEARCH | `ESTUDO-objetos-persistentes.md` |
| Carroceiro/viagem | IDEA/RESEARCH | `viagem-carroceiro.md` |
| Magia/montaria/reloot | RESEARCH | `VIABILIDADE-magia-montaria-reloot.md` |
| Launcher/admin | RESEARCH/PLAN | `skyrp-plano/07`, `08` |

## Segurança, performance e compatibilidade

MongoDB não é compatível como banco RP do Heavy RP e não deve ser introduzido. Scripts de backup inspiram testes de restore, mas credenciais/configs exigem secret management. Mineração deve validar node, distância, cooldown, tool, ownership e reward no servidor; HUD é apenas projeção. Montaria/NPC/reloot podem causar divergência A/B/C e loops caros.

## Recomendação

`INSPIRE`: protocolo de pesquisa, restore drills e decomposição da profissão minerador. `RESEARCH_MORE`: mounts, persistent objects e NPC host. `REJECT`: migração do RP para Mongo. Não tratar estudos como backlog pronto nem código como produção. Revisar `TERMS.md`/licenças específicas antes de reutilização.
