/**
 * disk.test.mjs
 *
 * Espaço em disco antes de baixar. O que estes testes protegem é menos o
 * cálculo e mais as duas decisões de projeto: checar **os dois destinos**
 * (temp e jogo podem estar em discos diferentes) e **não bloquear quando não
 * dá para medir**.
 *
 * Executa com: node --test electron/disk.test.mjs
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';

import { avaliarEspaco, ehDiscoCheio, formatarBytes, RESERVA_BYTES } from './disk.mjs';

const GB = 1024 * 1024 * 1024;

describe('avaliação de espaço', () => {
  it('aprova quando sobra folga', () => {
    const r = avaliarEspaco([
      { rotulo: 'temp', livreBytes: 20 * GB, necessarioBytes: 2 * GB }
    ]);
    assert.equal(r.ok, true);
    assert.equal(r.error, undefined);
  });

  it('reprova quando falta, dizendo quanto liberar', () => {
    const r = avaliarEspaco([
      { rotulo: 'C:\Temp', livreBytes: 1 * GB, necessarioBytes: 5 * GB }
    ]);
    assert.equal(r.ok, false);
    assert.match(r.error, /C:\Temp/, 'precisa dizer ONDE falta');
    assert.match(r.error, /Libere/, 'precisa dizer quanto liberar');
  });

  it('exige a reserva além do download', () => {
    // Cabe justinho o arquivo, mas nao a folga de extracao. Um disco em zero
    // absoluto quebra coisas que nao tem nada a ver com o launcher.
    const r = avaliarEspaco([
      { rotulo: 'jogo', livreBytes: 2 * GB, necessarioBytes: 2 * GB }
    ]);
    assert.equal(r.ok, false, `com ${formatarBytes(RESERVA_BYTES)} de reserva isso nao cabe`);
  });

  it('checa TODOS os destinos, não só o primeiro', () => {
    // O .zip vai pro temp e o conteudo e extraido na pasta do jogo. Podem
    // estar em discos diferentes: checar so um deixa passar metade dos casos.
    const r = avaliarEspaco([
      { rotulo: 'temp', livreBytes: 50 * GB, necessarioBytes: 2 * GB },
      { rotulo: 'jogo', livreBytes: 1 * GB, necessarioBytes: 2 * GB }
    ]);
    assert.equal(r.ok, false);
    assert.match(r.error, /jogo/, 'o segundo destino tem que ser avaliado');
  });

  it('não bloqueia quando não dá para medir', () => {
    // statfs pode faltar ou falhar. Impedir o jogador de jogar porque nao
    // conseguimos ler o espaco livre seria pior que o problema original.
    const r = avaliarEspaco([
      { rotulo: 'temp', livreBytes: null, necessarioBytes: 2 * GB }
    ]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.naoMedido, ['temp'], 'mas registra que nao foi medido');
  });

  it('manifesto sem sizeBytes não vira falso bloqueio', () => {
    for (const n of [undefined, null, 0, -1, NaN]) {
      assert.equal(avaliarEspaco([{ rotulo: 't', livreBytes: 1, necessarioBytes: n }]).ok, true);
    }
  });

  it('lista vazia é aprovada', () => {
    assert.equal(avaliarEspaco([]).ok, true);
    assert.equal(avaliarEspaco(null).ok, true);
  });
});

describe('detecção de disco cheio', () => {
  it('pega pelo código, que é o sinal confiável', () => {
    const e = new Error('qualquer coisa'); e.code = 'ENOSPC';
    assert.equal(ehDiscoCheio(e), true);
  });

  it('pega pelo texto quando o código se perdeu no caminho', () => {
    // Erro reempacotado numa Promise costuma perder o .code.
    assert.equal(ehDiscoCheio(new Error('ENOSPC: no space left on device, write')), true);
    assert.equal(ehDiscoCheio('no space left on device'), true);
  });

  it('não confunde outros erros com disco cheio', () => {
    const e = new Error('Timeout no download'); e.code = 'ETIMEDOUT';
    assert.equal(ehDiscoCheio(e), false);
    assert.equal(ehDiscoCheio(null), false);
    assert.equal(ehDiscoCheio(undefined), false);
  });
});

describe('formatação', () => {
  it('escolhe a unidade legível', () => {
    assert.equal(formatarBytes(512), '512 B');
    assert.equal(formatarBytes(1536), '1.5 KB');
    assert.equal(formatarBytes(5 * GB), '5.0 GB');
  });

  it('entrada inválida não vira NaN na tela do jogador', () => {
    for (const n of [undefined, null, NaN, -5, 'abc']) {
      assert.equal(formatarBytes(n), '?');
    }
  });
});
