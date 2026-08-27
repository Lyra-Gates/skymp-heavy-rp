import type { spawn } from 'node:child_process';

export const VOICE_SPAWN_TIMEOUT_MS: number;

export function iniciarVoiceHelper(
  exePath: string,
  args: string[],
  cwd?: string,
  options?: { spawnImpl?: typeof spawn; timeoutMs?: number }
): Promise<{ pid: number }>;

export function killVoiceHelper(): void;

export function voiceHelperRunning(): boolean;
