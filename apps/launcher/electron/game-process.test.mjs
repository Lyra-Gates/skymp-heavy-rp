import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { iniciarProcessoJogo, ProcessoJogoError } from './game-process.mjs';

class ProcessoFalso extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.unrefChamadas = 0;
  }

  unref() {
    this.unrefChamadas++;
  }
}

describe('iniciarProcessoJogo', () => {
  it('usa spawn direto com cwd seguro e desacopla somente depois do evento spawn', async () => {
    const child = new ProcessoFalso(4242);
    let chamada;
    const spawnImpl = (...args) => {
      chamada = args;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    };

    const resultado = await iniciarProcessoJogo(
      'C:\\Skyrim\\skse64_loader.exe',
      'C:\\Skyrim',
      { spawnImpl, timeoutMs: 100 }
    );

    assert.deepEqual(resultado, { pid: 4242 });
    assert.equal(chamada[0], 'C:\\Skyrim\\skse64_loader.exe');
    assert.deepEqual(chamada[1], []);
    assert.deepEqual(chamada[2], {
      cwd: 'C:\\Skyrim',
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true
    });
    assert.equal(child.unrefChamadas, 1);
  });

  it('converte erro síncrono do spawn em código estável', async () => {
    const original = Object.assign(new Error('acesso negado'), { code: 'EACCES' });

    await assert.rejects(
      iniciarProcessoJogo('loader.exe', 'C:\\Jogo', {
        spawnImpl: () => { throw original; }
      }),
      (error) => {
        assert.ok(error instanceof ProcessoJogoError);
        assert.equal(error.code, 'GAME_SPAWN_FAILED');
        assert.equal(error.cause, original);
        assert.match(error.message, /acesso negado/);
        return true;
      }
    );
  });

  it('rejeita evento error e não chama unref', async () => {
    const child = new ProcessoFalso(undefined);
    const original = Object.assign(new Error('arquivo inexistente'), { code: 'ENOENT' });
    const promessa = iniciarProcessoJogo('loader.exe', 'C:\\Jogo', {
      spawnImpl: () => child,
      timeoutMs: 100
    });
    queueMicrotask(() => child.emit('error', original));

    await assert.rejects(promessa, (error) => {
      assert.equal(error.code, 'GAME_SPAWN_FAILED');
      assert.equal(error.cause, original);
      return true;
    });
    assert.equal(child.unrefChamadas, 0);
  });

  it('rejeita confirmação sem PID válido e não chama unref', async () => {
    for (const pid of [undefined, 0, -1, 1.5]) {
      const child = new ProcessoFalso(pid);
      const promessa = iniciarProcessoJogo('loader.exe', 'C:\\Jogo', {
        spawnImpl: () => child,
        timeoutMs: 100
      });
      queueMicrotask(() => child.emit('spawn'));

      await assert.rejects(promessa, (error) => {
        assert.equal(error.code, 'GAME_SPAWN_NO_PID');
        return true;
      });
      assert.equal(child.unrefChamadas, 0);
    }
  });

  it('rejeita quando não há confirmação antes do timeout', async () => {
    const child = new ProcessoFalso(undefined);

    await assert.rejects(
      iniciarProcessoJogo('loader.exe', 'C:\\Jogo', {
        spawnImpl: () => child,
        timeoutMs: 5
      }),
      (error) => {
        assert.equal(error.code, 'GAME_SPAWN_TIMEOUT');
        return true;
      }
    );
    assert.equal(child.unrefChamadas, 0);
  });
});
