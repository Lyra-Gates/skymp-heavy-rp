import fs from 'node:fs';
import path from 'node:path';

export const PRIMETOILE_ESL_PLUGINS = [
  "JK's Blue Palace.esp",
  'SkyUI_SE.esp',
  'BeastHHBB.esp',
  'Common Clothing Expanded.esp',
  "JK's Fort Dawnguard.esp",
  "JK's Understone Keep.esp",
  "JK's Mistveil Keep.esp",
  "JK's Palace of the Kings.esp",
  "JK's Dragonsreach.esp",
  "Spaghetti's Faction Halls - Fort Dawnguard.esp",
  'evgnnsmpaccessories.esp',
  'KS Hairdos Lite.esp',
  'Common Clothes and Armors.esp',
  "Spaghetti's Faction Halls - Bard's College.esp",
  "Spaghetti's Faction Halls - Bard's College - No Window Objects.esp",
  "Spaghetti's Faction Halls - Castle Volkihar.esp",
  "Spaghetti's Faction Halls - Castle Dour.esp",
  "Spaghetti's Faction Halls - Companions.esp",
  "Spaghetti's Faction Halls - Dark Brotherhood.esp",
  "Spaghetti's Faction Halls - Hall of the Vigilant.esp",
  "Spaghetti's Faction Halls - Thieves Guild.esp"
] as const;

export type EslNormalizationResult = {
  modified: string[];
  alreadyNormalized: string[];
  missing: string[];
};

function removeEslFlag(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r+');

  try {
    const header = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, header, 0, 12, 0);

    if (bytesRead < 12 || header.toString('latin1', 0, 4) !== 'TES4') {
      throw new Error(`En-tête TES4 invalide : ${path.basename(filePath)}`);
    }

    const flags = header.readUInt32LE(8);

    if ((flags & 0x200) === 0) {
      return false;
    }

    const normalizedFlags = flags & ~0x200;
    const flagsBuffer = Buffer.alloc(4);
    flagsBuffer.writeUInt32LE(normalizedFlags >>> 0, 0);

    fs.writeSync(fd, flagsBuffer, 0, 4, 8);
    fs.fsyncSync(fd);

    return true;
  } finally {
    fs.closeSync(fd);
  }
}

export function normalizePrimetoileEslPlugins(
  gamePath: string
): EslNormalizationResult {
  const dataPath = path.join(gamePath, 'Data');

  const result: EslNormalizationResult = {
    modified: [],
    alreadyNormalized: [],
    missing: []
  };

  for (const plugin of PRIMETOILE_ESL_PLUGINS) {
    const filePath = path.join(dataPath, plugin);

    if (!fs.existsSync(filePath)) {
      result.missing.push(plugin);
      continue;
    }

    if (removeEslFlag(filePath)) {
      result.modified.push(plugin);
    } else {
      result.alreadyNormalized.push(plugin);
    }
  }

  return result;
}