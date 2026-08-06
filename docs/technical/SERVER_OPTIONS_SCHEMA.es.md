# Esquema de Server Options de RP

*[Português](SERVER_OPTIONS_SCHEMA.md) · [English](SERVER_OPTIONS_SCHEMA.en.md) · [Русский](SERVER_OPTIONS_SCHEMA.ru.md) · **Español***

> **Estado: parcialmente implementado.**
> El archivo ya se carga y se valida en `skymp/gamemode/core/server-options.js`. Pero **solo las opciones listadas en "Qué está conectado hoy" hacen algo** — el resto sigue siendo contrato de diseño.
>
> El loader avisa en el arranque cuando encuentra en el archivo una opción que todavía no hace nada, y **aborta el arranque** si un valor tiene el tipo equivocado o está fuera de rango. Fallar en voz alta es deliberado: una opción de gameplay mal escrita que "casi funciona" es peor que un servidor que no levanta.

> **De dónde salió este esquema:** las opciones originales (`isVanillaSpawn`, `SpawnTimeToRespawn`, `spawnTimeToRespawnNPC` y afines) son las del servidor Red House — ver `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1 (en portugués). Se copiaron como intención de diseño y nunca se conectaron a nuestro código, lo que explica un esquema que describe comportamiento que aquí nunca existió. La tabla de abajo separa lo real de lo que sigue siendo intención.

## 0. Qué está conectado hoy

| Opción | Dónde actúa |
|---|---|
| `chat.whisperRange` | `core/proximity-ranges.js` — chat **y** voz |
| `chat.localRange` | ídem. `emote` y `ooc` se derivan de ella (×5/4 y ×5/3) |
| `chat.shoutRange` | ídem |
| `chat.oocEnabled` | `rp-chat-service.js` — desactiva `/ooc` y `/b` in-game |
| `chat.oocRateLimitSeconds` | `rp-chat-service.js` — ventana del anti-flood |
| `rp.permadeathEnabled` | `death-service.js` — el desangrado retira al personaje en vez de reaparecerlo |
| `spawn.playerRespawnSeconds` | `death-service.js` — pausa entre morir y reaparecer |
| `economy.startingGold` | `whitelist.js` — otorgado una sola vez por personaje, en el primer spawn |

Todas las demás opciones documentadas abajo están en `DECLARED_BUT_UNWIRED` en el loader. Cuando implementes una, muévela a `SPEC` y actualiza esta tabla — hay una prueba que impide que el archivo de ejemplo gane una clave nueva sin que alguien la clasifique.

**Sobre `rp.permadeathEnabled`:** activar esto cambia el significado de toda escena de combate del servidor. El personaje que se desangra pasa a `status='retired'` (nunca `DELETE`, el mismo camino que `/permakill`), es notificado y desconectado. Es una decisión de operación, no un detalle de configuración.

## 1. Objetivo

Definir un `server-options` propio para el servidor Heavy RP, con validación, perfiles por entorno y protecciones contra configuraciones peligrosas.

Este archivo no sustituye a `server-settings.json`. Controla reglas de gameplay, RP, staff, chat, spawn y operación.

## 2. Principios

- Toda opción debe tener un tipo definido.
- Producción debe bloquear opciones peligrosas.
- Los cambios deben ser auditables.
- Los valores por defecto deben favorecer la seguridad.
- El entorno local puede ser permisivo, staging controlado y producción restringido.

## 3. Ejemplo de estructura

```json
{
  "environment": "staging",
  "rp": {
    "heavyRpEnabled": true,
    "requireApprovedCharacterForSpawn": true,
    "allowRaceMenuBeforeApproval": false,
    "defaultStartPointPolicy": "approved_character",
    "permadeathEnabled": false
  },
  "chat": {
    "localRange": 1400,
    "whisperRange": 350,
    "shoutRange": 3000,
    "oocEnabled": true,
    "oocRateLimitSeconds": 10,
    "logAllChannels": true
  },
  "staff": {
    "passwordAdminLoginEnabled": false,
    "requireRolePermission": true,
    "requireCommandReason": true,
    "auditAllCommands": true,
    "allowDestructiveCommandsInProduction": false
  },
  "spawn": {
    "vanillaSpawnMode": "selective",
    "playerRespawnSeconds": 300,
    "npcRespawnSeconds": 3600,
    "disableRespawnActorIds": []
  },
  "economy": {
    "serverAuthoritativeCurrency": true,
    "startingGold": 0,
    "logAllTransactions": true
  },
  "debug": {
    "enablePapyrusDebug": false,
    "enableHotReload": false,
    "enableDevTools": false
  }
}
```

## 4. Perfiles por entorno

### Local

- Puede activar debug.
- Puede activar hot reload.
- Puede usar comandos de prueba.
- Puede usar `databaseDriver=file`.
- No puede exponerse al público.

### Staging

- Debug limitado.
- Hot reload solo en ventana técnica.
- Comandos destructivos permitidos solo para dev/admin.
- Audit log obligatorio.
- La whitelist puede usar un grupo de testers.

### Producción

- `passwordAdminLoginEnabled=false`.
- `requireRolePermission=true`.
- `requireCommandReason=true`.
- `auditAllCommands=true`.
- `allowDestructiveCommandsInProduction=false`, salvo lista de excepciones firmada por el dueño/dev líder.
- `enableHotReload=false`.
- `enableDevTools=false`.
- `requireApprovedCharacterForSpawn=true`.

## 5. Validaciones obligatorias

Fallar el arranque en producción si:

- El entorno es `production` y `passwordAdminLoginEnabled=true`.
- El entorno es `production` y `enableHotReload=true`.
- El entorno es `production` y `enableDevTools=true`.
- El entorno es `production` y `requireApprovedCharacterForSpawn=false`.
- El entorno es `production` y `auditAllCommands=false`.
- El entorno es `production` y `requireCommandReason=false`.
- `localRange`, `whisperRange` o `shoutRange` son menores o iguales a cero.
- `startingGold` es negativo.
- `playerRespawnSeconds` es menor que la regla de muerte definida.

## 6. Decisiones pendientes

- Valor final de los rangos de chat tras la prueba en el juego.
- Si el OOC global queda activo en producción o limitado por un cooldown mayor.
- Si el spawn vanilla se apagará, será selectivo o reducido.
- Si la muerte permanente existe en el lanzamiento.
- Si los comandos destructivos pueden usarse en un evento con autorización previa.
