import type { PosLinkCode } from '@pos/shared-types';
import { api } from './api';

/** Where the POS runs (the shop computer's local POS server). */
export const POS_URL = (import.meta.env.VITE_POS_URL as string | undefined) ?? 'http://localhost:4100';

/**
 * Opens the POS already signed in: asks the API for a 5-minute one-time code and puts it
 * in the URL fragment (fragments are never sent to any server), where the POS picks it up.
 */
export async function openPos(): Promise<void> {
  const { code } = await api<PosLinkCode>('/pos/link-code', { method: 'POST' });
  window.location.assign(`${POS_URL}/#link=${encodeURIComponent(code)}`);
}
