import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  ALLOWED_ROOT_BINARIES,
  REQUIRED_ACTIVE_PLUGINS,
  REQUIRED_BASE_PLUGINS,
  ALLOWED_INACTIVE_PLUGINS,
  FORBIDDEN_ACTIVE_PLUGINS,
  ALLOWED_SKSE_DLLS
} from './integrity-allowlist.js';

export type IntegrityIssueType =
  | 'missing'
  | 'unexpected'
  | 'forbidden-active';

export type IntegrityIssue = {
  type: IntegrityIssueType;
  location: 'root' | 'data' | 'skse' | 'plugins.txt';
  file: string;
};

export type IntegrityResult = {
  ok: boolean;
  issues: IntegrityIssue[];
};

function lowerSet(values: Iterable<string>): Set<string> {
  return new Set(
    Array.from(values, value => value.toLowerCase())
  );
}

function getActivePlugins(): Set<string> {
  const pluginsFile = path.join(
    os.homedir(),
    'AppData',
    'Local',
    'Skyrim Special Edition',
    'plugins.txt'
  );

  if (!fs.existsSync(pluginsFile)) {
    return new Set();
  }

  const content = fs.readFileSync(pluginsFile, 'utf8');

  const plugins = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('*'))
    .map(line => line.slice(1).trim())
    .filter(Boolean);

  return new Set(plugins);
}

function listPluginFiles(dataPath: string): string[] {
  if (!fs.existsSync(dataPath)) {
    return [];
  }

  return fs.readdirSync(dataPath, {
    withFileTypes: true
  })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => {
      const ext = path.extname(name).toLowerCase();
      return ext === '.esp' ||
             ext === '.esm' ||
             ext === '.esl';
    });
}

function listSkseDlls(gamePath: string): string[] {
  const dir = path.join(
    gamePath,
    'Data',
    'SKSE',
    'Plugins'
  );

  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, {
    withFileTypes: true
  })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name =>
      path.extname(name).toLowerCase() === '.dll'
    );
}

function listRootBinaries(gamePath: string): string[] {
  if (!fs.existsSync(gamePath)) {
    return [];
  }

  return fs.readdirSync(gamePath, {
    withFileTypes: true
  })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => {
      const ext = path.extname(name).toLowerCase();
      return ext === '.dll' || ext === '.exe';
    });
}

export function validatePrimetoileIntegrity(
  gamePath: string
): IntegrityResult {
  const issues: IntegrityIssue[] = [];

  const dataPath = path.join(gamePath, 'Data');

  const actualPluginFiles = listPluginFiles(dataPath);
  const actualPluginFilesLower = lowerSet(actualPluginFiles);

  const activePlugins = getActivePlugins();
  const activePluginsLower = lowerSet(activePlugins);

  const requiredActiveLower =
    lowerSet(REQUIRED_ACTIVE_PLUGINS);

  const requiredBaseLower =
    lowerSet(REQUIRED_BASE_PLUGINS);

  const inactiveAllowedLower =
    lowerSet(ALLOWED_INACTIVE_PLUGINS);

  /*
   * 1. Vérifie la présence des masters / Primetoile.esp
   */
  for (const plugin of REQUIRED_BASE_PLUGINS) {
    if (!actualPluginFilesLower.has(plugin.toLowerCase())) {
      issues.push({
        type: 'missing',
        location: 'data',
        file: plugin
      });
    }
  }

  /*
   * 2. Vérifie que tous les mods Vortex requis existent
   */
  for (const plugin of REQUIRED_ACTIVE_PLUGINS) {
    if (!actualPluginFilesLower.has(plugin.toLowerCase())) {
      issues.push({
        type: 'missing',
        location: 'data',
        file: plugin
      });
    }
  }

  /*
   * 3. Vérifie qu'ils sont réellement actifs
   */
  for (const plugin of REQUIRED_ACTIVE_PLUGINS) {
    if (!activePluginsLower.has(plugin.toLowerCase())) {
      issues.push({
        type: 'missing',
        location: 'plugins.txt',
        file: plugin
      });
    }
  }

  /*
   * 4. Bloque les plugins explicitement interdits s'ils
   *    sont activés.
   */
  for (const plugin of FORBIDDEN_ACTIVE_PLUGINS) {
    if (activePluginsLower.has(plugin.toLowerCase())) {
      issues.push({
        type: 'forbidden-active',
        location: 'plugins.txt',
        file: plugin
      });
    }
  }

  /*
   * 5. Refuse tout .esp/.esm/.esl inconnu physiquement
   *    présent dans Data.
   */
  for (const plugin of actualPluginFiles) {
    const key = plugin.toLowerCase();

    const allowed =
      requiredActiveLower.has(key) ||
      requiredBaseLower.has(key) ||
      inactiveAllowedLower.has(key);

    if (!allowed) {
      issues.push({
        type: 'unexpected',
        location: 'data',
        file: plugin
      });
    }
  }

  /*
   * 6. Refuse tout plugin actif qui ne fait pas partie
   *    de l'allowlist.
   */
  for (const plugin of activePlugins) {
    const key = plugin.toLowerCase();

    const allowed =
      requiredActiveLower.has(key) ||
      requiredBaseLower.has(key);

    if (!allowed) {
      issues.push({
        type: 'unexpected',
        location: 'plugins.txt',
        file: plugin
      });
    }
  }

  /*
   * 7. Vérification DLL SKSE.
   */
  const actualSkseDlls = listSkseDlls(gamePath);
  const allowedSkseDllsLower =
    lowerSet(ALLOWED_SKSE_DLLS);

  for (const dll of ALLOWED_SKSE_DLLS) {
    const exists = actualSkseDlls.some(
      actual =>
        actual.toLowerCase() === dll.toLowerCase()
    );

    if (!exists) {
      issues.push({
        type: 'missing',
        location: 'skse',
        file: dll
      });
    }
  }

  for (const dll of actualSkseDlls) {
    if (!allowedSkseDllsLower.has(dll.toLowerCase())) {
      issues.push({
        type: 'unexpected',
        location: 'skse',
        file: dll
      });
    }
  }

  /*
   * 8. Vérification DLL/EXE racine.
   */
  const actualRootBinaries =
    listRootBinaries(gamePath);

  const allowedRootLower =
    lowerSet(ALLOWED_ROOT_BINARIES);

  for (const file of ALLOWED_ROOT_BINARIES) {
    const exists = actualRootBinaries.some(
      actual =>
        actual.toLowerCase() === file.toLowerCase()
    );

    if (!exists) {
      issues.push({
        type: 'missing',
        location: 'root',
        file
      });
    }
  }

  for (const file of actualRootBinaries) {
    if (!allowedRootLower.has(file.toLowerCase())) {
      issues.push({
        type: 'unexpected',
        location: 'root',
        file
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

