import fs from 'node:fs';
import path from 'node:path';

export const PRIMETOILE_ESL_PLUGINS = [
  "JK's Blue Palace.esp",
  "JKs The Drunken Huntsman.esp",
  "Sentinel - Master Plugin.esp",
  "SkyUI_SE.esp",
  "JK's Castle Volkihar.esp",
  "JK's Fort Dawnguard.esp",
  "JK's Dark Brotherhood Sanctuary.esp",
  "JK's Understone Keep.esp",
  "JK's The Bards College.esp",
  "JK's Nightgate Inn.esp",
  "JK's Castle Dour.esp",
  "JK's High Hrothgar.esp",
  "JK's Thieves Guild.esp",
  "JK's The Winking Skeever.esp",
  "JK's Temple of the Divines.esp",
  "JK's Sky Haven Temple.esp",
  "JK's Arnleif and Sons Trading Company.esp",
  "JK's Jorrvaskr.esp",
  "JK's Mistveil Keep.esp",
  "JK's Haelga's Bunkhouse.esp",
  "JK's Temple of Mara.esp",
  "JK's Nightingale Hall.esp",
  "JK's Palace of the Kings.esp",
  "JK's Temple of Dibella.esp",
  "JK's The Hag's Cure.esp",
  "JK's Sinderion's Field Laboratory.esp",
  "JK's Dragonsreach.esp",
  "JK's Silver-Blood Inn.esp",
  "JK's Elgrims Elixirs.esp",
  "JK's Bee and Barb.esp",
  "JK's New Gnisis Cornerclub.esp",
  "JK's The Pawned Prawn.esp",
  "JK's Radiant Raiment.esp",
  "JK's Riverwood Trader.esp",
  "JK's The Bannered Mare.esp",
  "JK's White Phial.esp",
  "JK's Sleeping Giant Inn.esp",
  "JK's Angelines Aromatics.esp",
  "JK's Temple of Talos.esp",
  "JK's Candlehearth Hall.esp",
  "JK's The Ragged Flagon.esp",
  "JK's Septimus Signus's Outpost.esp",
  "JK's Bits and Pieces.esp",
  "JK's Warmaiden's.esp",
  "JK's Arcadia's Cauldron.esp",
  "JK's Sadris Used Wares.esp",
  "JK's Temple of Kynareth.esp",
  "JK's Belethor's General Goods.esp",
  "BeastHHBB.esp",
  "Common Clothing Expanded.esp",
  "evgnnsmpaccessories.esp",
  "KS Hairdos Lite.esp",
  "Common Clothes and Armors.esp",
  "Sentinel.esp",
  "Sentinel - City Guards.esp",
  "Sentinel - Priests and Acolytes.esp"
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