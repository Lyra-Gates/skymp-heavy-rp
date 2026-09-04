import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Instala/repara o `voice-helper.exe` (captura de microfone fora do CEF, para a
 * voz por proximidade — ver docs/technical/VOICE_NATIVE_HELPER.md) na pasta do
 * jogo, a partir da cópia que viaja dentro do launcher.
 *
 * Diferente da UI (`ui-integrity.mjs`), isto é **fail-open**: a voz é opcional e
 * a ausência do binário não pode travar o JOGAR. O helper é buildado por CMake/
 * MSVC, não pelo `npm run build` — em máquina de contribuidor sem toolchain C++
 * o `scripts/stage-voice-helper.mjs` não staja nada e o pacote sai sem ele.
 *
 * @param {{ sourcePath: string, targetPath: string }} opts
 * @returns {{ ok: boolean, repaired: boolean, skipped?: boolean, reason?: string, error?: string }}
 */
export function syncVoiceHelper({ sourcePath, targetPath }) {
  try {
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      // Não é erro: só significa que este pacote foi montado sem o helper.
      return { ok: true, repaired: false, skipped: true, reason: 'binaire non inclus dans le paquet' };
    }

    const targetValid = fs.existsSync(targetPath)
      && fs.statSync(targetPath).isFile()
      && sha256(targetPath) === sha256(sourcePath);

    if (targetValid) return { ok: true, repaired: false };

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    return { ok: true, repaired: true };
  } catch (error) {
    // Ainda fail-open pro chamador, mas devolve a causa pra log.
    return { ok: false, repaired: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
