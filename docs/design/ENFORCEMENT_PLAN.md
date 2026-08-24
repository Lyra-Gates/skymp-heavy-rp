# Plano de implementação — punição e permissão

**Origem:** a análise do [anti-cheat](ANTICHEAT.md) terminou em "evidência, a staff julga". Ao verificar como a staff *age* sobre o julgamento, descobri que ela não age: a permissão `ban` é concedida a admin e owner, e **nada no código a usa**.

**Estado: PLANO. Nenhuma linha escrita.** Conforme [`CONSTITUICAO.md`](../CONSTITUICAO.md) §14 — documentar e validar arquitetura antes de código.

---

## O que foi verificado, e como

Tudo abaixo foi lido nesta árvore, não inferido de documentação.

| Fato | Como verifiquei |
|---|---|
| `ban` é concedida a admin e owner | `ROLE_PERMISSIONS` em `admin-service.js:71-72` |
| Nada chama `hasPermission(…, 'ban')` | varredura de `hasPermission(` em `skymp/gamemode` + `apps/web` |
| Três permissões estão mortas | mesma varredura: `ban`, `manage_whitelist`, `view_audit` |
| Os três pontos de aplicação funcionam | `whitelist.js:124`, `game-api/server.js:185`, `apps/web/server.js:700` |
| Nada escreve em nenhum deles | busca por `UPDATE accounts SET status` e `revoked_at =` |
| `onLoginAttempt` está tipado e não ligado | `types/mp.d.ts:493`, `core/skymp-adapter/index.js:86`, zero uso |
| A whitelist expulsa depois de conectar | `whitelist.js:126` — `mp.kick(userId)` |

Confirma e detalha os achados 4.1, 4.2 e 4.4 do [`ADMIN_PLATFORM_AUDIT.md`](../research/ADMIN_PLATFORM_AUDIT.md) de 13/08, que continuam abertos.

---

# Parte I — O sistema de ban, pelos 15 pontos

Ban é mecanismo de mundo com consequência permanente sobre uma pessoa. Merece o portão da §15.

**1. Objetivo.** Dar à staff como remover alguém do servidor com motivo, prazo, autor e forma de desfazer — e como isso ser auditado depois.

**2. Problema que resolve.** Hoje o máximo é `/kick`, e o jogador reconecta em cinco segundos. Todo o resto da cadeia de moderação — evidência, julgamento, categoria `cheating` no `MODERATION_WORKFLOW` — termina sem consequência possível. **Um servidor público sem ban não tem como se defender de uma pessoa hostil.**

**3. Problemas que cria.**
- Poder novo e forte na mão da staff, sem contrapartida se não for auditado.
- Ban por engano é a pior experiência possível para um jogador legítimo, e a menos reversível socialmente.
- Se o ban virar evento de RP, contamina o mundo com decisão administrativa.

**4. Exploits.**
- **Evasão por conta nova do Discord.** O ban é da conta; conta nova é conta nova. Mitigação real: a whitelist é o portão, e a staff revisa. **Imperfeito, e assumido** — sem coleta de identificador de máquina, que este projeto não vai fazer (ver ANTICHEAT §10).
- **Escalada interna:** um admin banindo o owner. Precisa de regra explícita — ver §14.
- **Corrida:** jogador no meio de uma transação quando é banido. O `transaction-service` é atômico, então não corrompe; a ação seguinte falha.
- **Ban como arma em disputa de staff.** Resolvido por auditoria e por exigir motivo, não por código.

**5. Economia.** Nenhum impacto direto. O banido para de agir; ouro e itens ficam onde estão — `characters` nunca sofre `DELETE`.

**6. Político.** Alto e **deliberadamente fora do mundo**: ban é administração, não política do jogo. Um Jarl não bane; a staff bane. Confundir os dois é o erro que este documento mais quer evitar.

**7. Militar.** Nenhum. Punição não é força in-game.

**8. Religioso.** Nenhum.

**9. Social.** O ponto mais delicado. Uma comunidade aceita punição quando ela é **previsível e justificada**. Motivo obrigatório e registro consultável fazem mais pela aceitação do que qualquer sofisticação técnica.

**10. Técnico.** Barato: uma tabela, um comando, uma rota, e escrita nos três pontos que já funcionam. Sem chamada Papyrus, sem polling, sem carga nova.

**11. Narrativo.** **Zero, e tem que ser zero.** Ban é OOC. O `/permakill` é que é narrativo — encerra um personagem, é consequência de história. Ban remove uma pessoa. **Nunca misturar os dois.**

**12. Como gera histórias.** Não gera, e não deve. Ele protege as histórias dos outros.

**13. Como pode ser abusada.** §4 cobre. A defesa é auditoria obrigatória, motivo obrigatório, e a regra de hierarquia.

**14. Como balancear — as cinco regras.**

1. **Ban é da conta, `/permakill` é do personagem.** Nunca o mesmo comando, nunca o mesmo fluxo. Um é administração, o outro é história.
2. **Nunca `DELETE`.** Mesma regra dos personagens: o histórico de banimentos sobrevive, unban é uma linha nova, não um apagamento.
3. **Motivo obrigatório**, como no `/permakill`.
4. **Não se bane igual ou acima.** Um admin não bane outro admin nem o owner. Sem essa regra, `ban` é caminho de escalada.
5. **Só admin e owner** — nunca moderador. É a mesma escolha já feita para `retire_character`, e pelo mesmo motivo: remoção permanente não é decisão de linha de frente.

**15. Integração.** `audit_logs` (categoria `cheating` e as demais do `MODERATION_WORKFLOW`), `accounts.status`, `game_sessions.revoked_at`, fila do `game-api`, e o painel.

---

# Parte II — Os quatro itens

Ordem por dependência, não por tamanho.

## Item 1 — Ban com registro

**Migration v28.** A próxima livre — a última é a `v27-resource-nodes`.

> Conferi isto duas vezes de propósito: um `ls | tail` ordena alfabeticamente e mostra a v9 como última, porque `v9` vem depois de `v25` nessa ordem. Escolher o número errado criaria duas migrations com o mesmo nome em branches diferentes, e o conflito só apareceria no banco de quem aplicasse as duas. Use `ls | sort -V`, ou `npm run check:schema:list`, que ordena por número.

*(De passagem: faltam a v16 e a v17 na sequência. O `check-schema-drift` ordena por número e lida com buraco sem problema, mas vale alguém confirmar que foram removidas de propósito.)*

```sql
CREATE TABLE IF NOT EXISTS `account_bans` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `account_id`      INT NOT NULL,
  `reason`          TEXT NOT NULL,           -- obrigatório, regra 3
  `banned_by`       INT NOT NULL,            -- conta de quem baniu
  `banned_at`       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `expires_at`      TIMESTAMP NULL,          -- NULL = permanente
  `lifted_at`       TIMESTAMP NULL,          -- unban: linha nova de estado, nunca DELETE
  `lifted_by`       INT NULL,
  `lift_reason`     TEXT NULL,
  KEY `idx_ban_conta_ativo` (`account_id`, `lifted_at`)
);
```

**A escrita, numa transação.** `accounts.status` e `game_sessions` vivem no mesmo banco, então dá para ser atômico — e a ordem importa:

1. `INSERT` em `account_bans`
2. `UPDATE accounts SET status='banned'`
3. `UPDATE game_sessions SET revoked_at=NOW()` das sessões ativas daquela conta

**Se invertesse 2 e 3, o jogador seria desconectado e reconectaria** — a sessão morre antes do portão fechar. Vale um comentário no código, porque a ordem parece arbitrária e não é.

**Expiração preguiçosa, sem agendador.** O login já lê `accounts.status`. Quando for `banned`, uma consulta extra ao `account_bans`: se o ban ativo tem `expires_at < NOW()`, marca como expirado, devolve a conta para `active` e deixa entrar. Custa uma query **só no caminho raro** (conta banida), e evita um job que teria de rodar e ser monitorado.

**Superfícies:**
- `/ban <actorId> <duração> <motivo>` e `/unban <accountId> <motivo>` — mesmo padrão de registro do `/permakill` em `commands.js:450`
- Rota no painel, atrás da permissão `ban` (que o Item 3 torna consultável)
- `audit_logs` nos dois sentidos

**Testes:** matriz de cargo (moderador **não** pode), motivo obrigatório, hierarquia (admin não bane admin nem owner), a ordem da transação, expiração preguiçosa, unban não ressuscita sessão revogada.

## Item 2 — Recusar no handshake (`mp.onLoginAttempt`)

Hoje: conecta, roda caminho de código, recebe `profileId`, **depois** leva `mp.kick`. Um banido entra no processo antes de ser expulso.

`mp.onLoginAttempt(profileId) → boolean` já está tipado (`mp.d.ts:493`) e documentado no adapter (`skymp-adapter/index.js:86`). Falta ligar.

**Regra de segurança da mudança: adicionar, não substituir.** O hook entra como portão adicional; o `mp.kick` da whitelist **continua**, via detecção de capacidade do adapter. Se o hook não existir na build implantada, nada regride. Só depois da Fase 0 confirmar é que se avalia remover o caminho antigo.

É a mesma disciplina do `death-service`, onde o polling ficou como rede até o `mp.onDeath` ser confirmado em jogo.

## Item 3 — Uma fonte de permissão para os dois lados

**Causa raiz** de duas das três permissões mortas: `ROLE_PERMISSIONS` vive em `admin-service.js` (gamemode) e o painel usa `requireStaff` binário. A granularidade existe de um lado do muro só.

**Correção:** extrair a matriz para um módulo puro — sem `db`, sem `mp`, sem `express` — que os dois importam. Mesmo padrão de `core/soul.js` e `parity.mjs`: domínio separado de infraestrutura, testável sozinho.

O painel ganha `requirePermission('manage_whitelist')` no lugar de `requireStaff` genérico, e `view_audit` volta a significar algo.

**Não vai para o banco agora.** A tabela `staff_permissions` existe no schema e nunca foi lida — seria o destino natural, e é uma boa ideia **depois**. Fazer as duas mudanças juntas (unificar *e* mover para o banco) misturaria uma correção com uma migração de arquitetura, e se algo quebrasse não se saberia qual das duas foi.

## Item 4 — O teste que pega permissão morta

O projeto tem teste que pega *"o handler esqueceu de checar"*. Não tem nada que pegue *"a permissão é concedida e ninguém a usa"* — que é como `ban` sobreviveu à auditoria e aos 1136 testes do gamemode.

**Reaproveita um padrão que já existe aqui.** O `core/server-options.js` tem `SPEC` (o que funciona) e `DECLARED_BUT_UNWIRED` (o que ainda não faz nada), e um teste impede o arquivo de ganhar chave nova sem alguém classificá-la. A mesma forma serve para permissão:

```js
// Permissões concedidas que nenhum handler consulta ainda.
// Sair desta lista é o objetivo; entrar nela exige justificar no PR.
const CONCEDIDAS_SEM_USO = ['view_audit'];
```

O teste afirma que o conjunto de permissões mortas é **exatamente** essa lista. Cada item resolvido obriga a atualizar a lista, e um item novo quebra o teste.

**Ordem prática:** escrever o teste primeiro, com as três atuais na lista. O Item 1 remove `ban`, o Item 3 remove `manage_whitelist`. `view_audit` fica declarado como dívida até alguém ligar a rota de auditoria — visível, não esquecido.

---

## Ordem de execução

| # | Depende de | Por que nesta posição |
|---|---|---|
| **4** | nada | Escrito primeiro, torna a dívida visível e protege os itens seguintes |
| **1** | 4 | O que desbloqueia toda a cadeia de moderação |
| **3** | 4 | Causa raiz de duas mortas; o painel passa a ler o mesmo modelo |
| **2** | 1 | Só faz sentido recusar cedo depois de existir algo que marque quem recusar |

**Nada aqui depende da Fase 0** — é infraestrutura de administração, não mecânica de mundo. Isso a distingue da detecção de ActorValue do [ANTICHEAT](ANTICHEAT.md), que precisa de sessão real para calibrar limiar.

## O que fica de fora, e por quê

- **Detecção de trapaça.** Rejeitada na forma de scanner ([ANTICHEAT](ANTICHEAT.md)); a versão do servidor espera a Fase 0.
- **Identificador de máquina contra evasão de ban.** Coleta invasiva pelos mesmos motivos do ANTICHEAT §10. A evasão por conta nova fica como limitação declarada, com a whitelist como portão.
- **`staff_permissions` no banco.** Boa ideia, depois do Item 3 assentar.
- **Ban por IP.** Alta taxa de dano colateral (CGNAT é comum no Brasil, e derruba a casa inteira do jogador). Se um dia entrar, precisa da própria análise.

## Uma classe de bug que vale procurar

`ban` sobreviveu porque a verificação existia **numa direção só**: testamos se o handler consulta a permissão, nunca se a permissão tem handler.

É o mesmo formato do bug de paridade do launcher, onde a checagem percorria a lista do servidor perguntando *"o jogador tem isto?"* e nunca a do jogador perguntando *"o servidor conhece isto?"*.

**Dois casos não são coincidência.** Vale uma varredura por checagens unidirecionais em outros lugares — provavelmente há mais.
