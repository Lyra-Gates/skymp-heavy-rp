import fs from 'fs';
import path from 'path';

/**
 * Fichiers officiels Skyrim nécessaires à l'installation Primétoile.
 *
 * Important :
 * - aucun mod du joueur n'est copié ;
 * - Skyrim.ccc n'est PAS copié ;
 * - les contenus Creation Club ne sont PAS copiés pour la Phase 0.
 */
export const PRIMETOILE_ROOT_FILES = [
  'SkyrimSE.exe',
  'SkyrimSELauncher.exe',
  'steam_api64.dll',
  'bink2w64.dll',
  'Skyrim_Default.ini',
  'High.ini',
  'Medium.ini',
  'Low.ini',
  'Ultra.ini',
];

export const PRIMETOILE_DATA_FILES = [
  'Skyrim.esm',
  'Update.esm',
  'Dawnguard.esm',
  'HearthFires.esm',
  'Dragonborn.esm',

  'Skyrim - Animations.bsa',
  'Skyrim - Interface.bsa',
  'Skyrim - Meshes0.bsa',
  'Skyrim - Meshes1.bsa',
  'Skyrim - Misc.bsa',
  'Skyrim - Shaders.bsa',
  'Skyrim - Sounds.bsa',

  'Skyrim - Textures0.bsa',
  'Skyrim - Textures1.bsa',
  'Skyrim - Textures2.bsa',
  'Skyrim - Textures3.bsa',
  'Skyrim - Textures4.bsa',
  'Skyrim - Textures5.bsa',
  'Skyrim - Textures6.bsa',
  'Skyrim - Textures7.bsa',
  'Skyrim - Textures8.bsa',

  'Video/BGS_Logo.bik',
];

export function findSkyrimVoiceArchives(sourceGamePath: string): string[] {
  const dataPath = path.join(sourceGamePath, 'Data');

  if (!fs.existsSync(dataPath)) {
    return [];
  }

  return fs
    .readdirSync(dataPath)
    .filter((name) => /^Skyrim - Voices_.*\.bsa$/i.test(name));
}
export type PrimetoileInstallProgress = {
  current: number;
  total: number;
  file: string;
};

export type PrimetoileInstallResult =
  | {
      ok: true;
      copied: number;
    }
  | {
      ok: false;
      reason: 'invalid-paths' | 'missing-source-files' | 'copy-failed';
      missing?: string[];
      error?: string;
    };

export async function copyPrimetoileBase(
  sourceGamePath: string,
  isolatedGamePath: string,
  onProgress?: (progress: PrimetoileInstallProgress) => void
): Promise<PrimetoileInstallResult> {
  const source = path.resolve(sourceGamePath);
  const destination = path.resolve(isolatedGamePath);

  // Sécurité : la source et la destination ne doivent jamais être identiques.
  if (source.toLowerCase() === destination.toLowerCase()) {
    return {
      ok: false,
      reason: 'invalid-paths'
    };
  }

  const voiceArchives = findSkyrimVoiceArchives(source);

  const files = [
    ...PRIMETOILE_ROOT_FILES.map((name) => ({
      source: path.join(source, name),
      destination: path.join(destination, name),
      displayName: name
    })),

    ...PRIMETOILE_DATA_FILES.map((name) => ({
      source: path.join(source, 'Data', name),
      destination: path.join(destination, 'Data', name),
      displayName: `Data/${name}`
    })),

    ...voiceArchives.map((name) => ({
      source: path.join(source, 'Data', name),
      destination: path.join(destination, 'Data', name),
      displayName: `Data/${name}`
    }))
  ];

  const missing = files
    .filter((file) => !fs.existsSync(file.source))
    .map((file) => file.displayName);

  if (voiceArchives.length === 0) {
    missing.push('Data/Skyrim - Voices_*.bsa');
  }

  // On ne commence aucune copie si l'installation Skyrim source
  // est incomplète.
  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'missing-source-files',
      missing
    };
  }

  try {
    await fs.promises.mkdir(destination, { recursive: true });

    for (let index = 0; index < files.length; index++) {
      const file = files[index];

      await fs.promises.mkdir(
        path.dirname(file.destination),
        { recursive: true }
      );

      onProgress?.({
        current: index + 1,
        total: files.length,
        file: file.displayName
      });

      await fs.promises.copyFile(
        file.source,
        file.destination
      );
    }

    return {
      ok: true,
      copied: files.length
    };
  } catch (error: any) {
    console.error(
      '[launcher] Échec de la copie de Skyrim vers Primétoile:',
      error
    );

    return {
      ok: false,
      reason: 'copy-failed',
      error: error?.message || String(error)
    };
  }
}