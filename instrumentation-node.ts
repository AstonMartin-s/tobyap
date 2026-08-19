// Scheduler in-process (solo runtime Node). Reintenta los eventos CAPI fallidos
// cada N minutos sin depender de un cron externo. Se importa desde
// instrumentation.ts únicamente cuando NEXT_RUNTIME === 'nodejs'.
import { retryFailedEvents } from '@/lib/meta';
import { runReminders } from '@/lib/chat/reminders';
import { autoCloseStale } from '@/lib/chat/autoclose';
import { purgeDeadNoCargo } from '@/lib/chat/purge';
import { cleanupOldComprobantes } from '@/lib/chat/cleanupComprobantes';

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

// Recordatorios del chat (5/15/30 min sin respuesta del cliente). Corre cada 1 min.
if (process.env.DISABLE_REMINDERS !== '1') {
  const tick = async () => {
    try {
      const r = await runReminders();
      if (r.sent) console.log('[reminders]', r);
    } catch (e) {
      console.error('[reminders] error:', e);
    }
  };
  setTimeout(tick, 45_000);
  setInterval(tick, 60_000);
  console.log('[reminders] activo · cada 1 min');
}

// Auto-cierre de chats inactivos (default 72h). Corre cada 1 h.
if (process.env.DISABLE_AUTOCLOSE !== '1') {
  const hours = Number(process.env.AUTOCLOSE_HOURS ?? 72);
  const tick = async () => {
    try {
      const r = await autoCloseStale(hours);
      if (r.closed) console.log('[autoclose]', r);
    } catch (e) {
      console.error('[autoclose] error:', e);
    }
  };
  setTimeout(tick, 90_000);
  setInterval(tick, 60 * 60_000);
  console.log(`[autoclose] activo · cada 1 h · umbral ${hours}h`);
}

// Purga leads "No Cargo" que nunca respondieron (+24h, cero mensajes del cliente).
// Se borran de TrackerIO; la tarjeta en Kommo NO se toca. Corre cada 1 h.
if (process.env.DISABLE_PURGE !== '1') {
  const hours = Number(process.env.PURGE_HOURS ?? 24);
  const tick = async () => {
    try {
      const r = await purgeDeadNoCargo(hours);
      if (r.purged) console.log('[purge]', r);
    } catch (e) {
      console.error('[purge] error:', e);
    }
  };
  setTimeout(tick, 120_000);
  setInterval(tick, 60 * 60_000);
  console.log(`[purge] activo · cada 1 h · umbral ${hours}h`);
}

// Limpieza diaria de comprobantes (imágenes) con +48h de recibidos — libera
// disco/DB, ya cumplieron su función una vez revisados. El texto de la
// conversación queda intacto, solo se borra la imagen.
if (process.env.DISABLE_COMPROBANTE_CLEANUP !== '1') {
  const hours = Number(process.env.COMPROBANTE_CLEANUP_HOURS ?? 48);
  const tick = async () => {
    try {
      const r = await cleanupOldComprobantes(hours);
      if (r.cleaned) console.log('[cleanup-comprobantes]', r);
    } catch (e) {
      console.error('[cleanup-comprobantes] error:', e);
    }
  };
  setTimeout(tick, 150_000);
  setInterval(tick, 24 * 60 * 60_000); // 1 vez por día
  console.log(`[cleanup-comprobantes] activo · cada 24h · umbral ${hours}h`);
}
