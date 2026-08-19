import type { Metadata } from 'next';

// Vista de landing compartida (servida por nuestra app en Railway).
// Capta fbclid/fbp/fbc + utm, dispara el Pixel, registra la visita vía
// /api/track/redirect (que además genera el token de atribución) y redirige a
// WhatsApp con el código en el mensaje. Mismo origen => sin CORS.

// Fichas a partir del bono ("Bono50000" -> "50.000"). Ignora bonos porcentuales.
export function fichasFromBono(bono: string | null | undefined): string | null {
  if (!bono || /%/.test(bono)) return null;
  const m = String(bono).match(/(\d{2,})/);
  return m ? Number(m[1]).toLocaleString('es-AR') : null;
}

// Metadata Open Graph de la landing (preview al compartir en WhatsApp/redes).
// NO expone el nombre de la herramienta; muestra la marca + las fichas del tier.
export function landingMetadata(o: {
  brand: string;
  fichas?: string | null;
  logoAbs?: string | null;
  url: string;
}): Metadata {
  const title = o.fichas ? `🎁 ${o.fichas} fichas libres` : o.brand;
  const description = o.fichas
    ? `Reclamá tus ${o.fichas} fichas gratis en ${o.brand} 🎰`
    : `Reclamá tu bono en ${o.brand} 🎰`;
  const images = o.logoAbs ? [{ url: o.logoAbs }] : undefined;
  return {
    title,
    description,
    openGraph: { title, description, url: o.url, type: 'website', siteName: o.brand, images },
    twitter: { card: images ? 'summary_large_image' : 'summary', title, description, images: o.logoAbs ? [o.logoAbs] : undefined },
    robots: { index: false, follow: false },
  };
}

export interface LandingConfig {
  tenantSlug: string; // slug del tenant (lo que espera /api/track/redirect)
  pixelId: string;
  waNumber: string; // solo dígitos
  message: string;
  brandName?: string;
  logoUrl?: string; // si está, se muestra la imagen del logo en vez del texto
  primaryColor?: string;
  headline?: string;
  subtext?: string;
  ccpp?: string | null; // código de bono por defecto de esta landing
  campaign?: string | null; // campaña por defecto
  redirectDelayMs?: number;
  chatSlug?: string | null; // si está, redirige al chat web /chat/<slug> en vez de wa.me
  chatOrigin?: string | null; // origen del chat (ej https://chat.fichaslibres.online); vacío = relativo
  noCode?: boolean; // no incluir "Codigo Promocion:" en el mensaje (CRM sin webhook, no matchea)
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
    chatSlug: cfg.chatSlug ?? null,
    chatOrigin: cfg.chatOrigin ?? '',
    noCode: cfg.noCode ?? false,
    redirectDelayMs: delay,
    // Si el mensaje configurado trae {fichas} o {bono}, se usa como plantilla.
    messageTpl: cfg.message && cfg.message.indexOf('{') !== -1 ? cfg.message : null,
  };

  const logic = `
(function(){
  var C = ${JSON.stringify(client)};
  function p(n){return new URLSearchParams(location.search).get(n);}
  function c(n){var m=document.cookie.match('(^|;)\\\\s*'+n+'\\\\s*=\\\\s*([^;]+)');return m?m.pop():null;}
  var fbclid=p('fbclid');
  // El _fbp lo setea fbevents.js de forma ASÍNCRONA tras cargar el Pixel; si lo
  // leemos al instante suele venir vacío. Por eso construimos el payload recién
  // al momento de enviar (ver waitFbp más abajo), leyendo la cookie fresca.
  function buildPayload(){
    var fbp=c('_fbp');
    var fbc=c('_fbc')||(fbclid?('fb.1.'+Date.now()+'.'+fbclid):null);
    return {
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
  }
  // Cantidad de fichas a partir del bono (ej "Bono50000" -> "50.000"). Ignora
  // bonos porcentuales (ej "Bono10%") u otros sin fichas.
  function fichasFrom(bono){
    if(!bono || /%/.test(bono)) return null;
    var m = String(bono).match(/(\\d{2,})/);
    if(!m) return null;
    return Number(m[1]).toLocaleString('es-AR');
  }
  function buildText(d){
    var bono = d && d.bono;
    var fichas = fichasFrom(bono);
    // Template configurable: {fichas} y {bono}. Si no hay template, arma el default.
    if (C.messageTpl) {
      return C.messageTpl.replace('{fichas}', fichas||'').replace('{bono}', bono||'');
    }
    if (fichas) return 'Hola, quiero mis ' + fichas + ' fichas libres 🎁';
    return C.defaultMessage;
  }
  function go(d){
    var code = d && d.code;
    // Destino CHAT WEB: redirige al chat embebido con el token + campaña + ccpp.
    if(C.chatSlug){
      var camp=p('campaign')||C.campaign||'';
      var cc=p('CCPP')||p('ccpp')||C.ccpp||'';
      var base=C.chatOrigin||'';
      var u=base+'/chat/'+C.chatSlug+'?token='+encodeURIComponent(code||'')+'&campaign='+encodeURIComponent(camp)+'&ccpp='+encodeURIComponent(cc);
      window.location.href=u;
      return;
    }
    // Sin número asignado (ni fijo ni por rotación): NO redirigimos.
    if(!C.waNumber){
      var sp=document.getElementById('ll-spin'); if(sp) sp.style.display='none';
      var hd=document.getElementById('ll-headline'); if(hd) hd.textContent='No disponible por el momento';
      var st=document.getElementById('ll-subtext'); if(st) st.textContent='Volvé a intentar más tarde.';
      return;
    }
    // noCode: sin CRM/webhook detrás no hay forma de matchear el token, así que
    // no lo metemos en el mensaje (igual seguimos contando el clic/redirect).
    var msg = (code && !C.noCode ? ('Codigo Promocion: '+code+'. ') : '') + buildText(d);
    var wa='https://wa.me/'+C.waNumber+'?text='+encodeURIComponent(msg);
    window.location.href=wa;
  }
  var done=false;
  var fallback=setTimeout(function(){ if(!done){done=true; go(null);} }, C.redirectDelayMs+2000);
  function send(){
    fetch('/api/track/redirect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(buildPayload())})
      .then(function(r){return r.json();})
      .then(function(d){ if(!done){done=true; clearTimeout(fallback); setTimeout(function(){go(d);}, C.redirectDelayMs);} })
      .catch(function(){ if(!done){done=true; clearTimeout(fallback); go(null);} });
  }
  // Esperamos a que el Pixel setee _fbp (hasta ~1s) para capturarlo; si no llega,
  // enviamos igual (fbc/fbclid ya alcanzan para atribuir). Dentro del presupuesto
  // del fallback (redirectDelayMs+2000).
  var waited=0;
  (function waitFbp(){
    if(c('_fbp')||waited>=1000){ send(); return; }
    waited+=150; setTimeout(waitFbp,150);
  })();
})();`;

  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', textAlign: 'center', padding: '1rem', background: '#0a0d12', color: '#e6edf3' }}>
      <div
        dangerouslySetInnerHTML={{
          __html: cfg.logoUrl
            ? `<img src="${cfg.logoUrl}" alt="${brand}" style="max-width:280px;max-height:150px;object-fit:contain" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"/><div style="display:none;font-weight:800;font-size:1.3rem;letter-spacing:-0.02em;color:${accent}">${brand}</div>`
            : `<div style="font-weight:800;font-size:1.3rem;letter-spacing:-0.02em;color:${accent}">${brand}</div>`,
        }}
      />
      <div id="ll-spin" style={{ width: 42, height: 42, border: '4px solid #2a2f36', borderTopColor: accent, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <p id="ll-headline" style={{ margin: 0, color: accent, fontWeight: 700 }}>{headline}</p>
      <p id="ll-subtext" style={{ color: '#8a93a0', fontSize: '.9rem', margin: 0 }}>{subtext}</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {pixelScript ? <script dangerouslySetInnerHTML={{ __html: pixelScript }} /> : null}
      <script dangerouslySetInnerHTML={{ __html: logic }} />
    </main>
  );
}
