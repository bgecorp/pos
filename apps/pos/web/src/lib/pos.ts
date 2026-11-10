import { useCallback, useEffect, useState } from 'react';
import type { Channel, Handlers } from '../../../server/handlers';
import type { IpcResult } from '../../../shared/types';

type Result<K extends Channel> = Awaited<ReturnType<Handlers[K]>>;

/**
 * Calls one named operation on the local POS server (POST /rpc/<channel>).
 * Fully typed from the server's handler map, so a renamed method fails the build.
 */
export async function call<K extends Channel>(channel: K, ...args: Parameters<Handlers[K]>): Promise<Result<K>> {
  let res: Response;
  try {
    res = await fetch(`/rpc/${channel}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-POS-Client': '1' },
      body: JSON.stringify(args),
    });
  } catch {
    throw new Error('Cannot reach the POS server on this computer. Is it running?');
  }
  const body = (await res.json().catch(() => null)) as IpcResult<Result<K>> | null;
  if (!body) throw new Error(`POS server error (${res.status})`);
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

/** Loads data on mount / when deps change; `reload()` refetches. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load()
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload, setData };
}

/** Prints an HTML document (receipt) through a hidden same-origin frame. */
export function printHtml(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  frame.src = url;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  };
  document.body.appendChild(frame);
}

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | '90d';
export const RANGE_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

export function presetRange(p: RangePreset): { from: string; to: string } {
  const now = new Date();
  const back = (days: number) => localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  switch (p) {
    case 'today':
      return { from: localDate(now), to: localDate(now) };
    case 'yesterday':
      return { from: back(1), to: back(1) };
    case '7d':
      return { from: back(6), to: localDate(now) };
    case '30d':
      return { from: back(29), to: localDate(now) };
    case '90d':
      return { from: back(89), to: localDate(now) };
  }
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
