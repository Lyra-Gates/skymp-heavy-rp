/**
 * voiceChannels.test.js
 *
 * Testes das partes de voiceChannels.js que não exigem conexão real com o
 * Discord: checagem de permissão de staff, sanitização de nome de canal, e
 * o ciclo de vida de agendamento/cancelamento de remoção de canal vazio.
 * A interação real com a API do Discord (criar/apagar canal, responder
 * interação) não é coberta aqui — precisa de um bot/guild reais pra validar.
 *
 * Executa com: node --test voiceChannels.test.js
 */

const assert = require('assert');
const { describe, it, beforeEach, afterEach } = require('node:test');

const voiceChannels = require('./voiceChannels');

describe('isStaffMember', () => {
  it('permite quem tem o cargo de staff configurado', () => {
    const member = { permissions: { has: () => false }, roles: { cache: new Map([['staff-role', true]]) } };
    assert.strictEqual(voiceChannels.isStaffMember(member, 'staff-role'), true);
  });

  it('permite administrador mesmo sem o cargo de staff', () => {
    const member = { permissions: { has: () => true }, roles: { cache: new Map() } };
    assert.strictEqual(voiceChannels.isStaffMember(member, 'staff-role'), true);
  });

  it('bloqueia quem não é admin nem tem o cargo', () => {
    const member = { permissions: { has: () => false }, roles: { cache: new Map() } };
    assert.strictEqual(voiceChannels.isStaffMember(member, 'staff-role'), false);
  });

  it('bloqueia membro nulo', () => {
    assert.strictEqual(voiceChannels.isStaffMember(null, 'staff-role'), false);
  });
});

describe('sanitizeChannelName', () => {
  it('mantém nome válido', () => {
    assert.strictEqual(voiceChannels.sanitizeChannelName('Taverna do Bannered Mare'), 'Taverna do Bannered Mare');
  });

  it('corta nomes muito longos em 60 caracteres', () => {
    const long = 'x'.repeat(100);
    assert.strictEqual(voiceChannels.sanitizeChannelName(long).length, 60);
  });

  it('usa fallback pra entrada vazia', () => {
    assert.strictEqual(voiceChannels.sanitizeChannelName(''), 'sala-rp');
    assert.strictEqual(voiceChannels.sanitizeChannelName('   '), 'sala-rp');
    assert.strictEqual(voiceChannels.sanitizeChannelName(null), 'sala-rp');
  });
});

describe('ciclo de vida de canal gerenciado', () => {
  function fakeChannel(id, memberCount) {
    return { id, members: { size: memberCount }, delete: async () => {} };
  }

  beforeEach(() => {
    voiceChannels._managedChannels.clear();
  });

  afterEach(() => {
    for (const entry of voiceChannels._managedChannels.values()) {
      if (entry.emptyTimer) clearTimeout(entry.emptyTimer);
    }
    voiceChannels._managedChannels.clear();
  });

  it('agenda remoção só de canais gerenciados por nós', () => {
    const untracked = fakeChannel('untracked-channel', 0);
    voiceChannels._scheduleRemovalIfEmpty(untracked);
    assert.strictEqual(voiceChannels._managedChannels.has('untracked-channel'), false);
  });

  it('não agenda remoção se o canal ainda tem gente', () => {
    voiceChannels._managedChannels.set('c1', { createdBy: 'u1', emptyTimer: null });
    const channel = fakeChannel('c1', 2);
    voiceChannels._scheduleRemovalIfEmpty(channel);
    assert.strictEqual(voiceChannels._managedChannels.get('c1').emptyTimer, null);
  });

  it('agenda remoção quando o canal gerenciado fica vazio', () => {
    voiceChannels._managedChannels.set('c1', { createdBy: 'u1', emptyTimer: null });
    const channel = fakeChannel('c1', 0);
    voiceChannels._scheduleRemovalIfEmpty(channel);
    assert.ok(voiceChannels._managedChannels.get('c1').emptyTimer, 'deveria ter agendado um timer');
  });

  it('cancelPendingRemoval limpa o timer agendado', () => {
    voiceChannels._managedChannels.set('c1', { createdBy: 'u1', emptyTimer: null });
    const channel = fakeChannel('c1', 0);
    voiceChannels._scheduleRemovalIfEmpty(channel);
    assert.ok(voiceChannels._managedChannels.get('c1').emptyTimer);

    voiceChannels._cancelPendingRemoval('c1');
    assert.strictEqual(voiceChannels._managedChannels.get('c1').emptyTimer, null);
  });

  it('handleVoiceStateUpdate cancela remoção quando alguém entra no canal', () => {
    voiceChannels._managedChannels.set('c1', { createdBy: 'u1', emptyTimer: null });
    const channel = fakeChannel('c1', 0);
    voiceChannels._scheduleRemovalIfEmpty(channel);
    assert.ok(voiceChannels._managedChannels.get('c1').emptyTimer);

    // Alguém entra em c1: oldState sem canal, newState com channel c1.
    voiceChannels.handleVoiceStateUpdate({ channel: null }, { channel: fakeChannel('c1', 1) });
    assert.strictEqual(voiceChannels._managedChannels.get('c1').emptyTimer, null);
  });

  it('handleVoiceStateUpdate agenda remoção quando alguém sai deixando o canal vazio', () => {
    voiceChannels._managedChannels.set('c1', { createdBy: 'u1', emptyTimer: null });

    // Alguém sai de c1 (agora vazio): oldState com channel c1, newState sem canal.
    voiceChannels.handleVoiceStateUpdate({ channel: fakeChannel('c1', 0) }, { channel: null });
    assert.ok(voiceChannels._managedChannels.get('c1').emptyTimer, 'deveria ter agendado remoção ao esvaziar');
  });
});
