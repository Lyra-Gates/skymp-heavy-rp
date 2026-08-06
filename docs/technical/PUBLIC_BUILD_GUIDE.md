# Guia da Build Pública

O objetivo declarado do projeto é publicar uma **build de servidor RP atual e funcional para a comunidade SkyMP**. O Red House fez isso em 2021 e ninguém refez desde — a comunidade não tem hoje nenhuma base de servidor RP aberta e atualizada.

Este documento é o que precisa estar verdadeiro antes de publicar.

---

## 1. Por que isso tem valor

Levantamento de 06/08/2026 (ver `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` e `SKYMP_UPSTREAM_REFERENCE.md`):

- **Nenhum servidor RP em SkyMP publicou gamemode próprio** além do Red House. Os três forks ativos que encontramos são cópias do upstream sem código de RP aberto.
- O **Red House está parado desde julho de 2021** e é baseado num SkyMP daquela época. Muito do que ele contorna já foi resolvido upstream.
- O **`skymp5-functions-lib`** (gamemode de referência oficial) tem o `index.ts` público, mas o `src/` **não está no repositório** — não serve como base.

Ou seja: quem quer montar um servidor RP hoje não tem de onde partir. É esse buraco que a build pública preenche.

## 2. O que vai na build

| Vai | Não vai |
|---|---|
| `skymp/gamemode` (nosso código) | Masters do Skyrim (`Skyrim.esm`, `Update.esm`, DLCs) |
| `skymp/ui` | BSAs e assets da Bethesda |
| `skymp/packages/database` (schema + migrations) | Build compilada do servidor SkyMP |
| `apps/web`, `apps/game-api`, `apps/bot-discord` | Mods de terceiros sem permissão de redistribuição |
| `apps/launcher` (código) | Qualquer `.env` real |
| `docs/`, `scripts/` | `mods.json` gerado (é por instalação) |
| `LICENSE`, avisos de não-afiliação | Chaves, tokens, `masterKey` |

**A regra que não pode ser quebrada:** o jogador precisa possuir o Skyrim. Nada da Bethesda entra no pacote — o `.gitignore` já cobre isso, e o checklist de release confere.

## 3. Exigência de AGPL §13 — o link para a fonte

Esta é a obrigação que a maioria dos projetos esquece.

A AGPL diz que, se usuários interagem com o programa **através de uma rede**, eles precisam poder obter a fonte. Um game server é exatamente isso. Não basta o repositório existir: os jogadores precisam ser informados de onde está.

Onde colocar, em ordem de importância:

1. **No launcher** — tela de "Sobre" ou rodapé, com o link do repositório e a versão/commit da build.
2. **No painel web** — rodapé de `apps/web/public`.
3. **No Discord** — canal de regras ou de informações.
4. **In-game** — o `/painel` pode carregar a versão e o link numa aba de informação.

O texto pode ser simples:

```text
Servidor rodando skymp-heavy-rp <versão> (<commit>) — software livre sob AGPL-3.0.
Código-fonte: https://github.com/vinicius3232/skymp-heavy-rp
Projeto independente, sem afiliação com Bethesda/ZeniMax/Microsoft.
```

Se você modificar a build e rodar publicamente, **o link precisa apontar pra sua versão modificada**, não pra esta. Essa é a parte que dá sentido à AGPL.

## 4. O que precisa estar pronto antes de publicar

Estado em 06/08/2026 — ver `QA_REPORT_2026-08.md` para o detalhe de cada item.

**Bloqueadores reais:**

- [ ] **Teste in-game.** Todo o gamemode está verificado só com `mp` mockado. Publicar sem uma sessão real seria publicar algo que nunca rodou. É o item 1.5 do plano.
- [ ] **`mods.json` gerado** de uma pasta `Data/` de referência, com `--plugins-txt`. Sem isso, nenhum jogador passa da verificação de paridade.
- [ ] **Instalador assinado** ou instrução clara sobre o aviso do SmartScreen. Sem assinatura, boa parte dos jogadores desiste na tela de alerta.

**Qualidade da entrega:**

- [ ] `README` com um caminho de instalação que alguém de fora consiga seguir sem contexto prévio.
- [ ] `.env.example` completo em cada serviço (já está) e um passo-a-passo de qual valor vem de onde.
- [ ] Migrations aplicáveis em ordem, do zero (`schema.sql` + v2→v8).
- [ ] Aviso de não-afiliação nos lugares da seção 3.
- [ ] Checklist de release de `LICENSE_AND_AFFILIATION_POLICY.md` §8 cumprido.

**O que torna a build útil pra outro time** (é o diferencial em relação ao Red House):

- [ ] Documentação em português **e** inglês, ao menos do README e do guia de instalação. O Red House ficou em russo e isso limitou muito o alcance dele.
- [ ] `docs/technical/` já é o ponto forte — arquitetura, contrato de mods, distribuição, API do upstream. Manter atualizado é o que mantém a build viva.
- [ ] Deixar claro **o que não está pronto**. Uma build honesta sobre suas lacunas é mais útil que uma que promete demais — e é o que diferencia de um projeto abandonado.

## 5. O que a comunidade ganha que hoje não existe

Vale enumerar, porque é o argumento da build:

- **API `mp` tipada** (`skymp/gamemode/types/mp.d.ts`) — não existe typings públicos do SkyMP em lugar nenhum.
- **Levantamento da API real** a partir dos testes oficiais (`SKYMP_UPSTREAM_REFERENCE.md`), incluindo hooks que a documentação não menciona.
- **Master API de sessão** funcionando (`apps/web`), que é o que tira a identidade das mãos do cliente — a maioria dos servidores de teste roda em `offlineMode`.
- **Economia com ledger e transação atômica** (`core/transaction-service.js`).
- **Paridade de modpack** com gerador de manifesto (`apps/game-api`).
- **Contrato mods × gamemode** documentado (`MODS_AND_GAMEMODE_CONTRACT.md`) — a pergunta "esse mod funciona no servidor?" respondida com critério.

## 6. Versionamento

Sugestão: `vMAJOR.MINOR.PATCH` com tag no git, e a tag citada no aviso da seção 3.

O `apps/launcher` já lê versão de release do GitHub para cliente e modpack (`LAUNCHER_DISTRIBUTION.md` §2) — a versão da build de servidor é separada dessas duas e deve ser dita explicitamente no README, senão vira confusão de três números diferentes.
