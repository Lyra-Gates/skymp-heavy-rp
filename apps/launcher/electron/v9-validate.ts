import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';

type ManifestFile = {
  path: string;
  size: number;
  sha256: string;
};

type Skyrim1170Manifest = {
  schemaVersion: number;
  runtime: string;
  coreFiles: ManifestFile[];
  voiceFiles: ManifestFile[];
  localizationFiles: {
    path: string;
    size: number;
  }[];
};

export type V9FileValidation = {
  path: string;
  expectedSize: number;
  actualSize: number | null;
  expectedSha256: string;
  actualSha256: string | null;
  valid: boolean;
  reason: 'ok' | 'missing' | 'size-mismatch' | 'hash-mismatch';
};

export type V9RuntimeValidation = {
  valid1170: boolean;
  runtime: string;
  files: V9FileValidation[];
  invalidFiles: V9FileValidation[];
};

function manifestPath(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'v9',
      'skyrim-1.6.1170-manifest.json'
    );
  }

  return path.resolve(
    process.cwd(),
    'build-resources',
    'skyrim-1.6.1170-manifest.json'
  );
}

function loadManifest(): Skyrim1170Manifest {
  const file = manifestPath();

  if (!fs.existsSync(file)) {
    throw new Error(`Manifest Skyrim 1.6.1170 introuvable : ${file}`);
  }

  const parsed = JSON.parse(
    fs.readFileSync(file, 'utf8')
  ) as Skyrim1170Manifest;

  if (
    parsed.schemaVersion !== 2 ||
    parsed.runtime !== '1.6.1170.0' ||
    !Array.isArray(parsed.coreFiles)
  ) {
    throw new Error('Manifest Skyrim 1.6.1170 invalide.');
  }

  return parsed;
}

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

export async function validateSkyrim1170V9(
  gamePath: string
): Promise<V9RuntimeValidation> {
  const manifest = loadManifest();
  const results: V9FileValidation[] = [];

  for (const expected of manifest.coreFiles) {
    const localPath = path.join(
      gamePath,
      ...expected.path.split('/')
    );

    if (!fs.existsSync(localPath)) {
      results.push({
        path: expected.path,
        expectedSize: expected.size,
        actualSize: null,
        expectedSha256: expected.sha256,
        actualSha256: null,
        valid: false,
        reason: 'missing'
      });

      continue;
    }

    const stat = await fs.promises.stat(localPath);

    if (stat.size !== expected.size) {
      results.push({
        path: expected.path,
        expectedSize: expected.size,
        actualSize: stat.size,
        expectedSha256: expected.sha256,
        actualSha256: null,
        valid: false,
        reason: 'size-mismatch'
      });

      continue;
    }

    const actualSha256 = await sha256File(localPath);

    const valid =
      actualSha256 === expected.sha256.toUpperCase();

    results.push({
      path: expected.path,
      expectedSize: expected.size,
      actualSize: stat.size,
      expectedSha256: expected.sha256,
      actualSha256,
      valid,
      reason: valid ? 'ok' : 'hash-mismatch'
    });
  }

  const invalidFiles = results.filter(
    (file) => !file.valid
  );

  return {
    valid1170: invalidFiles.length === 0,
    runtime: manifest.runtime,
    files: results,
    invalidFiles
  };
}