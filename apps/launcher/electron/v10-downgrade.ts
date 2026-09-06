import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import { validateSkyrim1170V9 } from './v9-validate.js';

const require = createRequire(import.meta.url);

const sevenBin = require('7zip-bin') as {
  path7za: string;
};

const SOURCE_17104_SKYRIMSE_SHA1 =
  '2f784a183f884067a9a41338664b55f6dc198a48';

const XDELTA_SHA1 =
  'd280cca0a52ce7e6da03bc2d27035a7b46b39c77';

const XDELTA_URLS = [
  'https://github.com/jmacd/xdelta-gpl/releases/download/v3.0.11/xdelta3-3.0.11-x86_64.exe.zip',
  'https://cdn.mulderload.eu/dependencies/xdelta3/xdelta3-3.0.11-x86_64.exe.zip'
];

const PATCH_BASE =
  'https://cdn.mulderload.eu/games/the-elder-scrolls-5-skyrim-special-edition/steam-downgrader';

type PatchArchive = {
  label: string;
  url: string;
  fileName: string;
  sha1: string;
  parts: number;
};

const CORE_PATCHES: PatchArchive[] = [
  {
    label: '489831',
    url:
      `${PATCH_BASE}/1.7.104_to_1.6.1170/489831.7z.001`,
    fileName: '489831.7z.001',
    sha1:
      '0adfa48883116c088f172f51c34f56070ffcdf80',
    parts: 2
  },
  {
    label: '489832',
    url:
      `${PATCH_BASE}/1.7.104_to_1.6.1170/489832.7z`,
    fileName: '489832.7z',
    sha1:
      'c2e1c9e57ad823a59477f942c86575388a13dbff',
    parts: 1
  },
  {
    label: '489833',
    url:
      `${PATCH_BASE}/1.7.104_to_1.6.1170/489833.7z`,
    fileName: '489833.7z',
    sha1:
      '486c9d908b8ab444e28d9d577f6fbde61d4992e9',
    parts: 1
  }
];

const FRENCH_PATCH: PatchArchive = {
  label: '489834-fr',
  url:
    `${PATCH_BASE}/1.7.99_to_1.6.640/489834.7z.001`,
  fileName: '489834.7z.001',
  sha1:
    '537743eca56cbabecefd3fa5e3ce89f986e24754',
  parts: 3
};

export type V10DowngradeStep =
  | 'detect'
  | 'download'
  | 'extract'
  | 'prepare-xdelta'
  | 'patch'
  | 'cleanup'
  | 'validate';

export type V10DowngradeProgress = {
  step: V10DowngradeStep;
  message: string;
};

export type V10DowngradeResult = {
  downgraded: boolean;
  sourceRuntime:
    | '1.6.1170'
    | '1.7.104';
  targetRuntime: '1.6.1170';
  patchedFiles: number;
};

async function hashFile(
  filePath: string,
  algorithm: 'sha1' | 'sha256'
): Promise<string> {
  return await new Promise<string>(
    (resolve, reject) => {
      const hash = createHash(algorithm);
      const input = fs.createReadStream(filePath);

      input.on('error', reject);

      input.on('data', (chunk) => {
        hash.update(chunk);
      });

      input.on('end', () => {
        resolve(hash.digest('hex'));
      });
    }
  );
}

function downloadOnce(
  url: string,
  destination: string,
  redirects = 0
): Promise<void> {
  if (redirects > 8) {
    return Promise.reject(
      new Error(
        `Trop de redirections pendant le téléchargement : ${url}`
      )
    );
  }

  return new Promise<void>(
    (resolve, reject) => {
      const request = https.get(
        url,
        {
          headers: {
            'User-Agent':
              'Primetoile-Launcher/0.1.0-alpha.10'
          }
        },
        (response) => {
          const status =
            response.statusCode ?? 0;

          if (
            status >= 300 &&
            status < 400 &&
            response.headers.location
          ) {
            response.resume();

            const nextUrl = new URL(
              response.headers.location,
              url
            ).toString();

            downloadOnce(
              nextUrl,
              destination,
              redirects + 1
            ).then(resolve, reject);

            return;
          }

          if (status !== 200) {
            response.resume();

            reject(
              new Error(
                `Téléchargement impossible (${status}) : ${url}`
              )
            );

            return;
          }

          const output =
            fs.createWriteStream(destination);

          output.on('error', reject);
          response.on('error', reject);

          output.on('finish', () => {
            output.close();
            resolve();
          });

          response.pipe(output);
        }
      );

      request.on('error', reject);
    }
  );
}

async function downloadWithMirrors(
  urls: string[],
  destination: string
): Promise<void> {
  let lastError: unknown;

  for (const url of urls) {
    try {
      await downloadOnce(
        url,
        destination
      );

      return;
    } catch (error) {
      lastError = error;

      await fs.promises.rm(
        destination,
        { force: true }
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        `Téléchargement impossible : ${destination}`
      );
}

function getNextPart(
  url: string,
  fileName: string,
  part: number
): {
  url: string;
  fileName: string;
} {
  if (part === 1) {
    return {
      url,
      fileName
    };
  }

  const suffix =
    String(part).padStart(3, '0');

  return {
    url:
      url.slice(0, -3) + suffix,
    fileName:
      fileName.slice(0, -3) + suffix
  };
}

async function downloadPatchArchive(
  archive: PatchArchive,
  tempDir: string,
  onProgress?: (
    progress: V10DowngradeProgress
  ) => void
): Promise<string> {
  let firstPath = '';

  for (
    let part = 1;
    part <= archive.parts;
    part += 1
  ) {
    const current = getNextPart(
      archive.url,
      archive.fileName,
      part
    );

    const destination = path.join(
      tempDir,
      current.fileName
    );

    onProgress?.({
      step: 'download',
      message:
        archive.parts === 1
          ? `Téléchargement du patch ${archive.label}...`
          : `Téléchargement du patch ${archive.label} (${part}/${archive.parts})...`
    });

    await downloadWithMirrors(
      [current.url],
      destination
    );

    if (part === 1) {
      firstPath = destination;

      const actualHash =
        await hashFile(
          destination,
          'sha1'
        );

      if (
        actualHash.toLowerCase() !==
        archive.sha1.toLowerCase()
      ) {
        throw new Error(
          [
            `Hash invalide pour ${archive.fileName}.`,
            `Attendu : ${archive.sha1}`,
            `Obtenu : ${actualHash}`
          ].join(' ')
        );
      }
    }
  }

  return firstPath;
}

function runExecutable(
  executable: string,
  args: string[],
  cwd?: string
): Promise<void> {
  return new Promise<void>(
    (resolve, reject) => {
      const child = spawn(
        executable,
        args,
        {
          cwd,
          windowsHide: true
        }
      );

      let stderr = '';

      child.stderr.on(
        'data',
        (chunk) => {
          stderr += chunk.toString();
        }
      );

      child.on('error', reject);

      child.on(
        'close',
        (code) => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(
            new Error(
              [
                `Commande échouée (${code ?? 'inconnu'}) :`,
                executable,
                ...args,
                stderr.trim()
              ]
                .filter(Boolean)
                .join(' ')
            )
          );
        }
      );
    }
  );
}

async function extractArchive(
  archivePath: string,
  destination: string
): Promise<void> {
  await fs.promises.mkdir(
    destination,
    { recursive: true }
  );

  await runExecutable(
    sevenBin.path7za,
    [
      'x',
      archivePath,
      `-o${destination}`,
      '-y'
    ]
  );
}

async function findFilesRecursive(
  root: string,
  suffix: string
): Promise<string[]> {
  const result: string[] = [];

  if (!fs.existsSync(root)) {
    return result;
  }

  const entries =
    await fs.promises.readdir(
      root,
      {
        withFileTypes: true
      }
    );

  for (const entry of entries) {
    const full = path.join(
      root,
      entry.name
    );

    if (entry.isDirectory()) {
      result.push(
        ...await findFilesRecursive(
          full,
          suffix
        )
      );

      continue;
    }

    if (
      entry.isFile() &&
      full.toLowerCase().endsWith(
        suffix.toLowerCase()
      )
    ) {
      result.push(full);
    }
  }

  return result;
}

async function prepareContentCatalog(): Promise<void> {
  const localAppData =
    process.env.LOCALAPPDATA;

  if (!localAppData) {
    return;
  }

  const catalog = path.join(
    localAppData,
    'Skyrim Special Edition',
    'ContentCatalog.txt'
  );

  if (!fs.existsSync(catalog)) {
    return;
  }

  const content =
    await fs.promises.readFile(
      catalog,
      'utf8'
    );

  if (
    !content.includes(
      'AchievementSafe'
    )
  ) {
    return;
  }

  const backup =
    `${catalog}.before-primetoile-v10`;

  if (fs.existsSync(backup)) {
    await fs.promises.rm(
      catalog,
      { force: true }
    );

    return;
  }

  await fs.promises.rename(
    catalog,
    backup
  );
}

async function prepareXdelta(
  tempDir: string,
  onProgress?: (
    progress: V10DowngradeProgress
  ) => void
): Promise<string> {
  onProgress?.({
    step: 'prepare-xdelta',
    message:
      'Préparation du moteur xdelta3...'
  });

  const zipPath = path.join(
    tempDir,
    'xdelta3.zip'
  );

  await downloadWithMirrors(
    XDELTA_URLS,
    zipPath
  );

  const actualHash =
    await hashFile(
      zipPath,
      'sha1'
    );

  if (
    actualHash.toLowerCase() !==
    XDELTA_SHA1
  ) {
    throw new Error(
      [
        'Hash invalide pour xdelta3.',
        `Attendu : ${XDELTA_SHA1}`,
        `Obtenu : ${actualHash}`
      ].join(' ')
    );
  }

  const toolDir = path.join(
    tempDir,
    'xdelta3'
  );

  await extractArchive(
    zipPath,
    toolDir
  );

  const executable = path.join(
    toolDir,
    'xdelta3-3.0.11-x86_64.exe'
  );

  if (!fs.existsSync(executable)) {
    throw new Error(
      'Exécutable xdelta3 introuvable après extraction.'
    );
  }

  return executable;
}

async function applyXdeltaPatches(
  gamePath: string,
  xdeltaExecutable: string,
  onProgress?: (
    progress: V10DowngradeProgress
  ) => void
): Promise<number> {
  const patches =
    await findFilesRecursive(
      gamePath,
      '.xdelta'
    );

  let patchedFiles = 0;

  for (const patchFile of patches) {
    const targetFile =
      patchFile.slice(
        0,
        -'.xdelta'.length
      );

    if (!fs.existsSync(targetFile)) {
      throw new Error(
        `Fichier source requis pour le downgrade introuvable : ${targetFile}`
      );
    }

    onProgress?.({
      step: 'patch',
      message:
        `Downgrade : ${path.relative(gamePath, targetFile)}`
    });

    const newFile =
      `${targetFile}.primetoile-v10-new`;

    await fs.promises.rm(
      newFile,
      { force: true }
    );

    await runExecutable(
      xdeltaExecutable,
      [
        '-d',
        '-s',
        targetFile,
        patchFile,
        newFile
      ],
      gamePath
    );

    if (!fs.existsSync(newFile)) {
      throw new Error(
        `xdelta3 n'a pas produit le fichier attendu : ${newFile}`
      );
    }

    await fs.promises.copyFile(
      newFile,
      targetFile
    );

    await fs.promises.rm(
      newFile,
      { force: true }
    );

    await fs.promises.rm(
      patchFile,
      { force: true }
    );

    patchedFiles += 1;
  }

  return patchedFiles;
}

function assertFrenchSource(
  gamePath: string
): void {
  const frenchVoices = path.join(
    gamePath,
    'Data',
    'Skyrim - Voices_fr0.bsa'
  );

  if (!fs.existsSync(frenchVoices)) {
    throw new Error(
      [
        'Alpha.10 : le downgrade automatique est actuellement validé uniquement pour Skyrim Steam en français.',
        'Fichier attendu : Data\\Skyrim - Voices_fr0.bsa'
      ].join(' ')
    );
  }
}

export async function downgradeSkyrimTo1170V10(
  gamePath: string,
  onProgress?: (
    progress: V10DowngradeProgress
  ) => void
): Promise<V10DowngradeResult> {
  onProgress?.({
    step: 'detect',
    message:
      'Détection de la version Skyrim...'
  });

  const already1170 =
    await validateSkyrim1170V9(
      gamePath
    );

  if (already1170.valid1170) {
    return {
      downgraded: false,
      sourceRuntime: '1.6.1170',
      targetRuntime: '1.6.1170',
      patchedFiles: 0
    };
  }

  const skyrimExe = path.join(
    gamePath,
    'SkyrimSE.exe'
  );

  if (!fs.existsSync(skyrimExe)) {
    throw new Error(
      `SkyrimSE.exe introuvable : ${skyrimExe}`
    );
  }

  const sourceHash =
    await hashFile(
      skyrimExe,
      'sha1'
    );

  if (
    sourceHash.toLowerCase() !==
    SOURCE_17104_SKYRIMSE_SHA1
  ) {
    throw new Error(
      [
        'Version Skyrim non supportée par le downgrade alpha.10.',
        `SHA1 SkyrimSE.exe : ${sourceHash}`,
        'Versions supportées : 1.6.1170 et Steam 1.7.104.'
      ].join(' ')
    );
  }

  assertFrenchSource(gamePath);

  const tempDir =
    await fs.promises.mkdtemp(
      path.join(
        os.tmpdir(),
        'primetoile-v10-downgrade-'
      )
    );

  let patchedFiles = 0;

  try {
    await prepareContentCatalog();

    await fs.promises.rm(
      path.join(
        gamePath,
        'Data',
        'ShaderCache'
      ),
      {
        recursive: true,
        force: true
      }
    );

    const archives = [
      ...CORE_PATCHES,
      FRENCH_PATCH
    ];

    const downloadedArchives: string[] = [];

    for (const archive of archives) {
      const firstPart =
        await downloadPatchArchive(
          archive,
          tempDir,
          onProgress
        );

      downloadedArchives.push(
        firstPart
      );
    }

    for (
      let i = 0;
      i < downloadedArchives.length;
      i += 1
    ) {
      onProgress?.({
        step: 'extract',
        message:
          `Extraction du patch ${archives[i].label}...`
      });

      await extractArchive(
        downloadedArchives[i],
        gamePath
      );
    }

    const xdeltaExecutable =
      await prepareXdelta(
        tempDir,
        onProgress
      );

    patchedFiles =
      await applyXdeltaPatches(
        gamePath,
        xdeltaExecutable,
        onProgress
      );

    onProgress?.({
      step: 'cleanup',
      message:
        'Nettoyage des fichiers temporaires de downgrade...'
    });

    const remainingPatches =
      await findFilesRecursive(
        gamePath,
        '.xdelta'
      );

    for (
      const patch of remainingPatches
    ) {
      await fs.promises.rm(
        patch,
        { force: true }
      );
    }

    onProgress?.({
      step: 'validate',
      message:
        'Validation SHA256 de Skyrim 1.6.1170...'
    });

    const finalValidation =
      await validateSkyrim1170V9(
        gamePath
      );

    if (!finalValidation.valid1170) {
      const badFiles =
        finalValidation.invalidFiles
          .map((file) => file.path)
          .join(', ');

      throw new Error(
        `Downgrade terminé mais validation 1.6.1170 échouée : ${badFiles}`
      );
    }

    return {
      downgraded: true,
      sourceRuntime: '1.7.104',
      targetRuntime: '1.6.1170',
      patchedFiles
    };
  } finally {
    await fs.promises.rm(
      tempDir,
      {
        recursive: true,
        force: true
      }
    );
  }
}