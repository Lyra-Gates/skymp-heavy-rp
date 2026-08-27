import type { AddressInfo } from 'node:net';

export const VOICE_HANDOFF_PORT: number;

export type VoiceHandoff = {
  actorId: number;
  ticket: string;
  host: string;
  port: number;
};

export function createVoiceHandoffServer(opts: {
  onHandoff: (h: VoiceHandoff) => Promise<{ pid?: number }>;
  host?: string;
  port?: number;
}): {
  listen(): Promise<AddressInfo | string | null>;
  arm(): void;
  disarm(): void;
  isArmed(): boolean;
  address(): AddressInfo | string | null;
  close(): Promise<void>;
};
