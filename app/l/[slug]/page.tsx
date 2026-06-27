import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants, clientSettings, numbers } from '@/db/schema';

export const dynamic = 'force-dynamic';

// Landing propia servida por la app: /l/<slug>?wa=<numero opcional>
// Capta fbclid/fbp/fbc, dispara Pixel, registra el redirect (visita) en NUESTRA DB
// y redirige a WhatsApp. Mismo origen => la llamada a /api/track/redirect no necesita CORS.
export default async function Landing({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { wa?: string };
}) {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, params.slug) });
  if (!t || !t.active) {
    return <main style={{ padding: '20vh 1rem', textAlign: 'center' }}>Landing no disponible</main>;
  }

  const [s] = await db.select().from(clientSettings).where(eq(clientSettings.tenantId, t.id));
  const [n] = await db
    .select()
    .from(numbers)
    .where(and(eq(numbers.tenantId, t.id), eq(numbers.type, 'publi'), eq(numbers.status, true)))
    .limit(1);

  const cfg = {
    slug: t.slug,
    pixelId: t.metaPixelId ?? '',
    waNumber: (searchParams.wa ?? n?.phone ?? '').replace(/\D/g, ''),
    defaultMessage: s?.message ?? 'Hola, vi el anuncio y quiero mi beneficio',
    redirectDelayMs: 1500,
  };

  const pixelScript = cfg.pixelId
    ? `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${cfg.pixelId}');fbq('track','PageView');`
    : '';

  const logic = `
(function(){
  var C = ${JSON.stringify(cfg)};
  function p(n){return new URLSearchParams(location.search).get(n);}
  function c(n){var m=document.cookie.match('(^|;)\\\\s*'+n+'\\\\s*=\\\\s*([^;]+)');return m?m.pop():null;}
  var fbclid=p('fbclid');
  var campaignId=p('campaign')||p('campaignId')||p('utm_campaign')||null;
  var fbp=c('_fbp');
  var fbc=c('_fbc')||(fbclid?('fb.1.'+Date.now()+'.'+fbclid):null);
  try{
    fetch('/api/track/redirect',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,
      body:JSON.stringify({slug:C.slug,campaignId:campaignId,fbp:fbp,fbc:fbc,fbclid:fbclid,eventSourceUrl:location.href})}).catch(function(){});
  }catch(e){}
  var wa='https://wa.me/'+C.waNumber+'?text='+encodeURIComponent(C.defaultMessage);
  setTimeout(function(){window.location.href=wa;},C.redirectDelayMs);
})();`;

  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', textAlign: 'center', padding: '1rem' }}>
      <div style={{ width: 42, height: 42, border: '4px solid #2a2f36', borderTopColor: '#25d366', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <p>Verificando tu acceso…</p>
      <p style={{ color: '#8a93a0', fontSize: '.9rem' }}>Te redirigimos a WhatsApp en un instante.</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {pixelScript ? <script dangerouslySetInnerHTML={{ __html: pixelScript }} /> : null}
      <script dangerouslySetInnerHTML={{ __html: logic }} />
    </main>
  );
}
