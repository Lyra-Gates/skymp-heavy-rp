import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';

export const CONNECTION_SETTINGS_ERROR_CODES = Object.freeze({
  INVALID_GAME_PATH: 'INVALID_GAME_PATH',
  EMPTY_TICKET: 'EMPTY_TICKET',
  INVALID_SERVER_HOST: 'INVALID_SERVER_HOST',
  INVALID_SERVER_PORT: 'INVALID_SERVER_PORT',
  INVALID_MASTER_URL: 'INVALID_MASTER_URL',
  INVALID_MASTER_KEY: 'INVALID_MASTER_KEY',
  INVALID_EXISTING_JSON: 'INVALID_EXISTING_JSON',
  INVALID_EXISTING_SHAPE: 'INVALID_EXISTING_SHAPE',
  WRITE_FAILED: 'WRITE_FAILED',
  VERIFY_FAILED: 'VERIFY_FAILED'
});

export class ConnectionSettingsError extends Error {
  /** @param {keyof typeof CONNECTION_SETTINGS_ERROR_CODES} code @param {string} message @param {unknown} [cause] */
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ConnectionSettingsError';
    this.code = CONNECTION_SETTINGS_ERROR_CODES[code];
  }
}

const FORBIDDEN_CREDENTIAL_KEYS = ['profileId', 'token', 'launcherTicket'];

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string} host */
function isValidHost(host) {
  if (net.isIP(host)) return true;
  if (host.length > 253 || host.includes('://') || /[\s/:]/.test(host)) return false;
  const labels = host.endsWith('.') ? host.slice(0, -1).split('.') : host.split('.');
  return labels.length > 0 && labels.every(label =>
    label.length >= 1 && label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  );
}

/** @param {string} host @param {number} port */
function formatServerAddress(host, port) {
  return net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
}

/**
 * Lê JSON existente sem engolir corrupção. Sobrescrever silenciosamente um
 * arquivo truncado esconderia a causa real e poderia descartar opções do
 * cliente que o launcher não conhece.
 *
 * @param {string} filePath
 */
function readExistingJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw new ConnectionSettingsError(
      'INVALID_EXISTING_JSON',
      `Le fichier de connexion existant ne contient pas de JSON valide : ${path.basename(filePath)}`,
      cause
    );
  }
  if (!isRecord(parsed)) {
    throw new ConnectionSettingsError(
      'INVALID_EXISTING_SHAPE',
      `Le fichier de connexion existant doit contenir un objet JSON : ${path.basename(filePath)}`
    );
  }
  return parsed;
}

/** @param {Record<string, unknown>} record */
function removeUntrustedCredentials(record) {
  for (const key of FORBIDDEN_CREDENTIAL_KEYS) delete record[key];
}

/**
 * Substitui um arquivo por rename no mesmo diretório. Se o destino estiver
 * read-only, abre somente a janela necessária para a troca e restaura o modo
 * anterior no arquivo novo. O temporário nunca contém o ticket no nome.
 *
 * @param {string} filePath
 * @param {string} contents
 */
function atomicWriteFile(filePath, contents) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });

  const existed = fs.existsSync(filePath);
  const previousMode = existed ? fs.statSync(filePath).mode : null;
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  let destinationModeChanged = false;

  try {
    fs.writeFileSync(tempPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    // Flush dos bytes antes de publicar o nome final.
    // Windows exige um descritor gravável para FlushFileBuffers/fsync.
    const tempFd = fs.openSync(tempPath, 'r+');
    try { fs.fsyncSync(tempFd); } finally { fs.closeSync(tempFd); }

    if (existed && previousMode !== null && (previousMode & 0o200) === 0) {
      fs.chmodSync(filePath, previousMode | 0o200);
      destinationModeChanged = true;
    }

    // Windows não permite rename por cima de um arquivo existente. Remover o
    // destino deixa uma janela mínima, mas os bytes publicados continuam sendo
    // sempre o arquivo completo. Em POSIX, rename substitui atomicamente.
    try {
      fs.renameSync(tempPath, filePath);
    } catch (cause) {
      if (process.platform !== 'win32' || !fs.existsSync(filePath)) throw cause;
      fs.unlinkSync(filePath);
      fs.renameSync(tempPath, filePath);
    }

    if (previousMode !== null) fs.chmodSync(filePath, previousMode);
  } catch (cause) {
    if (destinationModeChanged && fs.existsSync(filePath) && previousMode !== null) {
      try { fs.chmodSync(filePath, previousMode); } catch {}
    }
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    throw cause;
  }
}

/** @param {string} filePath */
function readWrittenObject(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isRecord(value)) throw new Error('JSON root is not an object');
    return value;
  } catch (cause) {
    throw new ConnectionSettingsError(
      'VERIFY_FAILED',
      `Impossible de relire la configuration enregistrée : ${path.basename(filePath)}`,
      cause
    );
  }
}

/** @param {Record<string, unknown>} record */
function hasForbiddenCredential(record) {
  return FORBIDDEN_CREDENTIAL_KEYS.some(key => Object.hasOwn(record, key));
}

/**
 * Prepara os dois contratos de conexão consumidos pelo cliente SkyMP.
 * Lança `ConnectionSettingsError` em qualquer inconsistência; o chamador não
 * deve iniciar o jogo nesse caso.
 *
 * @param {{gamePath:string, ticket:string, serverIp:string, serverPort:number|string, discordId?:string, masterUrl?:string, serverMasterKey?:string}} input
 * @returns {{configPath:string, clientSettingsPath:string, config:Record<string, unknown>, clientSettings:Record<string, unknown>}}
 */
export function prepararConfiguracaoConexao(input) {
  const gamePath = typeof input?.gamePath === 'string' ? input.gamePath.trim() : '';
  if (!gamePath || gamePath.includes('\0')) {
    throw new ConnectionSettingsError('INVALID_GAME_PATH', 'Le chemin du jeu est invalide.');
  }

  const ticket = typeof input?.ticket === 'string' ? input.ticket : '';
  if (!ticket.trim() || ticket.includes('\0')) {
    throw new ConnectionSettingsError('EMPTY_TICKET', 'Le ticket de lancement est vide ou invalide.');
  }

  const serverIp = typeof input?.serverIp === 'string' ? input.serverIp.trim() : '';
  if (!isValidHost(serverIp)) {
    throw new ConnectionSettingsError('INVALID_SERVER_HOST', "L'adresse du serveur est invalide.");
  }

  const serverPort = typeof input?.serverPort === 'string' && /^\d+$/.test(input.serverPort)
    ? Number(input.serverPort)
    : input?.serverPort;
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    throw new ConnectionSettingsError('INVALID_SERVER_PORT', 'Le port du serveur doit être compris entre 1 et 65535.');
  }

  const masterUrlInput = typeof input?.masterUrl === 'string'
    ? input.masterUrl.trim()
    : '';
  let masterUrl = '';
  let serverMasterKey = '';

  if (masterUrlInput) {
    let parsedMasterUrl;
    try {
      parsedMasterUrl = new URL(masterUrlInput);
    } catch {
      throw new ConnectionSettingsError(
        'INVALID_MASTER_URL',
        "L'URL de l'API principale est invalide."
      );
    }

    const validProtocol =
      parsedMasterUrl.protocol === 'http:' ||
      parsedMasterUrl.protocol === 'https:';
    const hasForbiddenParts =
      parsedMasterUrl.username ||
      parsedMasterUrl.password ||
      parsedMasterUrl.search ||
      parsedMasterUrl.hash;

    if (!validProtocol || hasForbiddenParts) {
      throw new ConnectionSettingsError(
        'INVALID_MASTER_URL',
        "L'URL de l'API principale doit utiliser HTTP ou HTTPS, sans identifiants."
      );
    }

    masterUrl = parsedMasterUrl.toString().replace(/\/+$/, '');
    serverMasterKey = typeof input?.serverMasterKey === 'string'
      ? input.serverMasterKey.trim()
      : '';

    if (!/^[a-z0-9._-]{1,80}$/i.test(serverMasterKey)) {
      throw new ConnectionSettingsError(
        'INVALID_MASTER_KEY',
        'La clé publique du serveur est invalide.'
      );
    }
  }

  const pluginsDirectory = path.join(gamePath, 'Data', 'Platform', 'Plugins');
  const authDirectory = path.join(gamePath, 'Data', 'Platform', 'PluginsNoLoad');
  const configPath = path.join(pluginsDirectory, 'skymp_config.json');
  const clientSettingsPath = path.join(pluginsDirectory, 'skymp5-client-settings.txt');
  const authDataPath = path.join(authDirectory, 'auth-data-no-load.js');

  // Leia ambos antes de alterar qualquer um: JSON legado corrompido falha sem
  // deixar metade da configuração atualizada.
  const config = { ...readExistingJson(configPath) };
  const clientSettings = { ...readExistingJson(clientSettingsPath) };
  const legacyGameData = isRecord(clientSettings.gameData) ? clientSettings.gameData : {};
  const gameData = { ...legacyGameData };

  removeUntrustedCredentials(config);
  removeUntrustedCredentials(clientSettings);
  removeUntrustedCredentials(gameData);

  config.session = `ticket:${ticket}`;
  config.serverAddress = formatServerAddress(serverIp, serverPort);
  if (input.discordId !== undefined) config.discordId = String(input.discordId);

  gameData.session = ticket;
  clientSettings.gameData = gameData;
  clientSettings['server-info-ignore'] = !masterUrl;
  clientSettings['server-ip'] = serverIp;
  clientSettings['server-port'] = serverPort;
  clientSettings.master = masterUrl;
  if (masterUrl) clientSettings['server-master-key'] = serverMasterKey;

  const remoteAuthData = {
    session: ticket,
    masterApiId: 0,
    discordUsername: null,
    discordDiscriminator: null,
    discordAvatar: null
  };

  try {
    atomicWriteFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    atomicWriteFile(clientSettingsPath, `${JSON.stringify(clientSettings, null, 2)}\n`);
    atomicWriteFile(authDataPath, `//${JSON.stringify(remoteAuthData)}\n`);
  } catch (cause) {
    throw new ConnectionSettingsError('WRITE_FAILED', "Échec de l'enregistrement de la configuration de connexion.", cause);
  }

  const writtenConfig = readWrittenObject(configPath);
  const writtenSettings = readWrittenObject(clientSettingsPath);
  let writtenAuthData;
  try {
    const source = fs.readFileSync(authDataPath, 'utf8');
    writtenAuthData = source.startsWith('//') ? JSON.parse(source.slice(2)) : null;
  } catch (cause) {
    throw new ConnectionSettingsError(
      'VERIFY_FAILED',
      "Impossible de relire les données d'authentification enregistrées.",
      cause
    );
  }
  const writtenGameData = isRecord(writtenSettings.gameData) ? writtenSettings.gameData : null;
  const masterContractValid = masterUrl
    ? writtenSettings['server-info-ignore'] === false &&
      writtenSettings.master === masterUrl &&
      writtenSettings['server-master-key'] === serverMasterKey
    : writtenSettings['server-info-ignore'] === true &&
      writtenSettings.master === '';

  const valid =
    writtenConfig.session === `ticket:${ticket}` &&
    writtenConfig.serverAddress === formatServerAddress(serverIp, serverPort) &&
    !hasForbiddenCredential(writtenConfig) &&
    masterContractValid &&
    writtenSettings['server-ip'] === serverIp &&
    writtenSettings['server-port'] === serverPort &&
    writtenGameData !== null &&
    writtenGameData.session === ticket &&
    !hasForbiddenCredential(writtenSettings) &&
    !hasForbiddenCredential(writtenGameData) &&
    isRecord(writtenAuthData) &&
    writtenAuthData.session === ticket &&
    writtenAuthData.masterApiId === 0 &&
    writtenAuthData.discordUsername === null &&
    writtenAuthData.discordDiscriminator === null &&
    writtenAuthData.discordAvatar === null;

  if (!valid) {
    throw new ConnectionSettingsError('VERIFY_FAILED', 'La configuration relue ne correspond pas à la connexion demandée.');
  }

  return { configPath, clientSettingsPath, config: writtenConfig, clientSettings: writtenSettings };
}

// Alias descritivo para consumidores que já adotem nomes em inglês. O contrato
// canônico usado pelo launcher é `prepararConfiguracaoConexao`.
export const prepareConnectionSettings = prepararConfiguracaoConexao;
