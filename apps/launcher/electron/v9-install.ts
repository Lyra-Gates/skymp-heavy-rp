import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';

import { copyVanillaBaseV9 } from './v9-vanilla.js';
import { validateSkyrim1170V9 } from './v9-validate.js';
import { installSkseV9 } from './v9-skse.js';
import { installSkympV9 } from './v9-skymp.js';
import { downgradeSkyrimTo1170V10 } from './v10-downgrade.js';

export const V9_TARGET_RUNTIME = '1.6.1170.0';

const PRIMETOILE_ESP_SHA256 =
  '8FE4F7223ABFB8D31D96E231CCF78F7B3D9838F52AA211B419F151379CA29653';

function resolvePrimetoileEspSourceV11(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'v11',
      'Primetoile.esp'
    );
  }

  return path.resolve(
    app.getAppPath(),
    '..',
    '..',
    'skymp',
    'data',
    'Primetoile.esp'
  );
}

function sha256FileV11(filePath: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
    .toUpperCase();
}

async function installPrimetoileEspV11(
  isolatedGamePath: string
): Promise<void> {
  const sourcePath =
    resolvePrimetoileEspSourceV11();

  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `Primetoile.esp est absent des ressources du launcher : ${sourcePath}`
    );
  }

  const sourceHash =
    sha256FileV11(sourcePath);

  if (sourceHash !== PRIMETOILE_ESP_SHA256) {
    throw new Error(
      `Primetoile.esp embarque est invalide : SHA-256 ${sourceHash}`
    );
  }

  const destinationPath = path.join(
    isolatedGamePath,
    'Data',
    'Primetoile.esp'
  );

  await fs.promises.mkdir(
    path.dirname(destinationPath),
    { recursive: true }
  );

  await fs.promises.copyFile(
    sourcePath,
    destinationPath
  );

  const destinationHash =
    sha256FileV11(destinationPath);

  if (destinationHash !== PRIMETOILE_ESP_SHA256) {
    throw new Error(
      `Primetoile.esp copie dans Data est invalide : SHA-256 ${destinationHash}`
    );
  }
}

export type V9InstallPhase =
  | 'validate-steam'
  | 'prepare-destination'
  | 'copy-vanilla'
  | 'downgrade-runtime'
  | 'install-skse'
  | 'install-skymp'
  | 'install-primetoile'
  | 'install-ui'
  | 'write-connection'
  | 'validate-final';

export type V9InstallProgress = {
  phase: V9InstallPhase;
  message: string;
};

export type V9InstallResult = {
  ok: true;
  sourceGamePath: string;
  isolatedGamePath: string;
  runtime: string;
  skseInstalledFiles: number;
  skympClientFiles: number;
  uiFiles: number;
};

function normalizePath(value: string): string {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

async function ensureSkyrimSavePathV9(): Promise<void> {
  const iniPath = path.join(
    app.getPath('documents'),
    'My Games',
    'Skyrim Special Edition',
    'Skyrim.ini'
  );

  await fs.promises.mkdir(
    path.dirname(iniPath),
    { recursive: true }
  );

  let content = fs.existsSync(iniPath)
    ? await fs.promises.readFile(iniPath, 'utf8')
    : '[General]\r\n';

  const desiredLine = 'SLocalSavePath=Saves\\';

  if (/^SLocalSavePath=.*$/m.test(content)) {
    content = content.replace(
      /^SLocalSavePath=.*$/m,
      desiredLine
    );
  } else if (/^\[General\]\s*$/m.test(content)) {
    content = content.replace(
      /^\[General\]\s*$/m,
      `[General]\r\n${desiredLine}`
    );
  } else {
    content =
      `[General]\r\n${desiredLine}\r\n${content}`;
  }

  await fs.promises.writeFile(
    iniPath,
    content,
    'utf8'
  );
}

function assertSafePaths(
  sourceGamePath: string,
  isolatedGamePath: string
): void {
  const source = normalizePath(sourceGamePath);
  const destination = normalizePath(isolatedGamePath);

  if (source === destination) {
    throw new Error(
      'La source Skyrim Steam et la destination PrimÃ©toile doivent Ãªtre diffÃ©rentes.'
    );
  }

  if (
    destination.startsWith(`${source}${path.sep}`) ||
    source.startsWith(`${destination}${path.sep}`)
  ) {
    throw new Error(
      'La source Skyrim et la destination PrimÃ©toile ne doivent pas Ãªtre imbriquÃ©es.'
    );
  }
}

function validateSteamSource(sourceGamePath: string): void {
  const required = [
    'SkyrimSE.exe',
    'steam_api64.dll',
    path.join('Data', 'Skyrim.esm'),
    path.join('Data', 'Update.esm'),
    path.join('Data', 'Dawnguard.esm'),
    path.join('Data', 'HearthFires.esm'),
    path.join('Data', 'Dragonborn.esm')
  ];

  for (const relative of required) {
    const full = path.join(
      sourceGamePath,
      relative
    );

    if (!fs.existsSync(full)) {
      throw new Error(
        `Installation Skyrim Steam incomplÃ¨te : ${full}`
      );
    }
  }
}

async function validateFinalInstall(
  gamePath: string
): Promise<void> {
  const required = [
    'SkyrimSE.exe',
    'skse64_loader.exe',
    'skse64_1_6_1170.dll',

    path.join(
      'Data',
      'SKSE',
      'Plugins',
      'MpClientPlugin.dll'
    ),

    path.join(
      'Data',
      'SKSE',
      'Plugins',
      'SkyrimPlatform.dll'
    ),

    path.join(
      'Data',
      'Platform',
      'Plugins',
      'skymp5-client.js'
    ),

    path.join(
      'Data',
      'Platform',
      'Plugins',
      'skymp5-client-settings.txt'
    ),

    path.join(
      'Data',
      'Platform',
      'Distribution',
      'RuntimeDependencies',
      'SkyrimPlatformImpl.dll'
    )
  ];

  for (const relative of required) {
    const full = path.join(
      gamePath,
      relative
    );

    if (!fs.existsSync(full)) {
      throw new Error(
        `Installation PrimÃ©toile incomplÃ¨te : ${full}`
      );
    }
  }

  const uiPath = path.join(
    gamePath,
    'Data',
    'Platform',
    'UI'
  );

  if (!fs.existsSync(uiPath)) {
    throw new Error(
      'Interface PrimÃ©toile introuvable.'
    );
  }

  const uiEntries = await fs.promises.readdir(
    uiPath
  );

  if (uiEntries.length === 0) {
    throw new Error(
      'Interface PrimÃ©toile vide.'
    );
  }

  const runtimeValidation =
    await validateSkyrim1170V9(gamePath);

  if (!runtimeValidation.valid1170) {
    const badFiles = runtimeValidation.invalidFiles
      .map((file) => file.path)
      .join(', ');

    throw new Error(
      `Validation finale 1.6.1170 Ã©chouÃ©e : ${badFiles}`
    );
  }
}

export async function installPrimetoileV11(
  sourceGamePath: string,
  isolatedGamePath: string,
  installMode: '1.6' | '1.7',
  onProgress?: (
    progress: V9InstallProgress
  ) => void
): Promise<V9InstallResult> {
  assertSafePaths(
    sourceGamePath,
    isolatedGamePath
  );

  onProgress?.({
    phase: 'validate-steam',
    message:
      'VÃ©rification de lâ€™installation Skyrim Steam...'
  });

  validateSteamSource(sourceGamePath);

  onProgress?.({
    phase: 'prepare-destination',
    message:
      'PrÃ©paration de Skyrim Special Edition - Primetoile...'
  });

  await fs.promises.mkdir(
    isolatedGamePath,
    { recursive: true }
  );

  onProgress?.({
    phase: 'copy-vanilla',
    message:
      'Copie des fichiers Skyrim vanilla...'
  });

  await copyVanillaBaseV9(
    sourceGamePath,
    isolatedGamePath,
    () => {
      onProgress?.({
        phase: 'copy-vanilla',
        message: 'Copie des fichiers Skyrim vanilla...'
      });
    }
  );

  if (installMode === '1.7') {
    onProgress?.({
      phase: 'downgrade-runtime',
      message:
        'Conversion de Skyrim 1.7 vers Skyrim 1.6.1170...'
    });

    await downgradeSkyrimTo1170V10(
      isolatedGamePath,
      (progress) => {
        onProgress?.({
          phase: 'downgrade-runtime',
          message: progress.message
        });
      }
    );
  } else {
    onProgress?.({
      phase: 'downgrade-runtime',
      message:
        'Skyrim 1.6 selectionne : aucun downgrade necessaire.'
    });
  }

  onProgress?.({
    phase: 'install-skse',
    message:
      'Installation automatique de SKSE 2.2.6...'
  });

  const skse = await installSkseV9(
    isolatedGamePath,
    (progress) => {
      onProgress?.({
        phase: 'install-skse',
        message: progress.message
      });
    }
  );

  onProgress?.({
    phase: 'install-skymp',
    message:
      'Installation du client SkyMP PrimÃ©toile...'
  });

  const skymp = await installSkympV9(
    isolatedGamePath,
    (progress) => {
      onProgress?.({
        phase:
          progress.step === 'install-ui'
            ? 'install-ui'
            : 'install-skymp',
        message: progress.message
      });
    }
  );

  onProgress?.({
    phase: 'install-primetoile',
    message:
      'Installation du plugin Primetoile...'
  });

  await installPrimetoileEspV11(
    isolatedGamePath
  );

  await ensureSkyrimSavePathV9();

  onProgress?.({
    phase: 'write-connection',
    message:
      'VÃ©rification de la configuration PrimÃ©toile...'
  });

  const clientSettings = path.join(
    isolatedGamePath,
    'Data',
    'Platform',
    'Plugins',
    'skymp5-client-settings.txt'
  );

  if (!fs.existsSync(clientSettings)) {
    throw new Error(
      'Configuration de connexion SkyMP introuvable.'
    );
  }

  onProgress?.({
    phase: 'validate-final',
    message:
      'Validation finale de lâ€™installation PrimÃ©toile...'
  });

  await validateFinalInstall(
    isolatedGamePath
  );

  return {
    ok: true,
    sourceGamePath,
    isolatedGamePath,
    runtime: V9_TARGET_RUNTIME,
    skseInstalledFiles:
      skse.installedFiles,
    skympClientFiles:
      skymp.clientFiles,
    uiFiles:
      skymp.uiFiles
  };
}