# Схема Server Options для RP

*[Português](SERVER_OPTIONS_SCHEMA.md) · [English](SERVER_OPTIONS_SCHEMA.en.md) · **Русский** · [Español](SERVER_OPTIONS_SCHEMA.es.md)*

> **Состояние: реализовано частично.**
> Файл теперь загружается и валидируется через `skymp/gamemode/core/server-options.js`. Но **работают только опции из раздела «Что подключено сегодня»** — остальное пока остаётся контрактом на будущее.

> Загрузчик предупреждает при старте, если находит в файле опцию, которая ещё ничего не делает, и **прерывает загрузку**, если значение неверного типа или вне допустимого диапазона. Падать громко — это намеренно: опечатка в геймплейной опции, которая «почти работает», хуже, чем сервер, который не поднимается.

> **Откуда взялась эта схема:** исходные опции (`isVanillaSpawn`, `SpawnTimeToRespawn`, `spawnTimeToRespawnNPC` и подобные) — это опции сервера Red House, см. `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1 (на португальском). Они были скопированы как замысел и никогда не подключались к нашему коду — отсюда схема, описывающая поведение, которого здесь никогда не было. Таблица ниже отделяет реальное от намерений.

## 0. Что подключено сегодня

| Опция | Где действует |
|---|---|
| `chat.whisperRange` | `core/proximity-ranges.js` — чат **и** голос |
| `chat.localRange` | то же. `emote` и `ooc` выводятся из неё (×5/4 и ×5/3) |
| `chat.shoutRange` | то же |
| `chat.oocEnabled` | `rp-chat-service.js` — выключает `/ooc` и `/b` в игре |
| `chat.oocRateLimitSeconds` | `rp-chat-service.js` — окно антифлуда |
| `rp.permadeathEnabled` | `death-service.js` — истечение кровью отправляет персонажа в отставку вместо респавна |
| `spawn.playerRespawnSeconds` | `death-service.js` — пауза между смертью и респавном |
| `economy.startingGold` | `whitelist.js` — выдаётся один раз на персонажа, при первом спавне |

Все прочие задокументированные ниже опции лежат в `DECLARED_BUT_UNWIRED` в загрузчике. Реализовали одну — перенесите её в `SPEC` и обновите эту таблицу; есть тест, который не даёт файлу-примеру обзавестись новым ключом без классификации.

**Про `rp.permadeathEnabled`:** включение этого меняет смысл любой боевой сцены на сервере. Персонаж, истёкший кровью, получает `status='retired'` (никогда `DELETE`, тот же путь, что и у `/permakill`), получает уведомление и отключается. Это операционное решение, а не деталь конфигурации.

## 1. Цель

Определить собственный `server-options` для Heavy RP-сервера — с валидацией, профилями по окружениям и защитой от опасных конфигураций.

Этот файл не заменяет `server-settings.json`. Он управляет правилами геймплея, RP, администрации, чата, спавна и эксплуатации.

## 2. Принципы

- У каждой опции должен быть заданный тип.
- Продакшен обязан блокировать опасные опции.
- Изменения должны быть проверяемы.
- Значения по умолчанию должны склоняться к безопасности.
- Локальное окружение может быть свободным, staging — контролируемым, продакшен — строгим.

## 3. Пример структуры

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

## 4. Профили по окружениям

### Локальное

- Можно включать отладку.
- Можно включать hot reload.
- Можно пользоваться тестовыми командами.
- Можно использовать `databaseDriver=file`.
- Нельзя выставлять наружу.

### Staging

- Отладка ограничена.
- Hot reload только в техническое окно.
- Разрушительные команды только для dev/admin.
- Журнал аудита обязателен.
- Вайтлист может использовать группу тестировщиков.

### Продакшен

- `passwordAdminLoginEnabled=false`.
- `requireRolePermission=true`.
- `requireCommandReason=true`.
- `auditAllCommands=true`.
- `allowDestructiveCommandsInProduction=false`, кроме списка исключений, подписанного владельцем/ведущим разработчиком.
- `enableHotReload=false`.
- `enableDevTools=false`.
- `requireApprovedCharacterForSpawn=true`.

## 5. Обязательные проверки

Прерывать загрузку в продакшене, если:

- Окружение `production` и `passwordAdminLoginEnabled=true`.
- Окружение `production` и `enableHotReload=true`.
- Окружение `production` и `enableDevTools=true`.
- Окружение `production` и `requireApprovedCharacterForSpawn=false`.
- Окружение `production` и `auditAllCommands=false`.
- Окружение `production` и `requireCommandReason=false`.
- `localRange`, `whisperRange` или `shoutRange` меньше или равны нулю.
- `startingGold` отрицательный.
- `playerRespawnSeconds` меньше заданного правила смерти.

## 6. Открытые решения

- Итоговые значения радиусов чата после проверки в игре.
- Останется ли глобальный OOC включённым в продакшене или получит больший кулдаун.
- Будет ли ванильный спавн выключен, выборочен или урезан.
- Существует ли перманентная смерть на релизе.
- Можно ли использовать разрушительные команды на ивенте с предварительным разрешением.
