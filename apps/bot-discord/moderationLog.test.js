/**
 * moderationLog.test.js
 *
 * `discord.js` é mockado no `Module._load`, como o resto dos testes do bot: a
 * interação real com a API do Discord (postar no canal de verdade) não é
 * coberta aqui e precisa de um bot e uma guild reais.
 *
 * O que estes testes travam:
 *
 *   1. **Evento desconhecido não vira mensagem.** O endpoint recebe corpo de
 *      fora; um `kind` que ninguém previu não pode virar um embed vazio no
 *      canal da staff.
 *   2. **`@everyone` num motivo não vira ping.** Quem escreve o motivo é staff
 *      digitando em jogo, e o texto atravessa três processos até o Discord.
 *   3. **Falha do Discord nunca lança.** A ação de moderação já aconteceu; o
 *      canal é notificação, não registro.
 *
 * Executa com: node --test moderationLog.test.js
 */

const assert = require('assert');
const { describe, it } = require('node:test');

const moderationLog = require('./moderationLog');

const { parseEvent, buildEmbed, sendModerationLog, sanitize, EVENT_KINDS } = moderationLog;

/** Lê o embed montado sem depender da forma interna do EmbedBuilder. */
function json(embed) {
  return typeof embed.toJSON === 'function' ? embed.toJSON() : embed.data;
}

describe('parseEvent', () => {
  it('aceita os eventos conhecidos', () => {
    for (const kind of Object.keys(EVENT_KINDS)) {
      const r = parseEvent({ kind, target: 'Alguem' });
      assert.strictEqual(r.ok, true, `'${kind}' deveria ser aceito`);
      assert.strictEqual(r.evento.kind, kind);
    }
  });

  it('recusa tipo desconhecido', () => {
    // Mutação que reprova: aceitar qualquer `kind` e cair num `EVENT_KINDS[kind]`
    // indefinido — `buildEmbed` explodiria dentro do `.then()` do endpoint, que
    // é onde ninguém vê.
    const r = parseEvent({ kind: 'silenciar', target: 'Alguem' });
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /desconhecido/);
  });

  it('recusa corpo ausente ou sem alvo', () => {
    assert.strictEqual(parseEvent(null).ok, false);
    assert.strictEqual(parseEvent({ kind: 'kick' }).ok, false);
    assert.strictEqual(parseEvent({ kind: 'kick', target: '   ' }).ok, false);
  });

  it('moderator e reason sao opcionais', () => {
    const r = parseEvent({ kind: 'whitelist_reset', target: 'Alguem' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.evento.moderator, null);
    assert.strictEqual(r.evento.reason, null);
  });

  it('source ausente vira "desconhecido", nao string vazia', () => {
    // De onde veio o evento importa numa arbitragem: comando em jogo e clique
    // no painel são responsabilidades diferentes. Vazio esconderia isso.
    assert.strictEqual(parseEvent({ kind: 'kick', target: 'X' }).evento.source, 'desconhecido');
    assert.strictEqual(parseEvent({ kind: 'kick', target: 'X', source: 'gamemode' }).evento.source, 'gamemode');
  });
});

describe('sanitize', () => {
  it('quebra mencao em massa sem apagar o texto', () => {
    const limpo = sanitize('spam @everyone agora');
    assert.strictEqual(limpo.includes('@everyone'), false, '@everyone inteiro nao pode sobreviver');
    assert.ok(limpo.includes('everyone'), 'o texto continua legivel pra staff');
    assert.ok(limpo.includes('spam') && limpo.includes('agora'));
  });

  it('quebra @here tambem, sem diferenciar maiuscula', () => {
    assert.strictEqual(sanitize('@HERE olha isso').includes('@HERE'), false);
  });

  it('troca caractere de controle por espaco', () => {
    // Quebra de linha injetada num motivo desmontaria o embed.
    const limpo = sanitize('linha um\nlinha dois\u0000fim');
    assert.strictEqual(/[\u0000-\u001f]/.test(limpo), false);
    assert.ok(limpo.includes('linha um') && limpo.includes('fim'));
  });

  it('corta no tamanho pedido', () => {
    assert.strictEqual(sanitize('x'.repeat(900)).length, 512);
    assert.strictEqual(sanitize('x'.repeat(900), 128).length, 128);
  });

  it('devolve null pra vazio e pra nao-string', () => {
    assert.strictEqual(sanitize('   '), null);
    assert.strictEqual(sanitize(42), null);
    assert.strictEqual(sanitize(undefined), null);
  });
});

describe('buildEmbed', () => {
  it('traz titulo, alvo, staff e motivo', () => {
    const { evento } = parseEvent({
      kind: 'permakill', target: 'Bjorn (0xff01)', moderator: 'Vinicius (0xff02)',
      reason: 'RDM reincidente', source: 'gamemode'
    });
    const e = json(buildEmbed(evento));

    assert.match(e.title, /Permakill/);
    assert.strictEqual(e.color, EVENT_KINDS.permakill.cor);
    assert.match(e.footer.text, /gamemode/);

    const campos = Object.fromEntries(e.fields.map(f => [f.name, f.value]));
    assert.strictEqual(campos.Alvo, 'Bjorn (0xff01)');
    assert.strictEqual(campos.Staff, 'Vinicius (0xff02)');
    assert.strictEqual(campos.Motivo, 'RDM reincidente');
  });

  it('motivo ausente e explicito, nao um campo faltando', () => {
    // Um embed sem o campo pareceria "motivo em branco" e um com "_não
    // informado_" diz que ninguém escreveu. A staff precisa distinguir os dois
    // quando alguém contesta semanas depois.
    const { evento } = parseEvent({ kind: 'kick', target: 'Alguem' });
    const e = json(buildEmbed(evento));
    const motivo = e.fields.find(f => f.name === 'Motivo');
    assert.ok(motivo);
    assert.match(motivo.value, /não informado/);
  });

  it('sem moderador o campo Staff nao aparece', () => {
    const { evento } = parseEvent({ kind: 'whitelist_reset', target: 'Alguem' });
    const e = json(buildEmbed(evento));
    assert.strictEqual(e.fields.some(f => f.name === 'Staff'), false);
  });

  it('todo tipo declarado monta embed sem explodir', () => {
    // Inclui `ban`, que hoje nao tem produtor nenhum: nao existe /ban no
    // gamemode nem no painel. O teste existe pra que, no dia em que o comando
    // aparecer, ele nao precise inventar um formato novo.
    for (const kind of Object.keys(EVENT_KINDS)) {
      const { evento } = parseEvent({ kind, target: 'Alguem', reason: 'motivo' });
      const e = json(buildEmbed(evento));
      assert.ok(e.title, `'${kind}' sem titulo`);
      assert.strictEqual(typeof e.color, 'number', `'${kind}' sem cor`);
    }
  });
});

describe('sendModerationLog', () => {
  function clienteFake({ canal, erroNoFetch } = {}) {
    return {
      channels: {
        fetch: async () => {
          if (erroNoFetch) throw new Error(erroNoFetch);
          return canal;
        }
      }
    };
  }

  it('posta o embed no canal configurado', async () => {
    const enviados = [];
    const canal = { send: async (payload) => enviados.push(payload) };
    const { evento } = parseEvent({ kind: 'kick', target: 'Alguem', reason: 'motivo' });

    const r = await sendModerationLog(clienteFake({ canal }), evento, '123');

    assert.strictEqual(r.sent, true);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(enviados[0].embeds.length, 1);
    assert.match(json(enviados[0].embeds[0]).title, /Expulsão/);
  });

  it('canal nao configurado nao envia e nao e erro', async () => {
    // Servidor que não quer o canal não pode ver `/permakill` reclamar.
    const canal = { send: async () => assert.fail('nao deveria enviar') };
    const { evento } = parseEvent({ kind: 'kick', target: 'Alguem' });

    const r = await sendModerationLog(clienteFake({ canal }), evento, undefined);

    assert.strictEqual(r.sent, false);
    assert.strictEqual(r.erro, 'canal nao configurado');
  });

  it('canal inexistente nao lanca', async () => {
    const { evento } = parseEvent({ kind: 'ban', target: 'Alguem' });
    const r = await sendModerationLog(clienteFake({ canal: null }), evento, '123');
    assert.strictEqual(r.sent, false);
    assert.match(r.erro, /nao existe/);
  });

  it('canal que nao aceita mensagem (categoria, canal de voz) nao lanca', async () => {
    const { evento } = parseEvent({ kind: 'ban', target: 'Alguem' });
    const r = await sendModerationLog(clienteFake({ canal: { id: '123' } }), evento, '123');
    assert.strictEqual(r.sent, false);
    assert.match(r.erro, /nao aceita mensagem/);
  });

  it('Discord fora do ar nao lanca — a moderacao ja aconteceu', async () => {
    // Mutação que reprova: deixar o `await client.channels.fetch` sem try/catch.
    // A rejeição subiria pro `.then()` do endpoint como unhandled rejection, e
    // em algumas versões do Node isso derruba o processo — o bot inteiro cairia
    // porque o Discord ficou lento durante um kick.
    const { evento } = parseEvent({ kind: 'permakill', target: 'Alguem' });
    const r = await sendModerationLog(clienteFake({ erroNoFetch: 'ECONNRESET' }), evento, '123');
    assert.strictEqual(r.sent, false);
    assert.match(r.erro, /ECONNRESET/);
  });

  it('falha no send tambem e engolida', async () => {
    const canal = { send: async () => { throw new Error('Missing Permissions'); } };
    const { evento } = parseEvent({ kind: 'kick', target: 'Alguem' });
    const r = await sendModerationLog(clienteFake({ canal }), evento, '123');
    assert.strictEqual(r.sent, false);
    assert.match(r.erro, /Missing Permissions/);
  });
});

describe('o fonte nao guarda caractere invisivel', () => {
  it('moderationLog.js usa escape, nao o caractere cru', () => {
    // O `core/soul.js` já pagou por isto: um NUL cru no fonte deixava o arquivo
    // binário pro `grep` e pro `file`, e quem lesse a linha entenderia o
    // oposto do que ela fazia. Aqui o risco é o mesmo — o separador de menção é
    // um zero-width space, e a classe de controle está numa regex.
    const fonte = require('fs').readFileSync(require('path').join(__dirname, 'moderationLog.js'), 'utf8');
    for (const ch of fonte) {
      const o = ch.codePointAt(0);
      const invisivel = (o < 32 && !'\n\r\t'.includes(ch)) || o === 127 || o === 0x200b || o === 0xfeff;
      assert.strictEqual(invisivel, false, `caractere invisivel U+${o.toString(16)} no fonte — escreva como \\uXXXX`);
    }
  });
});
