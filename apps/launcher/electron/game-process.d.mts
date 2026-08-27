import type { ChildProcess, SpawnOptions, spawn } from 'node:child_process';

export const GAME_SPAWN_TIMEOUT_MS: number;

export type CodigoErroProcessoJogo =
  | 'GAME_SPAWN_FAILED'
  | 'GAME_SPAWN_TIMEOUT'
  | 'GAME_SPAWN_NO_PID';

export class ProcessoJogoError extends Error {
  readonly code: CodigoErroProcessoJogo;
  constructor(code: CodigoErroProcessoJogo, message: string, options?: ErrorOptions);
}

export interface OpcoesProcessoJogo {
  spawnImpl?: typeof spawn;
  timeoutMs?: number;
}

export function iniciarProcessoJogo(
  exePath: string,
  cwd: string,
  options?: OpcoesProcessoJogo
): Promise<{ pid: number }>;

// Mantém as importações acima verificadas pelo compilador e documenta os
// tipos usados pela implementação JS sem expor uma segunda API.
export type _SpawnContract = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
