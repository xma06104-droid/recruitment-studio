'use client';

import { useEffect, useRef } from 'react';

const CHANNEL_NAME = 'xingjian-workbench-sync';
const STORAGE_KEY = 'xingjian:workbench:last-change';

export function announceWorkbenchChange() {
  const message = { type: 'data-changed', at: Date.now() };
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(message);
    channel.close();
  } catch {}
  try { window.localStorage.setItem(STORAGE_KEY, String(message.at)); } catch {}
}

export function useWorkbenchSync(refresh: () => void | Promise<void>, intervalMs = 5000) {
  const refreshRef = useRef(refresh);
  const runningRef = useRef(false);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    const run = async () => {
      if (runningRef.current || document.visibilityState !== 'visible') return;
      runningRef.current = true;
      try { await refreshRef.current(); } finally { runningRef.current = false; }
    };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
    if (channel) channel.onmessage = () => { void run(); };
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) void run(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void run(); };
    const timer = window.setInterval(() => { void run(); }, intervalMs);
    window.addEventListener('focus', run);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      channel?.close();
      window.removeEventListener('focus', run);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}
