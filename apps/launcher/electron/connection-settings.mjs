import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';

export const CONNECTION_SETTINGS_ERROR_CODES = Object.freeze({
  INVALID_GAME_PATH: 'INVALID_GAME_PATH',
  EMPTY_TICKET: 'EMPTY_TICKET',
  INVALID_SERVER_HOST: 'INVALID_SERVER_HOST',
  INVALID_SERVER_PORT: 'INVALID_SERVER_PORT',
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
      `O arquivo de conexão existente não contém JSON válido: ${path.basename(filePath)}`,
      cause
    );
  }
  if (!isRecord(parsed)) {
    throw new ConnectionSettingsError(
      'INVALID_EXISTING_SHAPE',
      `O arquivo de conexão existente precisa conter um objeto JSON: ${path.basename(filePath)}`
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
      `Não foi possível reler a configuração gravada: ${path.basename(filePath)}`,
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
 * @param {{gamePath:string, ticket:string, serverIp:string, serverPort:number|string, discordId?:string}} input
 * @returns {{configPath:string, clientSettingsPath:string, config:Record<string, unknown>, clientSettings:Record<string, unknown>}}
 */
export function prepararConfiguracaoConexao(input) {
  const gamePath = typeof input?.gamePath === 'string' ? input.gamePath.trim() : '';
  if (!gamePath || gamePath.includes('\0')) {
    throw new ConnectionSettingsError('INVALID_GAME_PATH', 'O caminho do jogo é inválido.');
  }

  const ticket = typeof input?.ticket === 'string' ? input.ticket : '';
  if (!ticket.trim() || ticket.includes('\0')) {
    throw new ConnectionSettingsError('EMPTY_TICKET', 'O ticket de inicialização está vazio ou inválido.');
  }

  const serverIp = typeof input?.serverIp === 'string' ? input.serverIp.trim() : '';
  if (!isValidHost(serverIp)) {
    throw new ConnectionSettingsError('INVALID_SERVER_HOST', 'O host do servidor é inválido.');
  }

  const serverPort = typeof input?.serverPort === 'string' && /^\d+$/.test(input.serverPort)
    ? Number(input.serverPort)
    : input?.serverPort;
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    throw new ConnectionSettingsError('INVALID_SERVER_PORT', 'A porta do servidor deve estar entre 1 e 65535.');
  }

  const pluginsDirectory = path.join(gamePath, 'Data', 'Platform', 'Plugins');
  const configPath = path.join(pluginsDirectory, 'skymp_config.json');
  const clientSettingsPath = path.join(pluginsDirectory, 'skymp5-client-settings.txt');

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
  clientSettings['server-info-ignore'] = true;
  clientSettings['server-ip'] = serverIp;
  clientSettings['server-port'] = serverPort;
  clientSettings.master = '';

  try {
    atomicWriteFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    atomicWriteFile(clientSettingsPath, `${JSON.stringify(clientSettings, null, 2)}\n`);
  } catch (cause) {
    throw new ConnectionSettingsError('WRITE_FAILED', 'Falha ao gravar a configuração de conexão.', cause);
  }

  const writtenConfig = readWrittenObject(configPath);
  const writtenSettings = readWrittenObject(clientSettingsPath);
  const writtenGameData = isRecord(writtenSettings.gameData) ? writtenSettings.gameData : null;
  const valid =
    writtenConfig.session === `ticket:${ticket}` &&
    writtenConfig.serverAddress === formatServerAddress(serverIp, serverPort) &&
    !hasForbiddenCredential(writtenConfig) &&
    writtenSettings['server-info-ignore'] === true &&
    writtenSettings['server-ip'] === serverIp &&
    writtenSettings['server-port'] === serverPort &&
    writtenSettings.master === '' &&
    writtenGameData !== null &&
    writtenGameData.session === ticket &&
    !hasForbiddenCredential(writtenSettings) &&
    !hasForbiddenCredential(writtenGameData);

  if (!valid) {
    throw new ConnectionSettingsError('VERIFY_FAILED', 'A configuração relida não corresponde à conexão solicitada.');
  }

  return { configPath, clientSettingsPath, config: writtenConfig, clientSettings: writtenSettings };
}

// Alias descritivo para consumidores que já adotem nomes em inglês. O contrato
// canônico usado pelo launcher é `prepararConfiguracaoConexao`.
export const prepareConnectionSettings = prepararConfiguracaoConexao;
