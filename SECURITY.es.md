# Política de seguridad

*[Português](SECURITY.md) · [English](SECURITY.en.md) · [Русский](SECURITY.ru.md) · **Español***

Este proyecto maneja autenticación de Discord, tickets de sesión, economía persistente y permisos de staff. Un fallo en cualquiera de esos puntos afecta a jugadores reales en cualquier servidor que use esta base.

## Reportar una vulnerabilidad

**No abras un issue público.** Un issue público de seguridad es un mapa para quien quiera explotar el fallo antes de que exista un arreglo — y como esta base es pública, eso alcanza a servidores más allá del tuyo.

Usa una de estas vías:

- **[GitHub Security Advisory](https://github.com/vinicius3232/skymp-heavy-rp/security/advisories/new)** — preferida; permite discusión privada y divulgación coordinada.
- Contacto directo con el mantenedor por el Discord del proyecto.

Ayuda incluir: dónde está (servicio y archivo), qué puede hacer un atacante con eso, y cómo reproducirlo. La prueba de concepto es bienvenida, pero **no pruebes contra el servidor de otra persona** — solo contra el tuyo.

## Qué esperar

No hay SLA — esto se mantiene por voluntariado. El compromiso es: respuesta lo antes posible, arreglo priorizado por encima de cualquier feature, y crédito para ti en el commit y el changelog salvo que prefieras el anonimato.

Cuando sale el arreglo, se publica con una descripción del impacto. Los servidores que corren esta base necesitan saber qué actualizar y por qué.

## Dentro del alcance

- Saltarse la whitelist, entrar sin aprobación o suplantar a otro jugador
- Escalar privilegios de staff o ejecutar un comando de staff sin permiso
- Duplicar oro u objetos, o cualquier forma de rodear `core/transaction-service`
- Leer o alterar datos de otro jugador (ficha, inventario, mensajes privados)
- Filtrar un secreto del servidor por el launcher, el panel o la interfaz in-game
- Inyección SQL, XSS en el panel o en la interfaz in-game
- Saltarse la verificación de paridad del modpack
- Tirar el servidor con una petición malformada

## Fuera del alcance

- **Vulnerabilidades del propio SkyMP** — repórtalas en [skyrim-multiplayer/skymp](https://github.com/skyrim-multiplayer/skymp). Si afecta a cómo lo usamos, cuéntanos también.
- **Cheats de cliente** (aimbot, speedhack, ESP). El cliente no es de fiar por diseño; nuestra defensa es que el servidor no le crea. Si encontraste la forma de que el **servidor** acepte algo que el cliente inventó, eso **sí** está dentro del alcance.
- Problemas que requieren acceso físico a la máquina del servidor o credenciales ya comprometidas.
- Denegación de servicio volumétrica — eso es una preocupación de la capa de infraestructura.

## Limitaciones conocidas

La transparencia vale más que fingir cobertura total. Estas son conocidas y están documentadas:

- **Nada se ha validado en una partida real.** Todo el gamemode está verificado solo contra un `mp` simulado. Ver el [informe de QA](docs/technical/QA_REPORT_2026-08.md).
- **`offlineMode: true` desactiva la autenticación.** En ese modo el cliente declara su propio `profileId` y el servidor le cree. Es un modo de laboratorio; los ejemplos vienen con `offlineMode: false`. Quien corra un servidor público en `offlineMode` no tiene autenticación en absoluto.
- **Los eventos de cliente son pistas, no pruebas.** `mp.makeEventSource` corre en el cliente. El servidor tiene que validar todo lo que venga de ahí.

Si encuentras algo que la documentación ya reconoce, sigue valiendo la pena reportarlo si el impacto es mayor de lo descrito.

## Si operas un servidor sobre esta base

- Nunca commitees `.env`. El `.gitignore` lo cubre y el CI lo verifica.
- Genera `SESSION_SECRET`, `INTERNAL_API_SECRET` y `MASTER_KEY` aleatorios y distintos por entorno.
- Mantén `GAME_API_BIND_HOST` y los puertos internos detrás de un firewall. Solo el servidor de juego y la game API necesitan ser accesibles desde fuera.
- Usa `offlineMode: false` en producción. Siempre.
- Vigila `audit_logs` — existe para que el abuso de staff sea detectable.
