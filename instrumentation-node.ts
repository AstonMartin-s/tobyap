// Scheduler in-process (solo runtime Node). Reintenta los eventos CAPI fallidos
// cada N minutos sin depender de un cron externo. Se importa desde
// instrumentation.ts únicamente cuando NEXT_RUNTIME === 'nodejs'.
import { retryFailedEvents } from '@/lib/meta';

if (process.env.DISABLE_RETRY_SCHEDULER !== '1') {
  const everyMs = Number(process.env.RETRY_INTERVAL_MS ?? 10 * 60_000); // 10 min

  const tick = async () => {
    try {
      const r = await retryFailedEvents();
      if (r.scanned) console.log('[retry-scheduler]', r);
    } catch (e) {
      console.error('[retry-scheduler] error:', e);
    }
  };

  setTimeout(tick, 30_000);
  setInterval(tick, everyMs);
  console.log(`[retry-scheduler] activo · cada ${Math.round(everyMs / 60000)} min`);
}
