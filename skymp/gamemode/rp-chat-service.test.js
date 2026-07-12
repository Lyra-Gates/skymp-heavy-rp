const assert = require('assert');
const { createRpChatService, RANGES } = require('./rp-chat-service');
const identity = require('./identity-service');

function createHarness() {
  const broadcasts = [];
  const notifications = [];
  const logs = [];
  let nowValue = 1000;
  let randomValue = 0.49;

  const service = createRpChatService({
    now: () => nowValue,
    random: () => randomValue,
    getCharacterName: () => 'Aela Nord',
    getDisplayName: (actorId, observerActorId) => {
      if (observerActorId === actorId) return 'Aela Nord';
      if (observerActorId === 0xaa) return 'Guerreira Conhecida';
      return 'Desconhecido';
    },
    getCharacterData: () => ({ characterId: 7, accountId: 3 }),
    sendNotification: (actorId, message) => notifications.push({ actorId, message }),
    broadcastProximityMessage: (actorId, message, radius) => {
      const render = typeof message === 'function' ? message : () => message;
      broadcasts.push({
        actorId,
        message: render(actorId),
        knownObserverMessage: render(0xaa),
        unknownObserverMessage: render(0xbb),
        radius
      });
    },
    logEvent: (event) => logs.push(event)
  });

  return {
    service,
    broadcasts,
    notifications,
    logs,
    setNow: (value) => { nowValue = value; },
    setRandom: (value) => { randomValue = value; }
  };
}

{
  const h = createHarness();
  assert.strictEqual(h.service.handleChatInput(0xff, '/me observa a porta'), true);
  assert.deepStrictEqual(h.broadcasts[0], {
    actorId: 0xff,
    message: '* Aela Nord observa a porta',
    knownObserverMessage: '* Guerreira Conhecida observa a porta',
    unknownObserverMessage: '* Desconhecido observa a porta',
    radius: RANGES.emote
  });
  assert.strictEqual(h.logs[0].type, 'me');
}

{
  const h = createHarness();
  h.service.handleChatInput(0xff, '/s cuidado');
  h.service.handleChatInput(0xff, '/g guardas!');
  assert.strictEqual(h.broadcasts[0].message, 'Aela Nord sussurra: cuidado');
  assert.strictEqual(h.broadcasts[0].unknownObserverMessage, 'Desconhecido sussurra: cuidado');
  assert.strictEqual(h.broadcasts[0].radius, RANGES.whisper);
  assert.strictEqual(h.broadcasts[1].message, 'Aela Nord grita: guardas!');
  assert.strictEqual(h.broadcasts[1].knownObserverMessage, 'Guerreira Conhecida grita: guardas!');
  assert.strictEqual(h.broadcasts[1].radius, RANGES.shout);
}

{
  const h = createHarness();
  h.setRandom(0.99);
  h.service.handleChatInput(0xff, '/roll 20');
  assert.strictEqual(h.broadcasts[0].message, '* Aela Nord rolou um dado d20 e tirou: 20');
}

{
  const h = createHarness();
  h.service.handleChatInput(0xff, '/report jogador preso em porta');
  h.service.handleChatInput(0xff, '/report segundo report');
  assert.strictEqual(h.notifications[0].message, 'Report enviado para a staff.');
  assert.strictEqual(h.notifications[1].message, 'Aguarde antes de enviar outro report.');
  assert.strictEqual(h.logs[0].type, 'report');
}

{
  const h = createHarness();
  for (let i = 0; i < 6; i += 1) {
    h.service.handleChatInput(0xff, `fala ${i}`);
  }
  assert.strictEqual(h.broadcasts.length, 5);
  assert.strictEqual(h.notifications[0].message, 'Voce esta enviando mensagens rapido demais.');

  h.setNow(12000);
  h.service.handleChatInput(0xff, 'voltou ao normal');
  assert.strictEqual(h.broadcasts.length, 6);
}

{
  const h = createHarness();
  assert.strictEqual(h.service.handleChatInput(0xff, '/kick ff motivo'), false);
}

{
  const observer = { characterId: 10, firstName: 'Jon', lastName: 'Battleborn' };
  const target = { characterId: 20, firstName: 'Jarl', lastName: 'Balgruuf' };
  assert.strictEqual(identity.getDisplayName(observer, target), 'Desconhecido');
  identity.cacheKnownIdentity(10, 20, 'Jarl Balgruuf', 'introduced');
  assert.strictEqual(identity.getDisplayName(observer, target), 'Jarl Balgruuf');
  assert.strictEqual(identity.getDisplayName(target, target), 'Jarl Balgruuf');
}

console.log('rp-chat-service tests passed');
