# 09 — Outros forks

## Método

Foi consultada a lista recente de forks e o GitHub Compare contra `skyrim-multiplayer/skymp/main` em 2026-08-12. Forks sem commits próprios, behind-only, mirrors e renomes foram descartados. `ahead/behind` é snapshot, não avaliação de qualidade.

| Fork | Ahead | Behind | Arquivos divergentes | Avaliação |
|---|---:|---:|---:|---|
| reggiedroid/skymp | 17 | 1 | 39 | Maior delta adicional; `RESEARCH_MORE`, revisão de arquivos/commits antes de roadmap |
| Metadraconis/skymp-vgr | 5 | 8 | 30 | Experimentos de sync/voice; já possui estudo técnico local; `RESEARCH_MORE` |
| archofmac-png/frostmarch-server | 2 | 1 | 5 | Delta pequeno; inspecionar se corrigir gap concreto |
| GabeSMG/Scrolls_RP | 2 | 2 | 2 | Baixo volume; `REFERENCE_ONLY` |
| ELFREAL/skymp | 2 | 0 | 2 | Atual, mas delta mínimo; `REFERENCE_ONLY` |
| dotKz/skymp | 0 | 1 | 0 | Behind-only; `IGNORE` |

Outros forks recentes com `pushed_at` herdado do upstream não foram tratados como ativos sem divergência comprovada. Isso evita confundir sincronização automática com desenvolvimento próprio.

## Upstream e relação com o Heavy RP

O upstream auditado estava em `d85f18d` (2026-08-06). O Heavy RP não é um fork de source completo no layout atual: consome artefatos/APIs SkyMP e mantém gamemode/apps próprios. Portanto `ahead_by/behind_by` não descreve adequadamente sua relação. O risco real é contrato de runtime: `mp` APIs, packets, server settings, change forms, Skyrim Platform/client e artefatos nativos.

Recomendação: manter uma matriz de compatibilidade por release/commit do upstream, smoke tests do artefato e diff de APIs consumidas. Não migrar base porque um fork possui mais linhas.

## Licenças

O upstream publica `TERMS.md` e terceiros em seus registros; vários forks aparecem como `NOASSERTION` na API. Isso não significa domínio público. Copiar somente após identificar licença do arquivo/subprojeto e obrigação de source/notices. Na dúvida: `INSPIRE_ONLY`.
