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