/**
 * Tipos de `disk.mjs`. O módulo é JS puro para rodar sob `node --test` sem
 * passo de build; esta declaração mantém o `main.ts` typechecked.
 */

export const RESERVA_BYTES: number;

export function formatarBytes(n: number): string;

export function ehDiscoCheio(err: unknown): boolean;

export function avaliarEspaco(
  destinos: Array<{ rotulo: string; livreBytes: number | null; necessarioBytes: number }> | null | undefined,
  reserva?: number
): { ok: boolean; error?: string; naoMedido?: string[] };
