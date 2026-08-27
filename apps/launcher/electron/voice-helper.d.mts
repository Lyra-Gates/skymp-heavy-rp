export type VoiceHelperSyncResult = {
  ok: boolean;
  repaired: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

export function syncVoiceHelper(params: {
  sourcePath: string;
  targetPath: string;
}): VoiceHelperSyncResult;
