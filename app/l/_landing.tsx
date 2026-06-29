// Vista de landing compartida (servida por nuestra app en Railway).
// Capta fbclid/fbp/fbc + utm, dispara el Pixel, registra la visita vía
// /api/track/redirect (que además genera el token de atribución) y redirige a
// WhatsApp con el código en el mensaje. Mismo origen => sin CORS.

export interface LandingConfig {
  tenantSlug: string; // slug del tenant (lo que espera /api/track/redirect)
  pixelId: string;
  waNumber: string; // solo dígitos
  message: string;
  brandName?: string;
  primaryColor?: string;
  headline?: string;
  subtext?: string;
  ccpp?: string | null; // código de bono por defecto de esta landing
  campaign?: string | null; // campaña por defecto
  redirectDelayMs?: number;
}

export function LandingView(cfg: LandingConfig) {
  const accent = cfg.primaryColor || '#25d366';
  const brand = cfg.brandName || 'Acceso';
  const headline = cfg.headline || 'Verificando tu acceso…';
  const subtext = cfg.subtext || 'Te redirigimos a WhatsApp en un instante.';
  const delay = cfg.redirectDelayMs ?? 1500;

  const pixelScript = cfg.pixelId
    ? `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${cfg.pixelId}');fbq('track','PageView');`
    : '';

  const client = {
    slug: cfg.tenantSlug,
    waNumber: cfg.waNumber,
    defaultMessage: cfg.message,
    ccpp: cfg.ccpp ?? null,
    campaign: cfg.campaign ?? null,
    redirectDelayMs: delay,
  };

  const logic = `
(function(){
  var C = ${JSON.stringify(client)};
  function p(n){return new URLSearchParams(location.search).get(n);}
  function c(n){var m=document.cookie.match('(^|;)\\\\s*'+n+'\\\\s*=\\\\s*([^;]+)');return m?m.pop():null;}
  var fbclid=p('fbclid');
  var fbp=c('_fbp');
  var fbc=c('_fbc')||(fbclid?('fb.1.'+Date.now()+'.'+fbclid):null);
  var payload={
    slug:C.slug,
    campaign:p('campaign')||C.campaign,
    ccpp:p('CCPP')||p('ccpp')||C.ccpp,
    utmSource:p('utm_source'),
    utmCampaign:p('utm_campaign'),
    utmContent:p('utm_content'),
    namead:p('namead'),
    fbp:fbp, fbc:fbc, fbclid:fbclid,
    eventSourceUrl:location.href
  };
  function go(code){
    var msg = (code ? ('Codigo Promocion: '+code+'.') : '') + C.defaultMessage;
    var wa='https://wa.me/'+C.waNumber+'?text='+encodeURIComponent(msg);
    window.location.href=wa;
  }
  var done=false;
  var fallback=setTimeout(function(){ if(!done){done=true; go(null);} }, C.redirectDelayMs+2000);
  fetch('/api/track/redirect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
    .then(function(r){return r.json();})
    .then(function(d){ if(!done){done=true; clearTimeout(fallback); setTimeout(function(){go(d&&d.code);}, C.redirectDelayMs);} })
    .catch(function(){ if(!done){done=true; clearTimeout(fallback); go(null);} });
})();`;

  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', textAlign: 'center', padding: '1rem', background: '#0a0d12', color: '#e6edf3' }}>
      <div style={{ fontWeight: 800, fontSize: '1.3rem', letterSpacing: '-0.02em', color: accent }}>{brand}</div>
      <div style={{ width: 42, height: 42, border: '4px solid #2a2f36', borderTopColor: accent, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <p style={{ margin: 0 }}>{headline}</p>
      <p style={{ color: '#8a93a0', fontSize: '.9rem', margin: 0 }}>{subtext}</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {pixelScript ? <script dangerouslySetInnerHTML={{ __html: pixelScript }} /> : null}
      <script dangerouslySetInnerHTML={{ __html: logic }} />
    </main>
  );
}
