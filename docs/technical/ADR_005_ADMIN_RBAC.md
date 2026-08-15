# ADR 005 — Permissão é a unidade de autorização; cargo é agrupamento, e o banco é a autoridade

**Status:** aceito · **Data:** 2026-08-13
**Autores:** sessão de Admin Platform
**Substitui:** nada. **Complementa:** [ADR 001](ADR_001_ONLINE_PROFILE_ID_IS_ACCOUNT_ID.md) (quem é a pessoa) — esta decide *o que ela pode*.
**Evidência:** [`ADMIN_PLATFORM_AUDIT.md`](../research/ADMIN_PLATFORM_AUDIT.md)
**Desdobramentos:** [`RBAC.md`](../admin/RBAC.md) · [`ADMIN_SECURITY_MATRIX.md`](../testing/ADMIN_SECURITY_MATRIX.md)

---

## 1. Contexto

A auditoria da plataforma administrativa encontrou treze achados. Quatro decidem
esta ADR:

- **§4.1** — o painel web tem um gate binário. `requireStaff` lê o cargo, guarda
  em `req.staff.role` e **nenhuma rota consulta esse valor**. Doze rotas de staff,
  zero verificações de permissão. Um `moderator` recém-promovido aprova whitelist,
  lê o ranking de ouro, a ficha criminal de todo jogador e o log de auditoria
  inteiro.
- **§4.2** — três das doze permissões declaradas não são verificadas em lugar
  nenhum: `ban`, `view_audit` e `manage_whitelist`. As duas últimas são
  exatamente as que o painel precisaria. `ban` descreve um poder que não existe.
- **§4.3** — `staff_roles.role` é `VARCHAR(32)` sem restrição. Um cargo que o
  gamemode não conhece resulta em `Set` vazio (nega tudo, em silêncio) e, na
  mesma linha do banco, em acesso total ao painel. Os cargos que este projeto
  quer criar — `SUPPORT`, `GAMEMASTER`, `DEVELOPER`, `SUPERADMIN` — caem nesse
  buraco se forem inseridos antes de haver migration.
- **§4.6** — `staff_roles` tem `UNIQUE (account_id)` e nenhuma coluna de prazo ou
  revogação. Uma pessoa, um cargo, para sempre; revogar é `DELETE`, que apaga
  junto quem concedeu e quando.

E um dado que corta a discussão sobre onde a autoridade deve morar: o mapa
cargo→permissão vive hoje numa **constante de arquivo** (`ROLE_PERMISSIONS`, em
`admin-service.js`), carregada no login e cacheada por `actorId`. Mudar quem pode
o quê exige editar código e reiniciar o servidor de jogo — com jogadores dentro.

O gamemode, isolado, tem RBAC bom: doze permissões nomeadas, matriz testada por
comportamento, recusa de nível numérico legado com log, negação avisada ao
jogador. O problema não é que falte desenho; é que o desenho existe de um lado só
e a autoridade está no lugar errado.

---

## 2. Decisão

### 2.1 O código pergunta por permissão, nunca por cargo

Não existe `if (role === 'admin')` em nenhum lugar — nem no painel, nem no
gamemode, nem em teste. A única forma de autorizar é nomear a permissão:

```js
requirePermission('whitelist.approve')          // apps/web
admin.hasPermission(actorId, 'players.kick')    // gamemode
```

Cargo é rótulo operacional e agrupamento. Ele existe para conversar ("promova
fulano a moderador") e para semear a tabela; não para decidir.

O motivo é a pergunta que uma auditoria de verdade faz: *quem pode `economy.adjust`?*
Com permissão como unidade, é um `SELECT`. Com cargo como unidade, é uma leitura
de código somada a uma leitura de banco, e as duas podem discordar — que é
exatamente o estado que esta ADR corrige.

### 2.2 O banco é a autoridade; `ROLE_PERMISSIONS` vira seed

O mapa cargo→permissão passa a viver em `staff_role_permissions`. A constante em
`admin-service.js` deixa de ser a fonte e vira o conteúdo da migration de seed.

Consequências aceitas:

- mudar quem pode o quê é uma linha auditada, não um deploy;
- o gamemode passa a depender do banco para resolver permissão no login — o que
  ele **já faz** para descobrir o cargo (`SELECT role FROM staff_roles`). A
  dependência não é nova; o conteúdo da consulta é;
- **se o banco não responder, o conjunto de permissões é vazio.** Staff sem poder
  é um problema pequeno; staff com poder vindo de um cache que ninguém consegue
  invalidar é um incidente.

### 2.3 Namespace pontuado, e as doze permissões atuais são renomeadas

`dominio.acao[.escopo]`: `players.kick`, `economy.adjust`, `logs.view.security`.

O renome é real e mecânico — a tabela completa está em
[`RBAC.md`](../admin/RBAC.md) §2.6. Ele é seguro porque `hasPermission` **já
recusa nome desconhecido com `console.error`**: uma chamada esquecida nega a ação
e grita no log, que é o comportamento mais seguro possível para um renome.

O argumento para pagar esse custo: o catálogo vai de 12 para ~40 permissões, e
nomes planos não sobrevivem a isso. `view` versus `view_audit` versus
`logs.view.security` é ilegível; `logs.view` versus `logs.view.security` se
explica sozinho. O momento certo é agora, com 15 chamadores, e não depois.

### 2.4 Sem herança entre cargos

`SUPERADMIN` não herda de `ADMIN`. Cada cargo tem conjunto explícito, ainda que
isso duplique linhas na tabela de seed.

Três razões, na ordem em que pesam:

1. **A pergunta que importa vira travessia de árvore.** "Quem pode `players.ban`?"
   deixa de ser um `SELECT` e passa a exigir que a mesma travessia esteja correta
   no painel, no gamemode, no teste e na cabeça de quem audita.
2. **Os cargos deste projeto não formam uma linha.** `GAMEMASTER` pode
   `inventory.grant`, que `MODERATOR` não pode; `MODERATOR` pode `players.kick`,
   que `GAMEMASTER` não precisa. Já é um reticulado. Forçar escada obriga a
   inventar exceções, e exceção em herança é o defeito clássico do padrão.
3. **O custo é duplicação numa tabela de seed** — barata, visível, e coberta por
   `FK` e por teste.

### 2.5 Cargo tem prazo e revogação; nunca `DELETE`

`staff_roles` ganha `expires_at`, `revoked_at`, `revoked_by_account_id` e
`revoke_reason`; perde o `UNIQUE (account_id)`, para permitir "moderador
permanente + gamemaster até domingo".

Revogar é preencher `revoked_at` com motivo. É a mesma regra que o
`CONTRIBUTING.md` §3.7 já impõe a personagem, pelo mesmo motivo: o histórico de
quem teve qual poder e quando precisa sobreviver à revogação — e é justamente
esse histórico que uma arbitragem contestada vai pedir.

**A ordem da migração importa e está declarada** em [`RBAC.md`](../admin/RBAC.md) §5.3:
soltar o `UNIQUE` antes de trocar as duas leituras de `LIMIT 1` faria a segunda
linha de cargo ser ignorada em silêncio — a pessoa recebe metade do poder
concedido e ninguém vê erro.

### 2.6 Override por pessoa existe, é temporário por padrão, e `deny` vence

`staff_permission_overrides` cobre o caso raro — dar `world.probe` a um developer
por uma tarde, ou tirar `economy.adjust` de alguém sob investigação sem remover o
cargo. Motivo obrigatório, `expires_at` esperado, e **negação sempre vence
concessão**, para que suspender uma capacidade não possa ser contornado somando
outro cargo.

### 2.7 Discord sugere; o banco decide

Cargo do Discord nunca vira, sozinho, linha em `staff_roles`, e nunca vira
permissão em jogo. Se o caminho de sugestão for construído, ele produz uma
proposta que um `SUPERADMIN` confirma com motivo.

Razões: quem administra o Discord não é necessariamente quem administra o jogo;
cargo do Discord é editável por qualquer um com `MANAGE_ROLES` numa superfície
que este projeto não controla; e um outage do Discord não pode alterar quem pode
banir no servidor.

### 2.8 Negar é auditado

Toda negação — `403` do painel e `sendDenied()` do gamemode — grava
`audit_logs` com `outcome='denied'`, a permissão pedida e o `request_id`.

Hoje nenhuma das duas grava nada. Sem isso, "alguém está sondando permissões que
não tem" é invisível, e esse é precisamente o sinal que se quer ver **antes** de
um incidente, não na análise post-mortem.

---

## 3. `staff_permissions` é descontinuada

A tabela existe no `schema.sql`, está vazia, e a `PARKED_SERVICES_DECISION.md`
§237 já a classificara como "extensão plausível" para permissões por conta. A
leitura estava certa; o desenho é que não serve:

```sql
staff_role_id INT NOT NULL,   -- FK para staff_roles.id — a LINHA de uma PESSOA
```

A FK aponta para a linha de uma pessoa, não para o cargo. Preenchê-la como está
transforma permissão em concessão individual: cada pessoa com seu conjunto,
nenhuma matriz auditável, e "quem pode `set_gold`?" vira uma varredura de tabela
cruzada com contas.

O que o RBAC precisa são duas coisas separadas, e a tabela atual mistura as duas:
um mapa **cargo → permissão** (`staff_role_permissions`) e overrides **pessoa →
permissão** (`staff_permission_overrides`), estes com prazo e motivo.

`staff_permissions` é marcada como descontinuada na migration, sem `DROP`
imediato — pelo mesmo critério da §237: uma tabela vazia não tem caminho de
execução e o custo de mantê-la é uma linha no schema. O `DROP` entra quando
houver uma limpeza de schema com banco de produção para conferir.

---

## 4. Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **Manter `ROLE_PERMISSIONS` no código e replicá-lo no painel** | duas cópias da mesma verdade em linguagens de deploy diferentes. É a §4.1 da auditoria com mais passos, e a divergência apareceria em silêncio |
| **`requireRole('admin')` no painel — o gate mínimo** | resolveria a §4.1 sem resolver nada mais: continuaria sem granularidade, sem prazo, sem override, e cravaria o nome do cargo em doze rotas, que é o que a §2.1 proíbe |
| **Casbin / Cerbos** | a decisão SA-008 do skyadmin já recusou, e a auditoria concorda: o custo operacional de um motor de política não se paga para ~40 permissões e 6 cargos, e transparência total do SQL é o que permite auditar sem aprender uma DSL. O gatilho para reabrir é ABAC de verdade — regra que dependa de atributo do alvo, não só do ator |
| **Bitmask de permissões numa coluna** | compacto e ilegível. Este projeto já pagou por permissão que não diz o que é: doze chamadas com nível numérico num `Set` de strings negavam tudo em silêncio (`CONTRIBUTING.md` §3.5). Nome, nunca número — e bitmask é número com outro nome |
| **Herança entre cargos** | §2.4 |

---

## 5. Consequências

**Ganhos**

- "Quem pode X?" é uma consulta, e a resposta é a mesma no painel e no jogo.
- Cargo novo não exige deploy; concessão temporária deixa de ser impossível.
- Revogação é imediata e mantém histórico.
- Negação vira sinal observável.
- Os cargos pedidos pelo briefing param de ser um buraco de segurança.

**Custos, ditos por inteiro**

- Renomear doze permissões toca ~15 chamadores e três arquivos de teste. Falha
  fechada e ruidosa, mas é trabalho real.
- O gamemode passa a resolver permissão contra o banco no login: uma consulta a
  mais por jogador que seja staff.
- Cache de permissão por sessão precisa de invalidação em escrita. Cache com
  TTL-só é aceitável para concessão e **inaceitável para revogação**.
- A ordem da migração é obrigatória (§2.5). Executá-la fora de ordem produz perda
  silenciosa de permissão.

**O que esta ADR deliberadamente não decide**

- O protocolo do canal painel → servidor de jogo. É a peça que destrava kick,
  anúncio e sessões ao vivo, e é desenho de uma sessão própria
  ([`ADMIN_PLATFORM.md`](../admin/ADMIN_PLATFORM.md) §5.2).
- O formato do pipeline de ação com outbox (marco 3 do skyadmin). Idempotência e
  motivo obrigatório entram junto com as primeiras rotas mutáveis; a fila
  persistente entra quando houver efeito externo para enfileirar — e hoje não há,
  porque a ponte não existe.
- Duração padrão de ban e política de múltiplos personagens por conta: seguem em
  aberto, como já estavam em `skyadmin/DECISIONS.md`.

---

## 6. Como se verifica que isto foi feito

[`ADMIN_SECURITY_MATRIX.md`](../testing/ADMIN_SECURITY_MATRIX.md) §7 é o portão.
Em resumo: três testes por rota administrativa (sem sessão / com permissão / **sem
permissão, verificando ausência de efeito**), a matriz cargo × permissão gerada
por célula, nenhuma permissão órfã, nenhuma permissão inventada, e a resolução do
painel e a do gamemode produzindo o mesmo conjunto para a mesma conta.

Enquanto esses testes não existirem, esta ADR é intenção — e a §0 daquele
documento diz isso com todas as letras.
