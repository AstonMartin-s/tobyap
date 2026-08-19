// Throttle global para la API de Kommo.
//
// Kommo limita ~7 requests/segundo por cuenta. En picos de tráfico de ads, varias
// personas entran al chat a la vez y cada una dispara varias llamadas; sumado a
// las que hace la integración de WhatsApp, la cuenta se satura y Kommo devuelve
// 429 → los leads no se crean. (Confirmado: ráfaga de 25 requests → 17× 429.)
//
// Solución: TODAS las llamadas del sistema a Kommo pasan por acá, que las
// serializa y las pacea por debajo del límite (~5/seg, dejando aire para la
// integración de WhatsApp que comparte la misma cuota), con reintento en 429.
// Como el servicio corre en 1 réplica, un throttle en proceso alcanza.

const MIN_INTERVAL_MS = 200; // ~5 req/seg — headroom bajo el límite de ~7/seg
let lastAt = 0;
let chain: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Serializa fn detrás del último trabajo encolado, respetando MIN_INTERVAL_MS.
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastAt));
    if (wait) await sleep(wait);
    lastAt = Date.now();
    return fn();
  };
  const p = chain.then(run, run);
  // Que un rechazo no rompa la cadena para los siguientes.
  chain = p.then(() => undefined, () => undefined);
  return p;
}

// Drop-in de fetch para Kommo: paceado + reintento en 429/5xx.
export function kfetch(url: string, init?: RequestInit, tries = 4): Promise<Response> {
  return paced(async () => {
    let res: Response | undefined;
    for (let i = 0; i < tries; i++) {
      res = await fetch(url, init);
      if (res.status !== 429 && res.status < 500) return res;
      // Rate-limit / error de servidor: esperamos (dentro del slot, bloqueando la
      // cadena, para no seguir apilando llamadas sobre la cuota saturada).
      await sleep(600 * (i + 1));
    }
    return res as Response;
  });
}
