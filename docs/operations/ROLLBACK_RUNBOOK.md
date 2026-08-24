# Runbook de rollback

Este procedimento precisa ser exercitado em staging antes da alfa. Escrevê-lo
reduz improviso; não prova que funciona no ambiente real.

## 1. Critérios para acionar

- login/entrada falha para usuários válidos após deploy;
- corrupção, perda ou duplicação de estado;
- schema drift depois de migration;
- launcher/modpack rejeita instalação válida em massa;
- crash loop ou degradação que não pode ser mitigada por flag.

Antes de alterar qualquer coisa, registre horário, commit, versões, sintomas e
um backup. Não apague logs nem o volume defeituoso.

## 2. Código dos serviços e gamemode

1. Pare entrada de jogadores e os serviços que escrevem no banco.
2. Execute `Backup-Staging.ps1` mesmo se o banco parecer saudável.
3. Identifique o último commit/release aprovado; não use `git reset --hard`.
4. Crie uma branch de rollback a partir do commit aprovado ou reverta os
   commits defeituosos com `git revert`.
5. Rode as suítes sem banco e `docker compose config`.
6. Suba serviços Node, confira `/health`, então inicie SkyMP no host.
7. Faça login com conta de teste antes de reabrir entrada.

Flags de módulo são a primeira mitigação quando isolam o defeito sem violar
schema/contrato. Toda flag alterada entra no registro do incidente.

## 3. Banco

Migrations são **forward-only**; não existe downgrade automático. Se a mudança
for compatível, reverta apenas código e preserve colunas/tabelas novas. Se houve
mutação destrutiva ou dados inválidos:

1. mantenha painel, Game API, bot e SkyMP parados;
2. preserve dump pós-incidente separado;
3. escolha o backup pré-deploy e confira SHA-256;
4. rode `Restore-Staging.ps1`;
5. exija `check:schema:env -- --strict` verde;
6. valide conta/personagem/transações de teste antes do tráfego.

Nunca improvise `DROP`, `TRUNCATE` ou UPDATE corretivo no banco oficial sem
dump, query revisada e registro de auditoria.

## 4. Launcher, cliente e modpack

1. Pare de promover a release defeituosa; não apague o artefato usado por quem
   já instalou.
2. Restaure no manifesto o último `clientVersion`, URL e SHA-256 aprovados.
3. Restaure o manifesto de mods gerado da `Data` conhecida e sua load order.
4. Publique uma nova release corretiva; não substitua bytes sob a mesma versão.
5. Teste atualização/repair em instalação limpa e em instalação divergente.

O launcher falha fechado em manifesto inválido; um rollback sem SHA-256 correto
é indisponibilidade, não rollback.

## 5. Evidência obrigatória do exercício

- data, operador e duração;
- commit/release de origem e destino;
- backup e SHA-256;
- saída de health checks e schema drift;
- resultado de login, reconexão e leitura do personagem;
- divergências encontradas e atualização deste runbook.

F2-003/F8-003 permanecem parciais até esse exercício ocorrer com MariaDB e
staging ativos.
