import type { Metadata } from 'next';
import { a3PickLine } from '@/lib/a3/rotation';

// ===========================================================================
// MÓDULO AISLADO A3 — landing anti-ban para ClienteA3 (Pagoda).
// Rota las 2 líneas BM, capta el click e inyecta el marcador [campaign] en el
// texto pre-cargado para poder atribuir la conversación por campaña en el relay.
// No usa CAPI, ni token PBxxxx, ni el circuito de tenants.
// ===========================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function A3Landing({
  searchParams,
}: {
  params: { slug: string };
  searchParams: { campaign?: string; msg?: string };
}) {
  const line = await a3PickLine();
  const waNumber = line?.waNumber ?? '';
  const campaign = (searchParams.campaign ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
  const greeting = searchParams.msg || 'Hola! Quiero más información 🎁';

  const cfg = JSON.stringify({ waNumber, campaign, greeting });
  const logic = `
(function(){
  var C = ${cfg};
  if(!C.waNumber){
    document.getElementById('a3-h').textContent='No disponible por el momento';
    document.getElementById('a3-s').textContent='Volvé a intentar más tarde.';
    var sp=document.getElementById('a3-spin'); if(sp) sp.style.display='none';
    return;
  }
  var marker = C.campaign ? (' ['+C.campaign+']') : '';
  var msg = C.greeting + marker;
  setTimeout(function(){ location.href='https://wa.me/'+C.waNumber+'?text='+encodeURIComponent(msg); }, 800);
})();`;

  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', textAlign: 'center', padding: '1rem', background: '#0a0d12', color: '#e6edf3' }}>
      <div id="a3-spin" style={{ width: 42, height: 42, border: '4px solid #2a2f36', borderTopColor: '#25d366', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <p id="a3-h" style={{ margin: 0, color: '#25d366', fontWeight: 700 }}>Verificando tu acceso…</p>
      <p id="a3-s" style={{ color: '#8a93a0', fontSize: '.9rem', margin: 0 }}>Te redirigimos a WhatsApp en un instante.</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <script dangerouslySetInnerHTML={{ __html: logic }} />
    </main>
  );
}
