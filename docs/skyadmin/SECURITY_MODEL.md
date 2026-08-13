# Modelo de segurança

## Regras não negociáveis

- `offlineMode` não é permitido fora do laboratório.
- Tokens de sessão e tickets são opacos; no banco, apenas hashes.
- Nunca registrar token, cookie, `masterKey`, segredo Discord ou payload sensível completo.
- Toda rota mutável exige sessão, CSRF, autorização e validação de entrada.
- Ações de alto impacto exigem motivo e confirmação na UI.
- O Agent não expõe porta pública de comando; abre conexão de saída autenticada.

## Controles por camada

| Camada | Controle |
|---|---|
| Web | sessão persistente, cookies seguros, CSRF, CSP, rate limit, Helmet |
| API | schema de entrada, autorização por permissão, idempotência, logs estruturados |
| Banco | FKs, índices, migrations, transação e mínimo privilégio do usuário SQL |
| Agent | mTLS ou credencial rotativa, allowlist de comandos, timeout e confirmação |
| SkyMP | Master API, sessão revogável, whitelist por `account_id` |

## Ameaças prioritárias

1. Jogador editar `profileId` localmente para assumir outra conta.
2. Staff sem permissão chamar endpoint manualmente.
3. Repetição de POST resultar em dois bans, itens ou transferências.
4. Token vazado em log, URL, crash report ou frontend.
5. Navegador ou usuário transformar payload em comando no host.
6. Sessão administrativa roubada por CSRF ou cookie persistente inseguro.

## Checklist antes de nova ação

- Qual permissão é necessária?
- Qual é o alvo e como ele é resolvido?
- O schema rejeita campos extras e valores inválidos?
- Qual é a chave de idempotência?
- Há transação e auditoria?
- Como a ação expira, falha e é revertida?
- O resultado expõe dados desnecessários?
