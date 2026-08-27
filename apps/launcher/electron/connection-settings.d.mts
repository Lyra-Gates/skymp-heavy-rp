export const CONNECTION_SETTINGS_ERROR_CODES: Readonly<{
  INVALID_GAME_PATH: 'INVALID_GAME_PATH';
  EMPTY_TICKET: 'EMPTY_TICKET';
  INVALID_SERVER_HOST: 'INVALID_SERVER_HOST';
  INVALID_SERVER_PORT: 'INVALID_SERVER_PORT';
  INVALID_EXISTING_JSON: 'INVALID_EXISTING_JSON';
  INVALID_EXISTING_SHAPE: 'INVALID_EXISTING_SHAPE';
  WRITE_FAILED: 'WRITE_FAILED';
  VERIFY_FAILED: 'VERIFY_FAILED';
}>;

export type ConnectionSettingsErrorCode =
  (typeof CONNECTION_SETTINGS_ERROR_CODES)[keyof typeof CONNECTION_SETTINGS_ERROR_CODES];

export class ConnectionSettingsError extends Error {
  readonly code: ConnectionSettingsErrorCode;
  constructor(
    code: keyof typeof CONNECTION_SETTINGS_ERROR_CODES,
    message: string,
    cause?: unknown
  );
}

export interface PrepareConnectionSettingsInput {
  gamePath: string;
  ticket: string;
  serverIp: string;
  serverPort: number | string;
  discordId?: string;
}

export interface PreparedConnectionSettings {
  configPath: string;
  clientSettingsPath: string;
  config: Record<string, unknown>;
  clientSettings: Record<string, unknown>;
}

export function prepararConfiguracaoConexao(
  input: PrepareConnectionSettingsInput
): PreparedConnectionSettings;

export const prepareConnectionSettings: typeof prepararConfiguracaoConexao;
