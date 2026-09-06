import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type V9SkympProgress = {
  step:
    | 'locate'
    | 'install-client'
    | 'install-ui'
    | 'validate';
  message: string;
};

export type V9SkympInstallResult = {
  clientFiles: number;
  uiFiles: number;
};

function resolveClientRoot(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'v9',
      'skymp-client'
    );
  }

  return path.resolve(
    process.cwd(),
    '..',
    '..',
    'skymp',
    'artifacts',
    'dist',
    'client'
  );
}

function resolveUiRoot(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'skymp-ui'
    );
  }

  return path.resolve(
    process.cwd(),
    '..',
    '..',
    'skymp',
    'ui'
  );
}

async function copyDirectory(
  source: string,
  destination: string
): Promise<number> {
  if (!fs.existsSync(source)) {
    throw new Error(
      `Source introuvable : ${source}`
    );
  }

  await fs.promises.mkdir(
    destination,
    { recursive: true }
  );

  let copiedFiles = 0;

  const entries = await fs.promises.readdir(
    source,
    {
      withFileTypes: true
    }
  );

  for (const entry of entries) {
    const sourcePath = path.join(
      source,
      entry.name
    );

    const destinationPath = path.join(
      destination,
      entry.name
    );

    if (entry.isDirectory()) {
      copiedFiles += await copyDirectory(
        sourcePath,
        destinationPath
      );

      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    await fs.promises.mkdir(
      path.dirname(destinationPath),
      { recursive: true }
    );

    await fs.promises.copyFile(
      sourcePath,
      destinationPath
    );

    copiedFiles += 1;
  }

  return copiedFiles;
}

export async function installSkympV9(
  gamePath: string,
  onProgress?: (progress: V9SkympProgress) => void
): Promise<V9SkympInstallResult> {
  const skyrimExe = path.join(
    gamePath,
    'SkyrimSE.exe'
  );

  if (!fs.existsSync(skyrimExe)) {
    throw new Error(
      `Installation Skyrim invalide : ${gamePath}`
    );
  }

  onProgress?.({
    step: 'locate',
    message:
      'Localisation des composants SkyMP Primétoile...'
  });

  const clientRoot = resolveClientRoot();
  const clientData = path.join(
    clientRoot,
    'Data'
  );

  const uiRoot = resolveUiRoot();

  if (!fs.existsSync(clientData)) {
    throw new Error(
      `Artifact client SkyMP introuvable : ${clientData}`
    );
  }

  if (!fs.existsSync(uiRoot)) {
    throw new Error(
      `UI Primétoile introuvable : ${uiRoot}`
    );
  }

  onProgress?.({
    step: 'install-client',
    message:
      'Installation du client SkyMP complet...'
  });

  const clientFiles = await copyDirectory(
    clientData,
    path.join(gamePath, 'Data')
  );

  // SkyrimPlatform surveille ce dossier même lorsqu'il est vide.
  // copyDirectory ne peut pas préserver un dossier vide,
  // donc V9 doit le créer explicitement.
  const pluginsDevPath = path.join(
    gamePath,
    'Data',
    'Platform',
    'PluginsDev'
  );

  await fs.promises.mkdir(
    pluginsDevPath,
    { recursive: true }
  );

  onProgress?.({
    step: 'install-ui',
    message:
      'Installation de l’interface Primétoile...'
  });

  const uiFiles = await copyDirectory(
    uiRoot,
    path.join(
      gamePath,
      'Data',
      'Platform',
      'UI'
    )
  );

  onProgress?.({
    step: 'validate',
    message:
      'Validation du client SkyMP...'
  });

  const requiredFiles = [
    path.join(
      gamePath,
      'Data',
      'SKSE',
      'Plugins',
      'MpClientPlugin.dll'
    ),

    path.join(
      gamePath,
      'Data',
      'SKSE',
      'Plugins',
      'SkyrimPlatform.dll'
    ),

    path.join(
      gamePath,
      'Data',
      'Platform',
      'Plugins',
      'skymp5-client.js'
    ),

    path.join(
      gamePath,
      'Data',
      'Platform',
      'Plugins',
      'skymp5-client-settings.txt'
    ),

    path.join(
      gamePath,
      'Data',
      'Platform',
      'Distribution',
      'RuntimeDependencies',
      'SkyrimPlatformImpl.dll'
    )
  ];

  for (const required of requiredFiles) {
    if (!fs.existsSync(required)) {
      throw new Error(
        `Installation SkyMP incomplète : ${required}`
      );
    }
  }

  const uiEntries = await fs.promises.readdir(
    path.join(
      gamePath,
      'Data',
      'Platform',
      'UI'
    )
  );

  if (uiEntries.length === 0) {
    throw new Error(
      'L’interface Primétoile est vide après installation.'
    );
  }

  return {
    clientFiles,
    uiFiles
  };
}