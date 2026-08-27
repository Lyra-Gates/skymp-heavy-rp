import { spawn } from 'node:child_process';

/** Tempo máximo para o Windows confirmar que criou o processo do helper. */
export const VOICE_SPAWN_TIMEOUT_MS = 5_000;

/** @type {import('node:child_process').ChildProcess | null} */
let current = null;

/**
 * Sobe o `voice-helper.exe`. Só um por vez: um `/voz` novo (novo ticket) mata o
 * anterior. NÃO é `detached` — o helper é filho do launcher e morre com ele, o
 * que é aceitável (a voz para; o jogador roda `/voz` de novo). O `killGameProcesses`
 * do launcher tem `taskkill voice-helper.exe` como rede de seguranca.
 *
 * @param {string} exePath caminho absoluto do voice-helper.exe
 * @param {string[]} args ['--actor-id', ..., '--ticket', ..., '--host', ..., '--port', ...]
 * @param {string} [cwd]
 * @param {{ spawnImpl?: typeof spawn, timeoutMs?: number }} [options]
 * @returns {Promise<{ pid: number }>}
 */
export async function iniciarVoiceHelper(exePath, args, cwd, options = {}) {
  const spawnImpl = options.spawnImpl ?? spawn;
  const timeoutMs = options.timeoutMs ?? VOICE_SPAWN_TIMEOUT_MS;

  killVoiceHelper();

  let child;
  try {
    child = spawnImpl(exePath, args, {
      cwd,
      detached: false,
      stdio: 'ignore',
      shell: false,
      windowsHide: true
    });
  } catch (cause) {
    throw new Error(`Nao foi possivel iniciar o voice-helper: ${mensagem(cause)}`);
  }

  current = child;

  return await new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.removeListener('spawn', onSpawn);
      child.removeListener('error', onError);
      fn();
    };
    const onSpawn = () => finish(() => {
      if (!Number.isInteger(child.pid) || child.pid <= 0) {
        current = null;
        reject(new Error('voice-helper iniciado sem PID valido.'));
        return;
      }
      resolve({ pid: child.pid });
    });
    const onError = (cause) => finish(() => {
      current = null;
      reject(new Error(`Nao foi possivel iniciar o voice-helper: ${mensagem(cause)}`));
    });
    const timer = setTimeout(() => finish(() => {
      reject(new Error(`O Windows nao confirmou o voice-helper em ${timeoutMs} ms.`));
    }), timeoutMs);

    child.once('spawn', onSpawn);
    child.once('error', onError);
    child.once('exit', () => { if (current === child) current = null; });
  });
}

/** Mata o helper atual, se houver. Idempotente. */
export function killVoiceHelper() {
  if (current) {
    try { current.kill(); } catch { /* ja morto */ }
    current = null;
  }
}

export function voiceHelperRunning() {
  return current != null && current.exitCode == null && !current.killed;
}

/** @param {unknown} error */
function mensagem(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
