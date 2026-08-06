# Politica de Licenca e Nao Afiliacao

## 1. Objetivo

Evitar risco legal e operacional ao usar SkyMP, mods de terceiros e marcas de Skyrim/Elder Scrolls — e deixar claro sob que termos a nossa própria build pública é distribuída.

> Este documento é levantamento técnico feito a partir dos arquivos de licença dos projetos envolvidos. **Não é parecer jurídico.** Antes de monetizar ou de assumir compromisso contratual, consulte alguém qualificado.

## 2. A nossa licença: AGPL-3.0-or-later

O `skymp-heavy-rp` é distribuído sob **GNU Affero General Public License v3.0 ou posterior** (`LICENSE` na raiz).

**Por que AGPL e não outra coisa:**

- É a mesma licença do `skymp5-server`, que é o componente sobre o qual todo o projeto roda. Adotá-la elimina qualquer dúvida de compatibilidade.
- O objetivo declarado do projeto é ser uma **build pública e atual para a comunidade**. AGPL não nos custa nada que já não pretendíamos dar — publicar a fonte é o plano.
- AGPL protege esse objetivo: quem pegar esta base, modificar e rodar um servidor **precisa oferecer as modificações**. Sem isso, alguém pode fechar um fork e a comunidade fica com a versão pior.
- Permite aproveitar código GPL de terceiros, como o do Red House (ver `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` 4.1).

**O que isso obriga quem usa esta base:**

| Situação | Obrigação |
|---|---|
| Rodar o servidor sem modificar | Nenhuma além de manter avisos |
| Modificar e rodar servidor público | **Oferecer a fonte modificada aos jogadores** (AGPL §13) |
| Distribuir a build (ZIP, release, launcher) | Incluir a fonte ou referência de onde obtê-la |
| Usar trechos num projeto próprio | O projeto derivado também vira AGPL |

A diferença entre AGPL e GPL está na linha do meio: **GPL obriga na distribuição, AGPL obriga também no uso em rede.** Um game server é uso em rede.

## 3. Licencas do SkyMP (por subprojeto)

O SkyMP **não tem um LICENSE único na raiz** — cada subprojeto tem o seu, como o `TERMS.md` deles explica. Levantamento em 06/08/2026:

| Subprojeto | Licenca | Relevancia pra nós |
|---|---|---|
| `skymp5-server` | **AGPL-3.0** | O servidor que rodamos |
| `skymp5-client` | GPL-3.0 | Cliente |
| `skyrim-platform` | GPL-3.0 | Camada de script do cliente |
| `skymp5-front` | GPL-3.0 | UI |
| `skymp5-functions-lib` | **MIT** | O gamemode de referência deles |
| `papyrus-vm` | MIT | VM Papyrus |

**O detalhe que mais importa:** o gamemode de referência do próprio SkyMP é **MIT**, não AGPL. Os autores licenciaram a camada de gamemode de forma permissiva, o que indica que a consideram obra independente e não derivada do servidor AGPL. O nosso `skymp/gamemode` é análogo — um `.js` que o servidor carrega.

Isso significa que a escolha de AGPL para o nosso gamemode foi **nossa**, por alinhamento com o objetivo do projeto, e não uma obrigação herdada.

Regras do projeto:

- Registrar qual fork/build do SkyMP foi usado.
- Registrar qualquer modificacao feita em componentes SkyMP.
- Disponibilizar codigo-fonte quando a licenca exigir — e, no nosso caso, sempre.
- Manter avisos de copyright e licenca.
- Nao misturar codigo SkyMP em componente proprietario sem revisar licenca.

## 4. Codigo de terceiros

Antes de trazer código de outro projeto para cá:

- **Verificar a licença** e se ela é compatível com AGPL-3.0. GPL-3.0 e MIT são; Apache-2.0 é compatível com GPLv3; código sem licença **não é** (padrão legal é "todos os direitos reservados").
- **Registrar a origem** no cabeçalho do arquivo e no changelog: projeto, autor, licença, commit.
- **Manter os avisos de copyright** originais.

Caso concreto: `alekcey0211/red-house-public` é GPL-3.0. Sob AGPL-3.0 podemos aproveitar código de lá, desde que com atribuição e mantendo os avisos. O que aprendemos de lá até aqui foi **técnica**, não código copiado — ver `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` 4.1.

## 5. Mods de Terceiros

**Licença de código e licença de mod são coisas separadas.** Nossa AGPL cobre o nosso código; não dá nenhum direito sobre mods de terceiros.

Antes de incluir qualquer mod na modlist:

- Verificar permissao de redistribuicao.
- Verificar permissao de modificacao.
- Registrar autor, link, versao e termos.
- Guardar evidencia da permissao quando ela nao for publica.
- Respeitar Nexus Mods e termos do autor.

Mods sem permissao clara nao devem ser redistribuidos pelo launcher. Quando necessario, o launcher deve orientar o jogador a baixar pelo canal oficial.

**Nunca redistribuir**: masters oficiais do Skyrim (`Skyrim.esm`, `Update.esm`, DLCs), BSAs vanilla, ou qualquer asset da Bethesda. O jogador precisa possuir o jogo.

## 6. Nao Afiliacao

Todo site, launcher, Discord, tela de login e pagina publica deve conter aviso claro:

```text
Este projeto e uma iniciativa independente da comunidade. Nao e afiliado, endossado ou patrocinado pela Bethesda Softworks, ZeniMax Media, Microsoft ou qualquer detentor oficial da marca The Elder Scrolls/Skyrim. Todas as marcas pertencem aos seus respectivos proprietarios.
```

## 7. Monetizacao

Monetizacao fica fora do MVP.

Antes de qualquer monetizacao:

- Revisar licencas SkyMP.
- Revisar permissoes dos mods.
- Revisar regras da Bethesda/ZeniMax/Microsoft.
- Garantir que doacoes nao comprem vantagem in-game.
- Publicar politica transparente de custos.

Nota sobre AGPL: ela **não impede** cobrar. O que ela impede é fechar o código. Vender acesso a um servidor é permitido; negar a fonte aos jogadores não é.

## 8. Checklist de Release

- `LICENSE` presente na raiz e `"license"` correto em todo `package.json`.
- Licencas SkyMP revisadas.
- Alteracoes de fork documentadas.
- Origem e licença de todo código de terceiro registradas.
- Lista de mods com permissao documentada.
- Nenhum asset da Bethesda no pacote.
- Aviso de nao afiliacao publicado.
- Launcher nao redistribui mod sem permissao.
- Changelog inclui alteracoes relevantes.
- Link para a fonte visível aos jogadores (exigência de AGPL §13 — ver `PUBLIC_BUILD_GUIDE.md`).
