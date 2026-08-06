# Cómo contribuir

*[Português](CONTRIBUTING.md) · [English](CONTRIBUTING.en.md) · [Русский](CONTRIBUTING.ru.md) · **Español***

Gracias por el interés. Esta es una base pública de servidor de rol para SkyMP bajo AGPL-3.0 — lo que aportes queda disponible para toda la comunidad.

El documento tiene dos partes: cómo ejecutar y enviar cambios, y **las reglas que no son obvias leyendo el código**. La segunda importa más — casi cada punto existe porque alguien ya rompió eso.

---

## 1. Levantar el entorno

Necesitas **Node.js 20+**, **MariaDB/MySQL** y **Skyrim SE/AE** si vas a probar en el juego.

```bash
git clone https://github.com/vinicius3232/skymp-heavy-rp.git
cd skymp-heavy-rp

cd skymp/gamemode   && npm ci && cd ../..
cd apps/web         && npm ci && cd ../..
cd apps/game-api    && npm ci && cd ../..
cd apps/bot-discord && npm ci && cd ../..
cd apps/launcher    && npm ci && cd ../..
```

Copia cada `.env.example` a `.env` y complétalo — los comentarios explican de dónde sale cada valor.

Base de datos: aplica `skymp/packages/database/schema.sql` y después las migraciones `v2` a `v9`, **en orden**.

```powershell
.\scripts\phase0\Start-AllServices.ps1
```

El script revisa `.env` y `node_modules` de cada servicio y te dice qué no va a levantar. Si se queja, arregla lo que señala — no miente por optimismo.

### Depuración

Dos cosas que existen y casi nadie usa:

- **`localhost:9000`** en tu navegador abre las **DevTools del navegador embebido del juego**. Así se depura la interfaz de `skymp/ui/`. Sin eso trabajas a ciegas.
- El servidor **hace proxy de la interfaz a un dev server en el puerto 1234**, así que puedes iterar CSS/JS sin reiniciar nada.

---

## 2. Ejecutar las pruebas

```bash
cd skymp/gamemode   && npm test && npm run test:systems && npm run typecheck
cd apps/web         && npm test
cd apps/game-api    && npm test
cd apps/bot-discord && npm test
cd apps/launcher    && npm run typecheck

# Necesita base de datos: comprueba que coincide con las migraciones versionadas
cd skymp/gamemode   && npm run check:schema
```

Usamos el test runner nativo de Node (`node --test`) — sin Jest, sin Vitest, sin configuración.

**Una prueba nueva tiene que entrar en el script `test` del `package.json`.** No hay descubrimiento automático de archivos: una prueba que no está listada simplemente no corre, y nadie se entera.

---

## 3. Las reglas que no son obvias

Esta sección es el corazón del documento. Cada punto se rompió de verdad.

### 3.1 Oro y objetos: solo por `core/transaction-service.js`

**Nunca** escribas `UPDATE characters SET gold = ...` ni toques `character_inventory` directamente.

`transaction-service` hace `BEGIN` / `SELECT ... FOR UPDATE` / `COMMIT`, escribe en `gold_transactions` y acepta una clave de idempotencia. Existía un `economy-service.js` con `UPDATE` sueltos: su `transfer` hacía `removeGold` y luego `addGold` sin transacción, así que si el segundo fallaba el oro desaparecía. Se borró el 06/08/2026 justamente para que el camino fácil deje de ser el equivocado.

```js
// correcto
await transactionService.addGold({ characterId, amount, reason: 'quest_reward', module: 'quests' });

// incorrecto — sin atomicidad, sin libro mayor, sin rastro
await db.query('UPDATE characters SET gold = gold + ? WHERE id = ?', [amount, characterId]);
```

### 3.2 Papyrus: `self` es un objeto, nunca un FormID

Usa los helpers de `core/papyrus.js`:

```js
const { actorRef, baseRef } = require('./core/papyrus');
mp.callPapyrusFunction('method', 'Actor', 'Resurrect', actorRef(actorId), []);
```

El gamemode ya mezclaba las dos formas en 22 lugares. Las nueve pruebas de integración del propio SkyMP (`misc/tests/` en upstream) usan **exclusivamente** la forma de objeto, incluso para argumentos que son referencias. `type: 'form'` para lo que existe en el mundo, `type: 'espm'` para registros base de plugin.

### 3.3 Módulos: siempre por `core/module-registry.js`

Un servicio nuevo se registra en `phase0-basic.js` con `id`, `enabledBy` (una flag `ENABLE_*`), `dependencies`, `commands` e `initialize()`. El registro resuelve dependencias y da de alta/baja los comandos por ti.

**Nunca importes un módulo PARKED directamente.** Siete servicios están en disco y no corren (`economy-regional`, `crafting`, `jobs`, `housing`, `horse`, `trade`, `disguise`). Importarlos en el arranque los haría correr saltándose las flags — exactamente lo que el registro existe para impedir.

### 3.4 `server-options.json`: solo entra lo que está conectado

`core/server-options.js` tiene dos listas: `SPEC` (opciones que de verdad cambian el comportamiento) y `DECLARED_BUT_UNWIRED` (las que todavía no hacen nada).

Cuando implementes una opción, **muévela de una lista a la otra**. Hay una prueba que impide que el archivo de ejemplo gane una clave nueva sin que alguien la clasifique.

Esto existe porque el esquema documentaba 24 opciones y **ninguna se leía**: alguien ajustaba `permadeathEnabled`, no pasaba nada, y concluía que el servidor estaba roto. Una configuración que parece real y no hace nada es peor que no tener configuración.

### 3.5 Permisos: por nombre, nunca por número

`admin-service.hasPermission(actorId, 'retire_character')`. La función rechaza números y nombres desconocidos y lo registra en el log — pero no confíes en eso, escríbelo bien.

Había doce llamadas pasando un nivel numérico (`hasPermission(id, 20)`) contra un `Set` de strings. `Set.has(20)` siempre es `false`, así que negaban todo en silencio.

### 3.6 El cliente no es de fiar

La regla de oro del proyecto: **el servidor decide, el cliente muestra.**

Los eventos de `mp.makeEventSource` corren en el cliente. Son una **pista**, no una prueba. Aceptable para detectar una muerte; inaceptable para entregar objetos u oro.

La misma lógica en `apps/web`: `discordId` es público y no prueba nada. La autenticación es por ticket emitido por quien tiene el secreto.

### 3.7 Nunca hagas `DELETE` a un personaje

Un personaje sale de juego con `status = 'retired'`. El historial — logs de auditoría, transacciones, ficha criminal — tiene que sobrevivir. `whitelist.js` solo permite spawn con `status = 'approved'`, así que `retired` ya basta para sacarlo de juego.

Cuidado con `UPDATE ... JOIN` por cuenta: una vez aprobar una whitelist resucitó a un personaje al que le habían hecho `/permakill`. Filtra por estado.

### 3.8 Llamar a Papyrus es caro

Cada ida y vuelta a Papyrus cuesta **decenas de milisegundos** — el servidor de rol Red House midió entre 13 y 35 ms por llamada. No son microsegundos.

Eso encarece el polling rápido. Prefiere hooks nativos (`mp.onDeath`, `mp.onActivate`) y `mp.makeEventSource` antes que bucles de `setInterval` leyendo `getActorValue`. Donde el polling todavía existe, está marcado como deuda.

### 3.9 Un secreto nunca va en una variable `VITE_`

Todo lo que sea `VITE_*` en el launcher se **incrusta en el instalador en tiempo de build** y llega a los jugadores. El client secret de Discord estuvo ahí — hoy vive solo en `apps/web`, que hace el intercambio de token.

### 3.10 El secreto del alma nunca sale del servidor — y el dominio no lee el entorno

`core/soul.js` deriva el alma de un personaje de **su ficha aprobada**, firmada con un secreto del servidor. De ahí salen dos reglas, y las dos son fáciles de romper sin darse cuenta.

**El secreto se pasa como argumento, nunca se lee de `process.env` dentro del módulo.** El dominio no conoce la infraestructura — eso es lo que mantiene el archivo testeable sin servidor, sin base de datos y sin `mp`. Un `require('dotenv')` ahí dentro tira abajo toda la propiedad.

**El secreto no puede filtrarse a ningún lado**: ni log, ni payload, ni respuesta de API. La ficha del personaje es pública. Con el secreto, cualquiera calcula el alma de cualquiera a partir de lo que está escrito en el panel — y el sistema entero deja de ser oculto, de una vez, sin que aparezca ningún error.

Por el mismo motivo: **ningún número de afinidad puede llegar al cliente.** El jugador recibe señales y consecuencias, nunca valores. Ver [`docs/design/SOUL_AFFINITY.md`](docs/design/SOUL_AFFINITY.md) §III.12.7 (en portugués) — es la prueba que protege el sistema entero.

### 3.11 Un carácter invisible en el fuente siempre es escape, nunca el byte crudo

Escriba `'\u0000'`, `[\u0300-\u036f]`, `'\t'`. Nunca pegue el carácter.

`core/soul.js` llevaba dos: la clase de marcas combinantes del `normalize()` y — el peor — un NUL como separador de los campos que entran en el HMAC del alma. NUL es la elección correcta ahí, porque no sobrevive al `normalize()` y por lo tanto ningún jugador logra escribirlo en la ficha; sin un separador imposible de teclear, `'ab'+'c'` y `'a'+'bc'` firmarían el mismo material y dos fichas distintas nacerían con la misma alma.

El problema nunca fue la elección, sino que fuera invisible. Tres consecuencias, todas silenciosas:

- **La línea le miente a quien lee.** `].join('<NUL>')` aparece en pantalla como `].join('')` — el revisor entiende "concatena sin separador", que es lo contrario de lo que ocurre.
- **El archivo se vuelve binario.** `grep` responde `Binary file matches` en vez del fragmento, y `file` dice `data`. La herramienta que todos usan para encontrar código deja de funcionar en ese archivo.
- **Un editor puede borrarlo al guardar.** Muchos limpian caracteres de control. En ese archivo eso reescribiría la semilla de **toda alma ya derivada**, sin que apareciera ningún error.

Si un valor invisible va a cargar significado, merece una constante con nombre y un comentario que diga por qué es ese valor. `core/soul.test.js` tiene un guard estático contra los dos casos.

---

## 4. Estilo de código

- **Portugués** en comentarios, documentación y mensajes al jugador. Los identificadores en inglés, siguiendo lo que ya hay en el archivo.
- **Un comentario explica el porqué, no el qué.** `// incrementa i` no ayuda a nadie; `// FOR UPDATE aquí porque dos compras simultáneas duplicaban el objeto` ayuda mucho.
- **Sin paso de build en el gamemode.** Es JS puro que SkyMP carga directamente. `npm run typecheck` usa `types/mp.d.ts` y es informativo — no introduzcas compilación, añadiría un paso al ciclo más lento del proyecto (editar → probar en el juego).
- Sigue el estilo del archivo que estás editando, aunque tú lo harías distinto.

### Tipar el API `mp`

`skymp/gamemode/types/mp.d.ts` marca la procedencia de cada firma: `[DOC]` para lo que está en la documentación oficial de SkyMP, `[USO]` para lo inferido de nuestro uso.

Cuando descubras algo nuevo en una prueba real, agrégalo como `[USO]` y di dónde se observó. La distinción importa: `[USO]` puede cambiar sin aviso en una actualización de SkyMP.

---

## 5. Commits y Pull Requests

Usamos [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(gamemode): adiciona zona segura por celula
fix(web): valida redirect_uri antes de trocar o code
docs: documenta o contrato de FormID
```

Ámbitos en uso: `gamemode`, `web`, `game-api`, `bot-discord`, `launcher`, `schema`.

Los mensajes de commit se escriben en portugués para acompañar el código, pero **el inglés está bien** si te resulta más cómodo — un mensaje claro en inglés vale más que uno confuso en portugués.

**Explica el porqué en el cuerpo del commit.** El historial de este proyecto es una fuente real de contexto; varios commits explican decisiones que no caben en el código.

### Antes de abrir un PR

- [ ] Las pruebas pasan en los servicios que tocaste
- [ ] `npm run typecheck` limpio, si tocaste el gamemode o el launcher
- [ ] Prueba nueva para comportamiento nuevo — mirando el **argumento**, no solo el resultado (ver §6)
- [ ] Documentación actualizada si cambió comportamiento o arquitectura
- [ ] Ningún secreto, `.env` real ni asset de Bethesda en el diff

---

## 6. Sobre las pruebas que dan falsa seguridad

Merece su propia advertencia, porque aquí salió caro.

El `mp` global está simulado en las pruebas. **Un mock acepta cualquier cosa** — así fue como 22 llamadas a Papyrus con el argumento mal formado pasaron meses con la suite en verde. Peor: los guards `if (typeof mp === 'undefined') return;` hacían que las pruebas ni siquiera llegaran a ese código.

Cuando pruebes algo que habla con SkyMP o con la base de datos, **verifica el argumento que se pasó**, no solo el valor de retorno:

```js
// débil: pasa aunque el formato esté mal
assert.equal(await service.giveItem(...), true);

// fuerte: atrapa errores de contrato
assert.equal(typeof call.self, 'object', 'self debe ser objeto, no FormID');
assert.match(query.sql, /FOR UPDATE/, 'sin el lock, dos compras duplican el objeto');
```

`core/papyrus.test.js` y `apps/web/server.test.js` tienen ejemplos.

---

## 7. Reportar problemas

- **Duda, idea suelta o pedido de ayuda**: [Discussions](https://github.com/vinicius3232/skymp-heavy-rp/discussions). Ahí la respuesta queda visible para quien venga después.
- **Bug o propuesta concreta**: abre un issue. Di qué servicio, qué esperabas y qué pasó.
- **Fallo de seguridad**: **no abras un issue público** — ver [SECURITY.es.md](SECURITY.es.md).
- **Duda sobre un mod**: el [contrato mods × gamemode](docs/technical/MODS_AND_GAMEMODE_CONTRACT.md) §4 tiene una prueba de cuatro preguntas que resuelve la mayoría de los casos.

---

## 8. Por dónde empezar a leer

1. [`docs/README.md`](docs/README.md) — el mapa de la documentación
2. [`docs/technical/QA_REPORT_2026-08.md`](docs/technical/QA_REPORT_2026-08.md) — el estado real de cada componente, incluyendo lo que **no** está listo
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — cómo se comunican las piezas

Están en portugués — ver la [nota sobre el idioma](README.es.md#idioma-de-la-documentación). El informe de QA es el más honesto sobre dónde está el proyecto; si algo te parece raro en el código, lo más probable es que ya esté documentado ahí.
