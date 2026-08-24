# Git — política de responsabilidade do Claude neste projeto

Autorização permanente do dono do projeto (2026-08-21): Claude pode `git commit`
e `git push` (branch normal, não force) neste repositório sem pedir confirmação
a cada vez. A responsabilidade de fazer isso com segurança é do Claude.

## Como isso se traduz na prática

- **Commit**: crie commits quando fizer sentido para o trabalho em andamento —
  não precisa esperar o usuário pedir "comita isso" a cada mudança, mas também
  não crie commits triviais/fragmentados sem necessidade. Mensagens seguem o
  padrão já usado no repo (git log recente).
- **Push**: pode dar push em branches normais (feature branches, a branch atual
  de trabalho) sem perguntar antes.
- **Nunca**, mesmo com esta autorização:
  - `git push --force` / `-f` (bloqueado também em `.claude/settings.json`)
  - `git reset --hard`, `git clean`, `git branch -D`, `git checkout -- *`,
    `rm -rf` (todos bloqueados em `.claude/settings.json`)
  - pular hooks (`--no-verify`, `--no-gpg-sign`)
  - fazer `--amend` em vez de novo commit (exceto se o usuário pedir amend
    explicitamente)
  - forçar push para `main`/`master`
- Revisar sempre o que está sendo staged (evitar `git add -A`/`.` sem olhar)
  antes de commitar, e checar por segredos em arquivos suspeitos.

Se o usuário quiser revogar isso, ele edita ou remove esta seção.
