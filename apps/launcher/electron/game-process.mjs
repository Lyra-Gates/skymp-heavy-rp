import { spawn } from 'node:child_process';

/** Tempo máximo para o Windows confirmar que criou o processo. */
export const GAME_SPAWN_TIMEOUT_MS = 5_000;

/**
 * Erro operacional do bootstrap do jogo. `code` é estável para a interface
 * traduzir a falha sem depender da mensagem (que pode incluir texto do SO).
 */
export class ProcessoJogoError extends Error {
  /**
   * @param {'GAME_SPAWN_FAILED'|'GAME_SPAWN_TIMEOUT'|'GAME_SPAWN_NO_PID'} code
   * @param {string} message
   * @param {{cause?: unknown}} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = 'ProcessoJogoError';
    this.code = code;
  }
}

/**
 * Inicia o SKSE diretamente, sem passar o caminho ou argumentos por um shell.
 * A Promise só resolve depois que o Node recebe a confirmação `spawn`; assim,
 * quem chama não anuncia sucesso quando o executável nem chegou a abrir.
 *
 * @param {string} exePath caminho absoluto de `skse64_loader.exe`
 * @param {string} cwd diretório do Skyrim
 * @param {{spawnImpl?: typeof spawn, timeoutMs?: number}} [options]
 * @returns {Promise<{pid: number}>}
 */
export async function iniciarProcessoJogo(exePath, cwd, options = {}) {
  const spawnImpl = options.spawnImpl ?? spawn;
  const timeoutMs = options.timeoutMs ?? GAME_SPAWN_TIMEOUT_MS;

  /** @type {import('node:child_process').ChildProcess} */
  let child;
  try {
    child = spawnImpl(exePath, [], {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true
    });
  } catch (cause) {
    throw new ProcessoJogoError(
      'GAME_SPAWN_FAILED',
      `Impossible de démarrer le jeu : ${mensagemDoErro(cause)}`,
      { cause }
    );
  }

  return await new Promise((resolve, reject) => {
    let concluido = false;

    const concluir = (callback) => {
      if (concluido) return;
      concluido = true;
      clearTimeout(timer);
      child.removeListener('spawn', aoIniciar);
      child.removeListener('error', aoFalhar);
      callback();
    };

    const aoIniciar = () => concluir(() => {
      if (!Number.isInteger(child.pid) || child.pid <= 0) {
        reject(new ProcessoJogoError(
          'GAME_SPAWN_NO_PID',
          "Le processus du jeu a démarré sans fournir d'identifiant valide."
        ));
        return;
      }

      // Só desacopla depois da confirmação. Antes disso, precisamos observar
      // `error` para não transformar falha de bootstrap em falso sucesso.
      child.unref();
      resolve({ pid: child.pid });
    });

    const aoFalhar = (cause) => concluir(() => reject(new ProcessoJogoError(
      'GAME_SPAWN_FAILED',
      `Impossible de démarrer le jeu : ${mensagemDoErro(cause)}`,
      { cause }
    )));

    const timer = setTimeout(() => concluir(() => reject(new ProcessoJogoError(
      'GAME_SPAWN_TIMEOUT',
      `Windows n'a pas confirmé le démarrage du jeu dans un délai de ${timeoutMs} ms.`
    ))), timeoutMs);

    child.once('spawn', aoIniciar);
    child.once('error', aoFalhar);
  });
}

/** @param {unknown} error */
function mensagemDoErro(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
