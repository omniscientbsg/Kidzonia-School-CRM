/**
 * Small per-device conveniences only. Storage can be missing or blocked
 * (private windows, strict settings), so every access is guarded and the app
 * works without it.
 */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembering is fine.
  }
}

/** The organisation last opened on this device, pre-selected in the picker. */
export const LAST_ORGANISATION_KEY = 'kz.lastOrganisationId';
