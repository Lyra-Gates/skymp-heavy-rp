import fs from 'node:fs';
import path from 'node:path';

/**
 * Normalise une installation Skyrim pour Primetoile :
 * - interface/textes en français ;
 * - aucune archive de voix vanilla chargée ;
 * - suppression des archives de voix éventuellement présentes.
 */
export async function normalizePrimetoileRuntimeV11(
  gamePath: string
): Promise<void> {
  const iniPath = path.join(
    gamePath,
    'Skyrim_Default.ini'
  );

  if (!fs.existsSync(iniPath)) {
    throw new Error(
      `Skyrim_Default.ini introuvable : ${iniPath}`
    );
  }

  let ini = await fs.promises.readFile(
    iniPath,
    'utf8'
  );

  const languagePattern =
    /^sLanguage\s*=.*$/mi;

  if (!languagePattern.test(ini)) {
    throw new Error(
      'sLanguage introuvable dans Skyrim_Default.ini.'
    );
  }

  ini = ini.replace(
    languagePattern,
    'sLanguage=FRENCH'
  );

  const archivePattern =
    /^sResourceArchiveList2=(.*)$/mi;

  if (!archivePattern.test(ini)) {
    throw new Error(
      'sResourceArchiveList2 introuvable dans Skyrim_Default.ini.'
    );
  }

  ini = ini.replace(
    archivePattern,
    (_line, archiveList: string) => {
      const archives = archiveList
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .filter(
          (name) =>
            !/^Skyrim - Voices_.*\.bsa$/i.test(name)
        );

      return `sResourceArchiveList2=${archives.join(', ')}`;
    }
  );

  await fs.promises.writeFile(
    iniPath,
    ini,
    'utf8'
  );

  const dataPath = path.join(
    gamePath,
    'Data'
  );

  if (!fs.existsSync(dataPath)) {
    return;
  }

  const entries =
    await fs.promises.readdir(dataPath);

  for (const name of entries) {
    if (
      /^Skyrim - Voices_.*\.bsa(?:\.disabled)?$/i.test(name)
    ) {
      await fs.promises.rm(
        path.join(dataPath, name),
        { force: true }
      );
    }
  }
}