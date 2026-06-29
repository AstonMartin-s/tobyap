// Scheduler in-process: corre una vez al bootear el server (Railway = proceso
// long-running). Reintenta los eventos CAPI fallidos cada N minutos sin depender
// de un cron externo. El endpoint /api/cron/retry queda como disparo manual.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // solo runtime Node
  if (process.env.DISABLE_RETRY_SCHEDULER === '1') return; // escape hatch

  const everyMs = Number(process.env.RETRY_INTERVAL_MS ?? 10 * 60_000); // 10 min
  const { retryFailedEvents } = await import('@/lib/meta');

  const tick = async () => {
    try {
      const r = await retryFailedEvents();
      if (r.scanned) console.log('[retry-scheduler]', r);
    } catch (e) {
      console.error('[retry-scheduler] error:', e);
    }
  };

  // Un primer tick a los 30s (deja que la DB/levante todo) y luego cada N min.
  setTimeout(tick, 30_000);
  setInterval(tick, everyMs);
  console.log(`[retry-scheduler] activo · cada ${Math.round(everyMs / 60000)} min`);
}
