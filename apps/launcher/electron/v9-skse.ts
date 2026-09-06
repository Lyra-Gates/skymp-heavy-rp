import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const sevenBin = require('7zip-bin') as {
  path7za: string;
};

const SKSE_VERSION = '2.2.6';
const SKSE_RUNTIME = '1.6.1170.0';

const SKSE_ARCHIVE_NAME = 'skse64_2_02_06.7z';

const SKSE_URL =
  'https://skse.silverlock.org/download/archive/skse64_2_02_06.7z';

const SKSE_ARCHIVE_SHA256 =
  'D7297F1A1D613E5265E1AF4DBBFE8BD37A32719C1CCEF363FC6187FA6EBA0848';

const SKSE_EXTRACTED_ROOT = 'skse64_2_02_06';

export type V9SkseProgress = {
  step:
    | 'download'
    | 'verify'
    | 'extract'
    | 'install'
    | 'validate';
  message: string;
};

export type V9SkseInstallResult = {
  version: string;
  runtime: string;
  archiveSha256: string;
  installedFiles: number;
};

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => {
      resolve(hash.digest('hex').toUpperCase());
    });
  });
}

function downloadFile(
  url: string,
  destination: string,
  redirects = 0
): Promise<void> {
  if (redirects > 5) {
    return Promise.reject(
      new Error('Trop de redirections pendant le téléchargement de SKSE.')
    );
  }

  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Primetoile-Launcher-V9'
        }
      },
      (response) => {
        const status = response.statusCode ?? 0;

        if (
          [301, 302, 303, 307, 308].includes(status) &&
          response.headers.location
        ) {
          response.resume();

          const redirectedUrl = new URL(
            response.headers.location,
            url
          ).toString();

          downloadFile(
            redirectedUrl,
            destination,
            redirects + 1
          )
            .then(resolve)
            .catch(reject);

          return;
        }

        if (status !== 200) {
          response.resume();

          reject(
            new Error(
              `Téléchargement SKSE impossible : HTTP ${status}.`
            )
          );

          return;
        }

        const output = fs.createWriteStream(destination);

        response.pipe(output);

        output.on('finish', () => {
          output.close();
          resolve();
        });

        output.on('error', (error) => {
          output.close();
          fs.rmSync(destination, { force: true });
          reject(error);
        });

        response.on('error', (error) => {
          output.close();
          fs.rmSync(destination, { force: true });
          reject(error);
        });
      }
    );

    request.on('error', reject);
  });
}

function extract7z(
  archivePath: string,
  destination: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      sevenBin.path7za,
      [
        'x',
        archivePath,
        `-o${destination}`,
        '-y'
      ],
      {
        windowsHide: true,
        stdio: 'ignore'
      }
    );

    process.on('error', reject);

    process.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Échec de l'extraction SKSE avec 7-Zip (code ${code}).`
          )
        );

        return;
      }

      resolve();
    });
  });
}

async function copyAndVerify(
  source: string,
  destination: string
): Promise<void> {
  await fs.promises.mkdir(
    path.dirname(destination),
    { recursive: true }
  );

  await fs.promises.copyFile(
    source,
    destination
  );

  const [sourceHash, destinationHash] =
    await Promise.all([
      sha256File(source),
      sha256File(destination)
    ]);

  if (sourceHash !== destinationHash) {
    throw new Error(
      `Copie SKSE invalide : ${destination}`
    );
  }
}

export async function installSkseV9(
  gamePath: string,
  onProgress?: (progress: V9SkseProgress) => void
): Promise<V9SkseInstallResult> {
  const skyrimExe = path.join(
    gamePath,
    'SkyrimSE.exe'
  );

  if (!fs.existsSync(skyrimExe)) {
    throw new Error(
      `SkyrimSE.exe introuvable : ${gamePath}`
    );
  }

  const tempRoot = path.join(
    app.getPath('temp'),
    'primetoile-launcher-v9',
    'skse'
  );

  const archivePath = path.join(
    tempRoot,
    SKSE_ARCHIVE_NAME
  );

  const extractPath = path.join(
    tempRoot,
    'extract'
  );

  await fs.promises.mkdir(
    tempRoot,
    { recursive: true }
  );

  let validCachedArchive = false;

  if (fs.existsSync(archivePath)) {
    onProgress?.({
      step: 'verify',
      message: 'Vérification du cache SKSE...'
    });

    const cachedHash =
      await sha256File(archivePath);

    validCachedArchive =
      cachedHash === SKSE_ARCHIVE_SHA256;

    if (!validCachedArchive) {
      await fs.promises.rm(
        archivePath,
        { force: true }
      );
    }
  }

  if (!validCachedArchive) {
    onProgress?.({
      step: 'download',
      message:
        'Téléchargement de SKSE 2.2.6 depuis la source officielle...'
    });

    await downloadFile(
      SKSE_URL,
      archivePath
    );
  }

  onProgress?.({
    step: 'verify',
    message: 'Vérification de SKSE 2.2.6...'
  });

  const archiveHash =
    await sha256File(archivePath);

  if (archiveHash !== SKSE_ARCHIVE_SHA256) {
    await fs.promises.rm(
      archivePath,
      { force: true }
    );

    throw new Error(
      'Le fichier SKSE téléchargé ne correspond pas au SHA-256 officiel attendu par Primétoile.'
    );
  }

  onProgress?.({
    step: 'extract',
    message: 'Extraction de SKSE 2.2.6...'
  });

  await fs.promises.rm(
    extractPath,
    {
      recursive: true,
      force: true
    }
  );

  await fs.promises.mkdir(
    extractPath,
    { recursive: true }
  );

  await extract7z(
    archivePath,
    extractPath
  );

  const root = path.join(
    extractPath,
    SKSE_EXTRACTED_ROOT
  );

  const loaderSource = path.join(
    root,
    'skse64_loader.exe'
  );

  const runtimeDllSource = path.join(
    root,
    'skse64_1_6_1170.dll'
  );

  const scriptsSource = path.join(
    root,
    'Data',
    'Scripts'
  );

  if (
    !fs.existsSync(loaderSource) ||
    !fs.existsSync(runtimeDllSource) ||
    !fs.existsSync(scriptsSource)
  ) {
    throw new Error(
      'Structure inattendue dans l’archive SKSE 2.2.6.'
    );
  }

  onProgress?.({
    step: 'install',
    message: 'Installation de SKSE 2.2.6...'
  });

  let installedFiles = 0;

  await copyAndVerify(
    loaderSource,
    path.join(
      gamePath,
      'skse64_loader.exe'
    )
  );

  installedFiles += 1;

  await copyAndVerify(
    runtimeDllSource,
    path.join(
      gamePath,
      'skse64_1_6_1170.dll'
    )
  );

  installedFiles += 1;

  const scriptEntries =
    await fs.promises.readdir(
      scriptsSource,
      {
        withFileTypes: true
      }
    );

  const pexFiles =
    scriptEntries.filter(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().endsWith('.pex')
    );

  if (pexFiles.length === 0) {
    throw new Error(
      'Aucun script SKSE .pex trouvé dans l’archive.'
    );
  }

  const targetScripts = path.join(
    gamePath,
    'Data',
    'Scripts'
  );

  await fs.promises.mkdir(
    targetScripts,
    { recursive: true }
  );

  for (const script of pexFiles) {
    await copyAndVerify(
      path.join(
        scriptsSource,
        script.name
      ),
      path.join(
        targetScripts,
        script.name
      )
    );

    installedFiles += 1;
  }

  onProgress?.({
    step: 'validate',
    message: 'Validation finale de SKSE...'
  });

  const requiredTargets = [
    path.join(
      gamePath,
      'skse64_loader.exe'
    ),
    path.join(
      gamePath,
      'skse64_1_6_1170.dll'
    ),
    path.join(
      gamePath,
      'Data',
      'Scripts',
      'skse.pex'
    )
  ];

  for (const required of requiredTargets) {
    if (!fs.existsSync(required)) {
      throw new Error(
        `Installation SKSE incomplète : ${required}`
      );
    }
  }

  return {
    version: SKSE_VERSION,
    runtime: SKSE_RUNTIME,
    archiveSha256: archiveHash,
    installedFiles
  };
}