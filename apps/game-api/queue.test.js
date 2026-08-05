const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createQueue } = require('./queue');

// Relógio controlado — a fila depende de expiração de reserva, e testar isso
// com sleeps reais tornaria a suíte lenta e instável.
function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

let ticketCounter = 0;
const makeTicket = () => `ticket-${++ticketCounter}`;

describe('fila — admissão dentro da capacidade', () => {
  test('admite direto quando há slot livre', () => {
    const q = createQueue({ capacity: 2 });
    const res = q.join(1, 'd1', makeTicket);
    assert.equal(res.status, 'success');
    assert.ok(res.ticket);
  });

  test('enfileira quando a capacidade acabou', () => {
    const q = createQueue({ capacity: 1 });
    assert.equal(q.join(1, 'd1', makeTicket).status, 'success');

    const second = q.join(2, 'd2', makeTicket);
    assert.equal(second.status, 'queued');
    assert.equal(second.position, 1);
  });

  test('posições na fila respeitam ordem de chegada', () => {
    const q = createQueue({ capacity: 1 });
    q.join(1, 'd1', makeTicket);
    assert.equal(q.join(2, 'd2', makeTicket).position, 1);
    assert.equal(q.join(3, 'd3', makeTicket).position, 2);
  });
});

describe('fila — idempotência (o launcher faz polling)', () => {
  test('join repetido devolve o mesmo ticket, não um slot novo', () => {
    const q = createQueue({ capacity: 2 });
    const first = q.join(7, 'd7', makeTicket);
    const second = q.join(7, 'd7', makeTicket);

    assert.equal(second.status, 'success');
    assert.equal(second.ticket, first.ticket, 'o ticket precisa ser estável entre chamadas');
    assert.equal(q.snapshot().occupied, 1, 'não pode consumir dois slots pra mesma conta');
  });

  test('join repetido de quem está na fila não cria posição duplicada', () => {
    const q = createQueue({ capacity: 1 });
    q.join(1, 'd1', makeTicket);
    q.join(2, 'd2', makeTicket);

    assert.equal(q.join(2, 'd2', makeTicket).position, 1);
    assert.equal(q.snapshot().waiting, 1);
  });
});

describe('fila — liberação de slot', () => {
  test('release promove o próximo da fila', () => {
    const q = createQueue({ capacity: 1 });
    q.join(1, 'd1', makeTicket);
    q.join(2, 'd2', makeTicket);

    q.release(1, makeTicket);

    const status = q.status(2, makeTicket);
    assert.equal(status.status, 'success', 'quem estava esperando deveria ter sido promovido');
    assert.equal(q.snapshot().waiting, 0);
  });

  test('release de quem não está admitido não quebra nem promove errado', () => {
    const q = createQueue({ capacity: 1 });
    q.join(1, 'd1', makeTicket);
    assert.equal(q.release(999, makeTicket), false);
    assert.equal(q.snapshot().occupied, 1);
  });
});

describe('fila — expiração de reserva', () => {
  test('slot de quem não conectou volta pra fila depois do TTL', () => {
    const clock = makeClock();
    const q = createQueue({ capacity: 1, reservationTtlMs: 60_000, now: clock.now });

    q.join(1, 'd1', makeTicket);
    assert.equal(q.join(2, 'd2', makeTicket).status, 'queued');

    clock.advance(61_000);

    const status = q.status(2, makeTicket);
    assert.equal(status.status, 'success', 'a reserva abandonada precisa liberar o slot');
  });

  test('quem conectou NÃO perde o slot por tempo', () => {
    const clock = makeClock();
    const q = createQueue({ capacity: 1, reservationTtlMs: 60_000, now: clock.now });

    q.join(1, 'd1', makeTicket);
    q.markConnected(1);
    q.join(2, 'd2', makeTicket);

    clock.advance(10 * 60_000);

    assert.equal(q.status(2, makeTicket).status, 'queued', 'jogador em sessão não pode ser expulso pela fila');
    assert.equal(q.snapshot().connected, 1);
  });
});

describe('fila — ticket de sessão', () => {
  test('resolve ticket válido e marca conectado', () => {
    const q = createQueue({ capacity: 2 });
    const { ticket } = q.join(42, 'd42', makeTicket);

    const entry = q.resolveSessionTicket(ticket);
    assert.equal(entry.accountId, 42);
    assert.equal(entry.discordId, 'd42');

    q.markConnected(42);
    assert.equal(q.snapshot().connected, 1);
  });

  test('ticket desconhecido não resolve', () => {
    const q = createQueue({ capacity: 2 });
    q.join(1, 'd1', makeTicket);
    assert.equal(q.resolveSessionTicket('nao-existe'), null);
    assert.equal(q.resolveSessionTicket(''), null);
    assert.equal(q.resolveSessionTicket(undefined), null);
  });

  test('ticket deixa de resolver depois do release', () => {
    const q = createQueue({ capacity: 2 });
    const { ticket } = q.join(5, 'd5', makeTicket);
    q.release(5, makeTicket);
    assert.equal(q.resolveSessionTicket(ticket), null);
  });
});

describe('fila — status de quem nunca entrou', () => {
  test('reporta not_queued', () => {
    const q = createQueue({ capacity: 2 });
    assert.equal(q.status(123, makeTicket).status, 'not_queued');
  });
});
