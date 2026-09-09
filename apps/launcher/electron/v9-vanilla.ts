import fs from 'node:fs';
import path from 'node:path';

export const V9_VANILLA_ROOT_FILES = [
  'SkyrimSE.exe',
  'SkyrimSELauncher.exe',
  'steam_api64.dll',
  'bink2w64.dll',
  'Skyrim_Default.ini',
  'High.ini',
  'Medium.ini',
  'Low.ini',
  'Ultra.ini'
] as const;

export const V9_VANILLA_MASTERS = [
  'Skyrim.esm',
  'Update.esm',
  'Dawnguard.esm',
  'HearthFires.esm',
  'Dragonborn.esm'
] as const;

export const V9_VANILLA_AUXILIARY_FILES = [
  'MarketplaceTextures.bsa',
  '_ResourcePack.bsa',
  '_ResourcePack.esl'
] as const;

export type V9CopyProgress = {
  current: number;
  total: number;
  file: string;
};

export type V9VanillaCopyResult =
  | {
      ok: true;
      copied: number;
    }
  | {
      ok: false;
      error: string;
      missing?: string[];
    };

function listOfficialArchives(sourceDataPath: string): string[] {
  if (!fs.existsSync(sourceDataPath)) return [];

  return fs.readdirSync(sourceDataPath)
    .filter((name) => {
      return (
        (/^Skyrim - .+\.bsa$/i.test(name) &&
        !/^Skyrim - Voices_.*\.bsa$/i.test(name)) ||
        /^(Dawnguard|Dragonborn|HearthFires)\.bsa$/i.test(name)
      );
    })
    .sort((a, b) => a.localeCompare(b));
}

async function listFilesRecursive(
  root: string,
  relativeBase = ''
): Promise<string[]> {
  const current = path.join(root, relativeBase);

  if (!fs.existsSync(current)) return [];

  const entries = await fs.promises.readdir(current, {
    withFileTypes: true
  });

  const result: string[] = [];

  for (const entry of entries) {
    const relative = path.join(relativeBase, entry.name);

    if (entry.isDirectory()) {
      result.push(
        ...(await listFilesRecursive(root, relative))
      );
    } else if (entry.isFile()) {
      result.push(relative);
    }
  }

  return result;
}

export async function copyVanillaBaseV9(
  sourceGamePath: string,
  isolatedGamePath: string,
  onProgress?: (progress: V9CopyProgress) => void
): Promise<V9VanillaCopyResult> {
  const source = path.resolve(sourceGamePath);
  const destination = path.resolve(isolatedGamePath);
  const sourceData = path.join(source, 'Data');

  if (source.toLowerCase() === destination.toLowerCase()) {
    return {
      ok: false,
      error: 'La source Steam et Primétoile utilisent le même dossier.'
    };
  }

  const archives = listOfficialArchives(sourceData);

  const stringFiles = await listFilesRecursive(
    path.join(sourceData, 'Strings')
  );

  const files = [
    ...V9_VANILLA_ROOT_FILES.map((name) => ({
      source: path.join(source, name),
      destination: path.join(destination, name),
      display: name
    })),

    ...V9_VANILLA_MASTERS.map((name) => ({
      source: path.join(sourceData, name),
      destination: path.join(destination, 'Data', name),
      display: `Data/${name}`
    })),

    ...V9_VANILLA_AUXILIARY_FILES.map((name) => ({
      source: path.join(sourceData, name),
      destination: path.join(destination, 'Data', name),
      display: `Data/${name}`
    })),

    ...archives.map((name) => ({
      source: path.join(sourceData, name),
      destination: path.join(destination, 'Data', name),
      display: `Data/${name}`
    })),

    ...stringFiles.map((name) => ({
      source: path.join(sourceData, 'Strings', name),
      destination: path.join(destination, 'Data', 'Strings', name),
      display: `Data/Strings/${name.replace(/\\/g, '/')}`
    }))
  ];

  const logo = path.join(sourceData, 'Video', 'BGS_Logo.bik');

  if (fs.existsSync(logo)) {
    files.push({
      source: logo,
      destination: path.join(
        destination,
        'Data',
        'Video',
        'BGS_Logo.bik'
      ),
      display: 'Data/Video/BGS_Logo.bik'
    });
  }

  const missing = files
    .filter((file) => !fs.existsSync(file.source))
    .map((file) => file.display);

  if (archives.length === 0) {
    missing.push('Data/*.bsa officiels');
  }

  if (missing.length > 0) {
    return {
      ok: false,
      error: 'Installation Skyrim Steam incomplète.',
      missing
    };
  }

  await fs.promises.mkdir(destination, {
    recursive: true
  });

  for (let index = 0; index < files.length; index++) {
    const file = files[index];

    await fs.promises.mkdir(
      path.dirname(file.destination),
      { recursive: true }
    );

    onProgress?.({
      current: index + 1,
      total: files.length,
      file: file.display
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
}
