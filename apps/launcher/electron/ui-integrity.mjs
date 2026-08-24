import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_ENTRYPOINT = 'index.html';

function listFiles(rootDir, relativeDir = '') {
  const currentDir = path.join(rootDir, relativeDir);
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(rootDir, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }

  return files.sort();
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Instala e repara o bundle local da UI CEF usando a cópia imutável que viaja
 * dentro do launcher. Arquivos extras não são apagados: só o conjunto que o
 * projeto possui é autoritativo e reparado.
 */
export function syncUiBundle({ sourceDir, targetDir }) {
  try {
    const sourceEntry = path.join(sourceDir, REQUIRED_ENTRYPOINT);
    if (!fs.existsSync(sourceEntry) || !fs.statSync(sourceEntry).isFile()) {
      return { ok: false, repaired: [], error: `Bundle da UI sem ${REQUIRED_ENTRYPOINT}.` };
    }

    const files = listFiles(sourceDir);
    const repaired = [];
    for (const relativePath of files) {
      const sourcePath = path.join(sourceDir, relativePath);
      const targetPath = path.join(targetDir, relativePath);
      const targetValid = fs.existsSync(targetPath)
        && fs.statSync(targetPath).isFile()
        && sha256(targetPath) === sha256(sourcePath);

      if (targetValid) continue;
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
      repaired.push(relativePath.replaceAll('\\', '/'));
    }

    return { ok: true, repaired, files: files.length };
  } catch (error) {
    return { ok: false, repaired: [], error: error instanceof Error ? error.message : String(error) };
  }
}
