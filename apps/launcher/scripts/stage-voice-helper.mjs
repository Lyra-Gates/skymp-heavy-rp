#!/usr/bin/env node
/**
 * Copia o `voice-helper.exe` já buildado para `build-resources/`, de onde o
 * `electron-builder` o empacota como `resources/vendor/voice-helper.exe`.
 *
 * O helper é C++/CMake/MSVC — não sai do `npm run build`. Este script é a ponte:
 * se o exe existir, staja; se não, **avisa e sai 0**. Contribuidor sem toolchain
 * C++ continua conseguindo buildar o launcher, e o pacote sai sem a voz nativa
 * (que é opcional). Mesma filosofia do `CSC_LINK` ausente na assinatura.
 *
 * Para incluir a voz: buildar o helper primeiro
 *   cd voice-helper && cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=.../vcpkg.cmake \
 *       -DVCPKG_TARGET_TRIPLET=x64-windows-static && cmake --build build --config Release
 * O triplet estático importa: com o dinâmico o exe precisa de opus.dll/z.dll ao
 * lado, e este script copia só o exe. Ver docs/technical/LAUNCHER_DISTRIBUTION.md §2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(launcherDir, '../../voice-helper/build/Release/voice-helper.exe');
const destDir = path.join(launcherDir, 'build-resources');
const dest = path.join(destDir, 'voice-helper.exe');

fs.mkdirSync(destDir, { recursive: true });

// Limpa uma cópia velha: um exe stale empacotado é pior que nenhum.
if (fs.existsSync(dest)) fs.rmSync(dest);

if (!fs.existsSync(source)) {
  console.warn(
    '[stage-voice-helper] voice-helper.exe nao encontrado em\n' +
    `  ${source}\n` +
    '  O launcher sera empacotado SEM a voz por proximidade nativa.\n' +
    '  Para incluir: builde voice-helper/ (cmake --build build --config Release) antes.'
  );
  process.exit(0);
}

// Guarda contra empacotar um exe que ainda depende de DLLs (build dinamico):
// nesse caso opus.dll/z.dll estariam ao lado do source e nao seriam copiados.
const sidecars = ['opus.dll', 'z.dll'].filter((dll) =>
  fs.existsSync(path.join(path.dirname(source), dll))
);
if (sidecars.length > 0) {
  console.error(
    `[stage-voice-helper] ERRO: ${sidecars.join(', ')} ao lado do exe — build dinamico.\n` +
    '  Rebuilde com -DVCPKG_TARGET_TRIPLET=x64-windows-static (exe standalone).'
  );
  process.exit(1);
}

fs.copyFileSync(source, dest);
const kb = Math.round(fs.statSync(dest).size / 1024);
console.log(`[stage-voice-helper] voice-helper.exe stajado (${kb} KB) -> build-resources/`);
