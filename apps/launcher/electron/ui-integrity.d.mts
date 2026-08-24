export type UiSyncResult = {
  ok: boolean;
  repaired: string[];
  files?: number;
  error?: string;
};

export function syncUiBundle(params: {
  sourceDir: string;
  targetDir: string;
}): UiSyncResult;
