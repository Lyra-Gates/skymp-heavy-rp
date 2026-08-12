# Auditoria executiva dos forks SkyMP

Data de corte: 2026-08-12. Projeto auditado: `vinicius3232/skymp-heavy-rp`, commit `112d51b`, mais a árvore de trabalho local da branch `fix/voip-proximidade-por-celula`. A árvore estava modificada antes desta auditoria; os achados sobre o projeto principal refletem o código efetivamente presente, não apenas o último commit.

## Veredito

O Heavy RP não deve trocar de base nem importar um fork inteiro. A arquitetura atual já tem vantagens importantes: MariaDB/MySQL como fonte relacional oficial, gamemode pequeno, feature flags fail-closed, registro explícito, testes Node nativos e separação entre plataforma web e realidade in-game. Os forks mais úteis resolvem problemas diferentes:

1. **SkyrimRoleplay/skyrp**: melhor laboratório de gameplay RP integrado; adaptar propriedades, facções e seleção de personagem, sem copiar o backend acoplado.
2. **F02K/skymp**: melhor referência operacional; adaptar manifestos canônicos, SHA-256, sessões opacas, supervisor e diagnóstico.
3. **theZebco/skymp**: melhor referência de voz posicional nativa; pesquisar migração, não manter dois stacks de voz.
4. **enricomalta/skymp**: boa biblioteca de padrões de módulos, repositórios e bridge; a maioria dos domínios é protótipo/scaffold, não produção.
5. **NirnRP/skymp** e **DonAthelion/skymp**: referências pontuais de UI e APIs nativas.
6. **FusRoBra-SkyrimRP**: pesquisa útil de mineração, persistência e limitações do host; vários documentos são estudo, não implementação.
7. **Pepsiplaya/skymp**: patch especializado de save/load; relevante somente após testes de compatibilidade e corrupção.

## Baseline real do Heavy RP

| Sistema | Estado real | Arquivos | Registrado? | Funcional? | Testes? | Problemas |
|---|---|---|---:|---:|---:|---|
| Whitelist/autenticação SkyMP | ACTIVE | `whitelist.js`, `apps/web/server.js`, launcher | Sim, no fluxo base | Parcialmente integrado | Sim, web/launcher | Produção depende de configuração e vínculo externo; `offlineMode/profileId` só pode existir localmente |
| Characters | PARTIAL | `core/character-state.js`, schema, web application | Implícito | Estado e aplicação existem; seleção multi-slot não é completa | Indiretos | Identidade, sessão e slot ainda precisam de contrato único |
| Identity/nametag | PARTIAL | `identity-service.js`, `nametag-service.js` | Nametag por flag | Sim no escopo atual | Sim | Conhecimento persistente, alias e disfarce ausentes |
| RP chat | ACTIVE | `rp-chat-service.js`, `commands.js` | Sim | Sim | Sim | Escalabilidade por vizinhança precisa de benchmark |
| Governance/crime | ACTIVE | `governance-service.js`, migration v3 | Por flag | Prisões, multas e mandados implementados | Sim, inclusive hardening | Facções e cadeia institucional ainda não existem |
| Market stalls | ACTIVE | `market-stalls-service.js`, migration v4/v13 | Por flag | Compra e barracas implementadas | Sim | Alterações locais adicionam idempotência; validar integração real |
| Player panel | ACTIVE | `player-panel-service.js`, `skymp/ui/` | Por flag | Sim | Sim | UI depende de contrato de eventos ainda em hardening |
| Downed/bleed-out/respawn | ACTIVE | `death-service.js`, `core/death-events.js` | Por flag | Sim | Sim | Testes unitários não substituem sessão A/B/C |
| PK/CK/permakill | PARTIAL | `death-service.js`, `soul-service.js` | Por flags | `/permakill`/alma existem; ciclo CK completo não | Sim | Exige política, autorização e persistência transacional |
| Voz de proximidade | PARTIAL | `voip-service.js`, `voice-helper/` | Por flag | Stack UDP/helper próprio em evolução | Sim + harness | Capacidade, NAT, mute autoritativo e operação em 50+ jogadores não demonstrados |
| Staff/logs | ACTIVE | `admin-service.js`, `core/moderation-log.js`, bot Discord | Parcial | Comandos e logs existem | Sim | Auditoria de ponta a ponta e RBAC unificado ainda necessários |
| Launcher/modpack | PARTIAL | `apps/launcher`, `apps/game-api`, manifest generator | Fora do gamemode | Instalação/manifesto existem | Sim | Falta cadeia assinada comparável ao F02K e rollback comprovado |
| Economia regional | PARKED | `economy-regional.js`, transaction/ledger local | Não | Não no boot | Parcial | Trabalho local melhora boundary, mas ativação seria prematura |
| Profissões | PARKED | `jobs-service.js` | Não | Não | Ledger/permissions | Autoridade e anti-farm insuficientes |
| Crafting | PARKED | `crafting-service.js`, seed forging | Não | Não | Não específica | Precisa inventário transacional e receitas server-side |
| Propriedades | PARKED | `housing-service.js` | Não | Não | Não | Modelo antigo não deve ser ligado; faltam target resolver, grants e locks |
| Trade | PARKED | `trade-service.js` | Não | Não | Não | Risco crítico de duplicação/replay/desconexão |
| Montarias | PARKED | `horse-service.js` | Não | Não | Não | Estado compartilhado e ownership não resolvidos |
| Facções | DEAD | serviço removido; tabelas/documentação residuais | Não | Não | Não | Deve ser redesenhado, não restaurado |
| Survival | DEAD | serviço removido | Não | Não | Não | Valor de RP incerto; risco de grind |
| Disfarces | DEAD | serviço removido | Não | Não | Não | Requer primeiro knowledge graph de identidade |

`ACTIVE` aqui significa código registrado e utilizável quando sua feature flag é deliberadamente habilitada; os exemplos de ambiente deixam essas flags desligadas por padrão.

## Top 10 oportunidades

| # | Oportunidade | Origem | Decisão | Motivo |
|---:|---|---|---|---|
| 1 | Contrato de sessão opaca e ticket verificável | F02K | ADAPT / USE_NOW | Remove confiança em `profileId` fornecido pelo cliente e reduz replay |
| 2 | Manifesto canônico, hashes e verificação do client pack | F02K | ADAPT / USE_NOW | Fortalece launcher/modpack e suporte operacional |
| 3 | Property target resolver + grants revogáveis | SkyrimRoleplay | ADAPT / USE_LATER | Desbloqueia propriedades sem copiar suposições de holds |
| 4 | Membership/rank/permission resolver | SkyrimRoleplay + enricomalta | ADAPT / USE_LATER | Base para facções, governo e propriedades institucionais |
| 5 | Voz nativa LiveKit posicional | theZebco | RESEARCH_MORE | Pode resolver NAT/escala; custo e migração são altos |
| 6 | Estado de personagem e seleção de slot | SkyrimRoleplay | ADAPT | Fecha lacuna entre conta, personagem e identidade |
| 7 | Supervisor/doctor/setup reproduzível | F02K | ADAPT | Reduz drift e falhas silenciosas de operação |
| 8 | Bridge tipada e eventos de domínio | enricomalta | INSPIRE | Boa separação; não importar Mongo/Express em paralelo |
| 9 | UI desacoplada para housing/item transfer | NirnRP | INSPIRE | Reutilizar fluxos visuais, mantendo servidor autoritativo |
| 10 | Save/load diferencial e change forms | Pepsiplaya | RESEARCH_MORE | Potencial para reconnect/persistência; alto risco de corrupção |

## O que já temos e o que é melhor

- O Heavy RP já é melhor alinhado ao produto em governance, crime, downed, painel, logs, MariaDB e testes de hardening. Soluções genéricas de enricomalta nesses domínios são `DUPLICATE_EXISTING` ou apenas inspiração.
- SkyrimRoleplay é superior em profundidade de facções/propriedades e seleção de personagem.
- F02K é superior em distribuição verificável, bootstrap, supervisor e autenticação de infraestrutura.
- theZebco é tecnologicamente mais completo em transporte de voz, mas não está comprovado que seja operacionalmente melhor para este projeto sem um spike.
- NirnRP apresenta componentes visuais úteis, porém não fornece por si só regras server-authoritative.

## Mudanças arquiteturais recomendadas

1. Manter o `module-registry`, mas exigir por módulo: contrato de comandos/eventos, health check, owner, schema version e orçamento de timers.
2. Criar `Account -> Session -> Character -> Identity` como cadeia explícita; nenhum pacote de gameplay aceita `profileId`, cargo ou saldo como fato do cliente.
3. Introduzir repositórios MariaDB e transações idempotentes para qualquer mutação de inventário, ouro, propriedade ou trade.
4. Separar intent, validação, commit, audit log e projeção de UI.
5. Versionar manifesto canônico e assinado; launcher verifica tamanho/hash/ordem e suporta rollback.
6. Padronizar estado compartilhado com revisão/sequence e snapshots de reconnect.

## Maiores riscos atuais

- **SECURITY-BLOCKER AUTH-01:** qualquer caminho de produção que aceite `profileId` vindo do cliente permite spoofing. Manter `offlineMode=true` exclusivamente em artefato local.
- **SECURITY-BLOCKER ECON-01:** serviços PARKED de trade/economia/crafting não possuem evidência suficiente de atomicidade e idempotência; não habilitar.
- **SECURITY-BLOCKER UI-01:** eventos CEF são entrada hostil. O gateway/rate limiter local ainda está em alteração e precisa ser integrado e testado no runtime.
- Voz, reconnect e realidade compartilhada não têm prova de carga para 50/100/200 jogadores.
- Há divergência entre schema, migrations e código em evolução; o check de drift deve ser gate de CI.
- A árvore local contém mudanças importantes não commitadas; resultados de teste precisam ser registrados no mesmo snapshot antes de release.

## Próximas 20 tasks

1. AUTH-001 Mapear todos os emissores de identidade/profileId.
2. AUTH-002 Definir contrato de ticket opaco, TTL, nonce e audience.
3. AUTH-003 Implementar validador server-side com rotação de chave.
4. AUTH-004 Testar replay, expiração, reconnect e spoofing.
5. MOD-001 Definir manifesto canônico v1.
6. MOD-002 Gerar SHA-256 por arquivo e plugin.
7. MOD-003 Verificar manifesto no launcher antes do boot.
8. MOD-004 Criar rollback e teste de arquivo truncado.
9. CHR-001 Formalizar Account/Session/Character/Identity.
10. CHR-002 Criar seleção de slot server-authoritative.
11. FAC-001 Criar modelo de membership e invariantes.
12. FAC-002 Criar rank hierarchy e permission resolver.
13. FAC-003 Criar repository MariaDB e audit log.
14. FAC-004 Criar invite/promote/demote com testes negativos.
15. PROP-001 Criar catálogo de targets físicos.
16. PROP-002 Criar ownership/grant/key revogável.
17. PROP-003 Criar enforcement de porta/container.
18. PROP-004 Testar A/B/C, reconnect, transferência e confisco.
19. VOI-001 Executar spike comparativo UDP-helper versus LiveKit.
20. OPS-001 Criar doctor/supervisor e smoke test reproduzível.

Detalhes, dependências e critérios de pronto estão em `docs/roadmap/FORK_RESEARCH_ROADMAP.md`.

## Fontes primárias

- Código local do Heavy RP e histórico Git.
- `skyrim-multiplayer/skymp@d85f18d`.
- `SkyrimRoleplay/skyrp@83ca453`, `enricomalta/skymp@7f752f9`, `F02K/skymp@52c3478`, `NirnRP/skymp@ec41785`, `theZebco/skymp@d7e2166`, `FusRoBra-SkyrimRP@e450982`, `DonAthelion/skymp@8c7fd96`, `Pepsiplaya/skymp@5057472`.
- GitHub Compare API consultada em 2026-08-12. Números de divergência são snapshots e mudarão.
