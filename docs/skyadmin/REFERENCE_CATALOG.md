# Catálogo de referências e estudo

## Integrar de forma incremental

| Recurso | Uso recomendado |
|---|---|
| [Ajv](https://github.com/ajv-validator/ajv) | schema JSON dos payloads de ações |
| [dbmate](https://github.com/amacneil/dbmate) | runner de migrations MariaDB, após piloto local |
| [express-mysql-session](https://github.com/chill117/express-mysql-session) | substituir `MemoryStore` no painel web |
| [Helmet](https://github.com/helmetjs/helmet) | headers HTTP e CSP configurada |
| [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | limitar login e ações sensíveis |
| [Pino](https://github.com/pinojs/pino) | logs JSON com correlação |
| [Testcontainers Node](https://node.testcontainers.org/modules/mysql/) | testes de integração contra banco real |

## Estudar e adaptar — não instalar como dependência do produto

| Referência | O que aproveitar |
|---|---|
| [SkyMP upstream](https://github.com/skyrim-multiplayer/skymp) | contrato Master API, runtime, eventos e APIs `mp` |
| [txAdmin](https://github.com/citizenfx/txAdmin) | UX de player manager, notas, warns, console e reinício programado |
| [GameAP](https://github.com/gameap/gameap) / [Daemon](https://github.com/gameap/daemon) | Agent outbound, heartbeat, tarefas e métricas; suporta Windows e MariaDB |
| [Pterodactyl Wings](https://github.com/pterodactyl/wings) | separação control plane/agent e ciclo de vida de processo |
| [Casbin](https://github.com/apache/casbin-node-casbin) | padrões RBAC/ABAC; integrar somente se RBAC SQL simples deixar de bastar |

## Referências de segurança

- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP WebSocket Security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
- [RFC 8252 — OAuth para apps nativos](https://www.rfc-editor.org/info/rfc8252/)
- [RFC 9700 — OAuth Security BCP](https://www.rfc-editor.org/rfc/rfc9700.html)

## Engenharia reversa permitida

- Ler código aberto e documentação upstream.
- Instrumentar o próprio servidor, launcher e banco em laboratório.
- Construir testes de contrato para Master API, login, `actorId`, sessão e eventos `mp`.
- Registrar commit/tag, licença, hipótese, experimento e resultado antes de adaptar comportamento.

## Proibido

- Contornar autenticação, anti-cheat ou controles de servidores de terceiros.
- Distribuir ou copiar código sem verificar licença e atribuição.
- Assumir que APIs FiveM são APIs SkyMP.
