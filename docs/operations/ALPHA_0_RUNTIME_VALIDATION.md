# Validação de runtime — Operação Alfa-0

> Documento operacional único desta operação. Registra ambiente, testes
> executados e falhas encontradas no caminho Launcher→Auth→Game API→Master
> API→SkyMP→CEF→Spawn→Gameplay→Persistência→Logout→Reconexão. Ver
> [PROJECT_STATE.md](../../PROJECT_STATE.md) pro estado geral do repositório.

## Ambiente

| Item | Valor |
|---|---|
| Máquina | Desktop Windows do dono do projeto (mesma que roda o Claude Code) |
| SO | Windows 11 Pro 10.0.26200 |
| Skyrim SE | Duas instalações Steam locais (`D:\SteamLibrary\...`, `E:\SteamLibrary\...`) — ver nota abaixo |
| MariaDB/Docker | **Ausentes nesta máquina** — `docker`/`mysqld`/`mariadbd` não estão no PATH (confirmado 27/08) |
| gamemode commit | `4075eac` no momento deste registro |
| launcher build | build NSIS de 26/08/2026 (~105 MB), handshake com cliente real ainda não exercitado |

**Nota sobre as instalações Steam locais:** nenhuma das duas é infraestrutura
deste repositório — são achados incidentais durante a investigação do
bloqueador de login (ver abaixo), úteis como evidência mas não como staging.
- `D:\...\Skyrim Special Edition` — cliente de **Skyland Roleplay**, um
  produto concorrente já citado como referência de design em
  [`LAUNCHER_UI_GUIDE.md`](../technical/LAUNCHER_UI_GUIDE.md). Fork próprio,
  não prova comportamento do `skymp5-client` vanilla.
- `E:\...\Skyrim Special Edition` — bundle sem nenhuma marca própria
  (`Data/Platform/UI/index.html` genérico, só `<script src="build.js">`),
  com nomenclatura de classe (`AuthService`, `SkympClient`,
  `SettingsService`, `NetworkingService`, `RemoteServer`) batendo com o que
  já é citado em `docs/technical/AUTH_001_TRUST_BOUNDARY_INVENTORY.md` —
  tratado aqui como o `skymp5-client` genuíno. Contém 15 logs reais de sessão
  em `Data/Platform/skymp-logs/`, datados de 07/07 a 08/07/2026, e aponta
  para um IP externo (não deste projeto) — provavelmente do mesmo "fork
  externo" já citado no CHANGELOG como fonte da descoberta de AUTH-01.

## Testes realizados

| Horário | Cliente | Passos | Resultado | Evidência |
|---|---|---|---|---|
| 27/08 | N/A (estático) | `npm test` completo do gamemode após o fix de auth-boundary abaixo | 1262/1262 PASS | saída do `node --test`, sem cliente real envolvido |
| 27/08 | N/A (estático) | `node --test skymp/ui/index.test.js` (novo, caracteriza o bootstrap) | 2/2 PASS | idem |
| 27/08 | N/A | `npm run typecheck` (gamemode) | limpo | idem |
| — | 2 clientes reais | Milestone A (login→spawn→chat→`[E]`→`/painel`→reconexão) | **BLOCKED** | precisa de MariaDB + staging + 2 instalações do NOSSO cliente, nenhum disponível nesta máquina |

**G-level honesto desta rodada: G1.** O fix abaixo tem prova de código
(bundle oficial) e prova de log real (mas de uma sessão de outro operador,
não desta máquina, e em `offlineMode: true`, não no modo `false` que a
produção usa). **Não é G2** — ninguém rodou isto contra o SkyMP real desta
stack ainda.

## Falhas

### AUTH-05 — UI de RP nunca mandava o sinal de bootstrap que o AuthService espera

- **Sintoma:** mesmo com `gameData.session` correto (AUTH-01 já corrigido) e
  o Master API resolvendo sessão corretamente, o servidor registrava
  `connections.total: 0` minutos depois do jogador parado no menu — o
  cliente nunca abria conexão de verdade.
- **Tentativa anterior (24/08, não confirmada):** `skymp/ui/index.html`
  mandava `window.skyrimPlatform.sendMessage('authAttemptEvent')`
  automaticamente ao detectar o bridge — nome capturado de um crash real,
  mas nunca confirmado como o sinal certo, e o sintoma não sumiu.
- **Causa raiz (27/08, confirmada por prova dupla):**
  1. **Prova de código** — o bundle oficial do `skymp5-client`
     (`E:\...\Data\Platform\UI\build.js`) manda, incondicionalmente, como a
     PRIMEIRA coisa depois de renderizar a raiz React (antes de qualquer
     clique):
     ```js
     if (window.skyrimPlatform?.sendMessage) window.skyrimPlatform.sendMessage('front-loaded');
     ```
  2. **Prova de log real** — `E:\...\Data\Platform\skymp5-client.log`
     (sessão de 08/07/2026) mostra a cadeia completa:
     `AuthService: onBrowserMessage: ["front-loaded"]` → `Received
     browserWindowLoaded event` → `Received authNeeded event` → (daí em
     diante o AuthService nativo decide sozinho).

     Nossa UI nunca mandava `front-loaded` — é plausível que o
     `AuthService` nativo ficasse preso antes mesmo de considerar
     `authNeeded`, independente do `gameData.session` estar certo.
- **Correção aplicada:** `skymp/ui/index.html` agora manda `'front-loaded'`
  antes de `'authAttemptEvent'` (que foi mantido, sem confirmação de que o
  modo `offlineMode: false` da produção precisa dele, mas sem custo em
  mandar). Ver comentário no próprio arquivo pra fonte completa.
- **Teste de regressão:** [`skymp/ui/index.test.js`](../../skymp/ui/index.test.js)
  (novo), rodando em CI via `.github/workflows/ci.yml` (job `higiene`).
- **Commit:** pendente (será registrado após commit).
- **Reteste em runtime real:** **BLOCKED** — precisa de dois clientes do
  NOSSO build rodando contra o NOSSO servidor, nenhum staging disponível
  nesta máquina agora. A prova de log usada aqui é de um bundle vanilla em
  `offlineMode: true`, não do fluxo `offlineMode: false` que a produção usa
  — o `authNeeded` → resolução online continua sem prova direta de log.

## Bloqueadores reais

1. **MariaDB/Docker ausentes nesta máquina** — impede montar staging
   reproduzível e testar o handshake completo (ver seção 9 do prompt mestre).
2. **Sem dois clientes do build deste projeto rodando** — as duas
   instalações Steam encontradas são de outros produtos/sessões antigas, não
   servem de staging.
3. **Prova de `authNeeded` em modo online (`offlineMode: false`) ainda
   ausente** — só temos log real do ramo offline.

## Próxima ação

Rodar o Milestone A (login → spawn → chat → `[E]` → `/painel` → reconexão)
com dois clientes reais contra esta stack, numa máquina com MariaDB
disponível — é o único jeito de confirmar se AUTH-05 realmente resolve
`connections.total: 0`, ou se falta algo mais na cadeia `authNeeded` em modo
online.
