import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import { copyVanillaBaseV9 } from './v9-vanilla.js';
import { validateSkyrim1170V9 } from './v9-validate.js';
import { installSkseV9 } from './v9-skse.js';
import { installSkympV9 } from './v9-skymp.js';

export const V9_TARGET_RUNTIME = '1.6.1170.0';

export type V9InstallPhase =
  | 'validate-steam'
  | 'prepare-destination'
  | 'copy-vanilla'
  | 'downgrade-runtime'
  | 'install-skse'
  | 'install-skymp'
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
      'La source Skyrim Steam et la destination Primétoile doivent être différentes.'
    );
  }

  if (
    destination.startsWith(`${source}${path.sep}`) ||
    source.startsWith(`${destination}${path.sep}`)
  ) {
    throw new Error(
      'La source Skyrim et la destination Primétoile ne doivent pas être imbriquées.'
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
        `Installation Skyrim Steam incomplète : ${full}`
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
        `Installation Primétoile incomplète : ${full}`
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
      'Interface Primétoile introuvable.'
    );
  }

  const uiEntries = await fs.promises.readdir(
    uiPath
  );

  if (uiEntries.length === 0) {
    throw new Error(
      'Interface Primétoile vide.'
    );
  }

  const runtimeValidation =
    await validateSkyrim1170V9(gamePath);

  if (!runtimeValidation.valid1170) {
    const badFiles = runtimeValidation.invalidFiles
      .map((file) => file.path)
      .join(', ');

    throw new Error(
      `Validation finale 1.6.1170 échouée : ${badFiles}`
    );
  }
}

export async function installPrimetoileV9(
  sourceGamePath: string,
  isolatedGamePath: string,
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
      'Vérification de l’installation Skyrim Steam...'
  });

  validateSteamSource(sourceGamePath);

  onProgress?.({
    phase: 'prepare-destination',
    message:
      'Préparation de Skyrim Special Edition - Primetoile...'
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

  onProgress?.({
    phase: 'downgrade-runtime',
    message:
      'Vérification de Skyrim 1.6.1170...'
  });

  const runtimeValidation =
    await validateSkyrim1170V9(
      isolatedGamePath
    );

  if (!runtimeValidation.valid1170) {
    const incompatibleFiles =
      runtimeValidation.invalidFiles
        .map((file) => file.path)
        .join(', ');

    throw new Error(
      [
        'La copie Skyrim n’est pas en 1.6.1170.',
        'Le moteur de downgrade V9 n’est pas encore branché.',
        `Fichiers concernés : ${incompatibleFiles}`
      ].join(' ')
    );
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
      'Installation du client SkyMP Primétoile...'
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

  await ensureSkyrimSavePathV9();

  onProgress?.({
    phase: 'write-connection',
    message:
      'Vérification de la configuration Primétoile...'
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
      'Validation finale de l’installation Primétoile...'
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