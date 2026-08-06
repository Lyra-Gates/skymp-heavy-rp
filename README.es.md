# SkyMP Heavy RP — un servidor de rol para Skyrim multijugador

*[Português](README.md) · [English](README.en.md) · [Русский](README.ru.md) · **Español***

Una base abierta y actual de **servidor de rol para Skyrim Special Edition multijugador**, construida sobre [SkyMP](https://github.com/skyrim-multiplayer/skymp). Gamemode en Node.js, panel de whitelist, launcher en Electron y verificación de paridad del modpack.

Pensada para *rol estricto*: el servidor manda sobre economía, identidad y consecuencias, sin romper la sincronización de red.

> **Por qué existe:** a agosto de 2026 la comunidad de SkyMP no tiene ninguna base de servidor de rol abierta y mantenida. La única pública — [Red House](https://github.com/alekcey0211/red-house-public) — está abandonada desde 2021 y solo existe en ruso. Este proyecto intenta llenar ese hueco.

> ⚠️ **Todavía no está listo para producción.** El gamemode está verificado solo con pruebas automáticas contra un `mp` simulado — **nada se ha validado en una partida real**. El estado honesto de cada componente está en el [informe de QA](docs/technical/QA_REPORT_2026-08.md).

---

## Si acabas de llegar

| Lo que quieres | Empieza por |
|---|---|
| Entender lo que el proyecto **quiere ser** | [CONSTITUICAO.md](docs/CONSTITUICAO.md) — la constitución de diseño (en portugués) |
| Entender el estado real del proyecto | [Informe de QA](docs/technical/QA_REPORT_2026-08.md) — incluye lo que **no** está listo |
| Entender cómo se comunican las piezas | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Contribuir código | [CONTRIBUTING.es.md](CONTRIBUTING.es.md) — las reglas que no son obvias leyendo el código |
| Saber si un mod funciona en el servidor | [Contrato mods × gamemode](docs/technical/MODS_AND_GAMEMODE_CONTRACT.md) §4 |
| Recorrer toda la documentación | [docs/README.md](docs/README.md) |
| Reportar un fallo de seguridad | [SECURITY.es.md](SECURITY.es.md) — **no abras un issue público** |
| Preguntar, proponer o mostrar lo que hiciste | [Discussions](https://github.com/vinicius3232/skymp-heavy-rp/discussions) |

**Sobre el idioma:** los documentos de entrada (este README, la guía de contribución y la política de seguridad) se mantienen en cuatro idiomas. El resto de la documentación técnica está **solo en portugués** — ver [más abajo](#idioma-de-la-documentación).

---

## Qué hay dentro

| Componente | Qué hace |
|---|---|
| `skymp/gamemode` | Gamemode en Node.js: chat de rol, gobernanza (arrestos, multas, impuestos), puestos de mercado de jugadores, muerte con consecuencia, panel in-game, voz por proximidad |
| `skymp/ui` | Interfaz in-game en CEF |
| `apps/web` | Panel de staff, whitelist, OAuth de Discord y la **master API de SkyMP**, que hace que la identidad del jugador la decida el servidor |
| `apps/game-api` | Puerto 7758: paridad del modpack (`/mods.json`) y cola de entrada |
| `apps/bot-discord` | Sincronización de roles y canales de voz temporales |
| `apps/launcher` | Launcher en Electron + React: actualización de cliente y modpack, verificación de integridad, cola |
| `skymp/packages/database` | Esquema de MariaDB y migraciones |

### Cosas que no vas a encontrar en otro lado

- **Un API `mp` tipado** ([`types/mp.d.ts`](skymp/gamemode/types/mp.d.ts)) — SkyMP no publica tipos.
- **Un mapa del API real de SkyMP** ([`SKYMP_UPSTREAM_REFERENCE.md`](docs/technical/SKYMP_UPSTREAM_REFERENCE.md), en portugués), incluyendo hooks que la documentación oficial nunca menciona, sacados de las propias pruebas de integración del upstream.
- **Master API de sesión funcionando** — la mayoría de los servidores de prueba corre en `offlineMode`, donde el cliente declara su propia identidad y el servidor le cree.
- **Economía atómica** con libro mayor ([`core/transaction-service.js`](skymp/gamemode/core/transaction-service.js)).
- **Paridad de modpack** con generador de manifiesto.

---

## Cómo ejecutarlo

Necesitas **Node.js 20+**, **MariaDB/MySQL** y **Skyrim SE/AE** para probar en el juego.

```bash
git clone https://github.com/vinicius3232/skymp-heavy-rp.git
cd skymp-heavy-rp

# Cada servicio tiene sus dependencias
cd skymp/gamemode   && npm ci && cd ../..
cd apps/web         && npm ci && cd ../..
cd apps/game-api    && npm ci && cd ../..
cd apps/bot-discord && npm ci && cd ../..
```

Copia cada `.env.example` a `.env` y complétalo — los comentarios explican de dónde sale cada valor. Aplica `schema.sql` y después las migraciones `v2` a `v8`, **en orden**.

```powershell
.\scripts\phase0\Start-AllServices.ps1
```

El script revisa `.env` y `node_modules` de cada servicio antes de arrancar y te dice qué no va a levantar, en vez de reportar éxito con un servicio muerto.

### Herramientas de depuración que probablemente no conoces

- **`localhost:9000`** en tu navegador normal abre las **DevTools del navegador embebido del juego** — consola, inspector y breakpoints para la interfaz in-game. Sin eso depuras a ciegas.
- El servidor **hace proxy de la interfaz a un dev server en el puerto 1234**, así que puedes iterar CSS/JS sin reiniciar nada.

---

## Idioma de la documentación

Los puntos de entrada están traducidos. **La documentación técnica profunda sigue en portugués**, a propósito.

Es una decisión de mantenimiento, no un descuido. Unos 26 documentos técnicos cambian seguido, y una traducción desactualizada es peor que ninguna: es un documento en el que la gente confía y que miente en silencio. Mantener una sola versión autoritativa al menos garantiza que siga siendo correcta.

Si un documento concreto te bloquea, [pregunta en Discussions](https://github.com/vinicius3232/skymp-heavy-rp/discussions/categories/q-a) y traducimos ese. La traducción automática se defiende bien con estos archivos, porque son Markdown plano.

---

## Proyectos relacionados

Quien busca un servidor de rol para Skyrim multijugador termina encontrándose con estos. El mapa ayuda a ubicar dónde está cada uno:

| Proyecto | Qué es | Estado |
|---|---|---|
| [skyrim-multiplayer/skymp](https://github.com/skyrim-multiplayer/skymp) | La plataforma. Servidor en C++, Skyrim Platform y SDK en TypeScript. **Este proyecto corre encima de ella.** | Activo |
| [alekcey0211/red-house-public](https://github.com/alekcey0211/red-house-public) | Build pública de servidor de rol, GPL-3.0. La única que existía. Estudiada en detalle [aquí](docs/technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md). | Abandonada desde 2021, solo en ruso |
| [alekcey0211/skymp5-scripts](https://github.com/alekcey0211/skymp5-scripts) | Scripts de Papyrus para rol, del mismo autor que Red House. | Abandonado desde 2021 |
| [skyrim-roleplay](https://github.com/skyrim-roleplay) (Keizaal Online) | Organización de un servidor de rol. El fork de SkyMP es público; el gamemode no. | Activo, código de rol cerrado |
| [Silveira-Software/SKYRIMRP-BR](https://github.com/Silveira-Software/SKYRIMRP-BR) | Servidor de rol brasileño, en PT-BR. El repositorio es solo de difusión — el código es cerrado. | Activo, código cerrado |

**El hueco que este proyecto intenta llenar:** los servidores activos mantienen el gamemode cerrado, y el único abierto lleva años detenido. Quien quiera montar un servidor de rol hoy no tiene de dónde partir.

---

## Licencia

Software libre bajo **[GNU AGPL-3.0-or-later](LICENSE)**.

Es una elección deliberada: el objetivo es una base pública y actual de servidor de rol para la comunidad. La AGPL no nos cuesta nada que no estuviéramos regalando ya, y protege ese objetivo — quien modifique esta base y levante un servidor **tiene que ofrecer sus modificaciones a los jugadores** (AGPL §13). Además es la misma licencia de `skymp5-server`, sobre el que corre todo esto.

Si ejecutas una versión modificada, el enlace al código fuente debe apuntar a **tu** versión. Ver [PUBLIC_BUILD_GUIDE.md](docs/technical/PUBLIC_BUILD_GUIDE.md) §3.

**La licencia cubre nuestro código — no los mods de terceros ni los assets de Bethesda.** Aquí no se redistribuye nada de Bethesda; necesitas tener Skyrim.

> Este es un proyecto independiente de la comunidad. No está afiliado, avalado ni patrocinado por Bethesda Softworks, ZeniMax Media, Microsoft ni ningún titular oficial de los derechos de The Elder Scrolls/Skyrim. Todas las marcas pertenecen a sus respectivos dueños.
