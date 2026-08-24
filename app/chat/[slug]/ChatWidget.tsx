'use client';
import { useEffect, useRef, useState } from 'react';

type Msg = { from: 'bot' | 'user'; text?: string; image?: string; copy?: string; delayMs?: number };
type Btn = { id: string; label: string };

const C = { header: '#008069', bg: '#ECE5DD', botBubble: '#FFFFFF', userBubble: '#D9FDD3', send: '#008069', ink: '#111B21', sub: '#667781' };

// Menú fijo post-acreditación.
const POST_MENU = [
  { id: 'deposit', label: 'Depositar' },
  { id: 'withdraw', label: 'Retirar' },
  { id: 'download_app', label: 'Instalar app' },
  { id: 'support', label: 'Soporte' },
  { id: 'forgot_user', label: 'Olvidé mis datos' },
];

// La clave pública VAPID viene en base64url; el navegador la pide como Uint8Array.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function renderText(text: string) {
  const parts = text.split(/(\*[^*]+\*|https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => {
    if (/^\*[^*]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>;
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" style={{ color: '#027EB5', wordBreak: 'break-all' }}>{p}</a>;
    return <span key={i}>{p}</span>;
  });
}

export default function ChatWidget({ slug, token, campaign, ccpp, brand, primaryColor, avatarUrl }: { slug: string; token: string; campaign: string; ccpp: string; brand: string; primaryColor?: string; avatarUrl?: string | null }) {
  const [phase, setPhase] = useState<'form' | 'chat'>('form');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [accept, setAccept] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [starting, setStarting] = useState(false);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [buttons, setButtons] = useState<Btn[]>([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState('');
  const [sessionKey, setSessionKey] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [step, setStep] = useState('form');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [appInstall, setAppInstall] = useState(false); // paso 1 completado
  const [appNotif, setAppNotif] = useState(false); // paso 2 completado
  const [nudge, setNudge] = useState(0); // recordatorios del gate
  const [iosGuided, setIosGuided] = useState(false); // en iOS ya mostramos la guía
  const [canSkip15, setCanSkip15] = useState(false); // habilita "enviar igual" tras 20s
  const [secsLeft, setSecsLeft] = useState(20); // cuenta regresiva visible
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollBase = useRef<number | null>(null);
  const autoPromptedRef = useRef(false); // instalador nativo auto-disparado — solo 1 vez
  const [skin, setSkin] = useState({ brand, primaryColor, avatarUrl });
  const [waBtn, setWaBtn] = useState<{ enabled: boolean; url: string }>({ enabled: false, url: '' });
  const [waBtnClicked, setWaBtnClicked] = useState(false);
  const [waBtnToast, setWaBtnToast] = useState(false);

  // La PWA puede tener HTML viejo cacheado: el nombre/color/foto se refrescan de la API.
  useEffect(() => {
    fetch(`/api/chat/${slug}/brand`)
      .then((r) => r.json())
      .then((d) => {
        if (!d?.brand) return;
        setSkin({ brand: d.brand.brandName, primaryColor: d.brand.primaryColor, avatarUrl: d.brand.avatarUrl });
        if (d.brand.brandName) document.title = `${d.brand.brandName} — Soporte`;
        if (d.waBtn) setWaBtn(d.waBtn);
      })
      .catch(() => {});
  }, [slug]);

  // PWA: registrar el service worker + capturar el instalador nativo (Android/Chrome).
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/chat-sw.js').catch(() => {});
    }
    // Puede haber disparado antes de montar: lo guardamos en window desde el layout.
    const pre = (window as any).__bipEvent;
    if (pre) setDeferredPrompt(pre);
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferredPrompt(e); };
    const onInstalled = () => { setAppInstall(true); setMsgs((p) => [...p, { from: 'bot', text: 'App instalada. Ya nos tenés en tu pantalla de inicio.' }]); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    // Si ya está instalada (abierta en modo app), damos el paso 1 por cumplido.
    if (isStandalone()) setAppInstall(true);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }); }, [msgs, typing, buttons]);

  // Recordatorio háptico: mientras falte activar notificaciones o instalar la app,
  // vibramos suave cada ~9s (solo Android; iOS no expone la API) para llamar la
  // atención hacia los botones que titilan arriba. Se corta al completar ambos.
  useEffect(() => {
    if (phase !== 'chat') return;
    if (appInstall && appNotif) return;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const t = setInterval(() => { try { navigator.vibrate?.([40, 60, 40]); } catch { /* sin haptics */ } }, 9000);
    return () => clearInterval(t);
  }, [phase, appInstall, appNotif]);

  // Reanudar sesión si el usuario vuelve (fue al banco a transferir y volvió).
  // Prioridad: ?s= en la URL (sobrevive al acceso directo / otro contexto de
  // storage) y si no, localStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fromUrl = new URL(window.location.href).searchParams.get('s');
    const saved = fromUrl || localStorage.getItem(`chat_${slug}`);
    if (!saved) return;
    (async () => {
      try {
        const r = await fetch(`/api/chat/${slug}/poll?sessionKey=${saved}&since=0`);
        const d = await r.json();
        if (!d.ok) { localStorage.removeItem(`chat_${slug}`); return; }
        setSessionKey(saved);
        setPhase('chat');
        setMsgs(d.messages ?? []);
        pollBase.current = d.total;
        setStep(d.step ?? 'done');
        if (d.step === 'welcome') setButtons([{ id: 'want_account', label: 'Quiero mi cuenta' }]);
        else if (d.step === 'credenciales') setButtons([{ id: 'want_cbu', label: 'Quiero el CBU' }]);
      } catch { /* sin resume */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Gate de app: al entrar arranca una cuenta regresiva de 15s. NO es excluyente
  // (la persona ya mandó plata) — a los 15s puede "enviar igual", pero durante
  // esos 15s lo empujamos a instalar y le recordamos.
  useEffect(() => {
    if (step !== 'app_onboarding') { setCanSkip15(false); setSecsLeft(20); return; }
    if (appInstall && appNotif) return; // ya completó, no hace falta la cuenta
    setCanSkip15(false); setSecsLeft(20);
    const iv = setInterval(() => setSecsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    const t = setTimeout(() => {
      setCanSkip15(true);
      const pend: string[] = [];
      if (!appInstall) pend.push('*Paso 1: Instalar app*');
      if (!appNotif) pend.push('*Paso 2: Activar notificaciones*');
      if (pend.length) setMsgs((p) => [...p, { from: 'bot', text: `¿Pudiste con ${pend.join(' y ')}?\n\nNo te preocupes si te complicó, ya está habilitado el botón para enviar tu imagen abajo.` }]);
    }, 20000);
    return () => { clearInterval(iv); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, appInstall, appNotif, nudge]);

  // Auto-disparo del instalador NATIVO (Android/Chrome): apenas entra al paso, si
  // el navegador ya nos dio el prompt de instalación, lo mostramos solo — la
  // persona ve el diálogo del sistema y toca "Instalar", sin leer instrucciones
  // ni buscar un botón. Solo una vez por sesión (autoPromptedRef).
  useEffect(() => {
    if (step !== 'app_onboarding' || autoPromptedRef.current) return;
    if (isStandalone() || appInstall) return;
    if (!deferredPrompt) return;
    autoPromptedRef.current = true;
    installApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, deferredPrompt]);

  // Si el dispositivo YA tiene la app instalada (standalone) o las notificaciones
  // concedidas, no volvemos a pedir ese paso. Si ya cumplió ambos, avanzamos solo.
  useEffect(() => {
    if (step !== 'app_onboarding') return;
    const installed = isStandalone();
    const notif = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    if (installed && !appInstall) setAppInstall(true);
    if (notif && !appNotif) setAppNotif(true);
    // Ya tenía permiso de una sesión previa: aseguramos la suscripción push (idempotente)
    // para que la habilitación sea de verdad prolongada aunque nunca toque el botón hoy.
    if (notif && sessionKey) void subscribeWebPush();
    if ((installed || appInstall) && (notif || appNotif)) {
      tapMenu('finish_upload', 'Enviar mi imagen');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, appInstall, appNotif]);

  // Mientras está "validando", consultamos si el operador liberó la acreditación.
  // El poll a la DB va cada 3.5s (barato) y detecta el "Aprobar" del panel al toque.
  // El chequeo del estado en KOMMO es caro (1 request a Kommo por poll), así que
  // solo lo pedimos 1 de cada 4 ticks (~14s) para no saturar la cuota de Kommo.
  useEffect(() => {
    // Corre en cualquier paso de ESPERA (no solo validando): así los recordatorios
    // automáticos y los mensajes del operador desde el panel llegan EN VIVO. El
    // chequeo a Kommo (caro) solo se hace en 'validando' y 1 de cada 4 ticks.
    if (phase !== 'chat' || !sessionKey) return;
    if (['closed'].includes(step)) return;
    let tick = 0;
    const t = setInterval(async () => {
      try {
        const since = pollBase.current ?? 0;
        const kc = step === 'validando' && tick % 4 === 0 ? 1 : 0; // Kommo solo en validando
        tick++;
        const r = await fetch(`/api/chat/${slug}/poll?sessionKey=${sessionKey}&since=${since}&kc=${kc}`);
        const d = await r.json();
        if (!d.ok) return;
        if (pollBase.current === null) { pollBase.current = d.total; if (d.step && d.step !== 'validando') setStep(d.step); return; }
        if (d.total > pollBase.current) {
          const fresh = (d.messages ?? []).filter((m: Msg) => m.from === 'bot');
          pollBase.current = d.total;
          await play(fresh, []);
          if (d.step) setStep(d.step);
          if ('Notification' in window && Notification.permission === 'granted') {
            const body = d.step === 'done' ? 'Tu carga fue acreditada con éxito' : (fresh[fresh.length - 1]?.text?.slice(0, 90) ?? 'Tenés un mensaje nuevo');
            try { new Notification(`${skin.brand}`, { body }); } catch { /* sin permiso */ }
          }
        }
      } catch { /* siguiente intento */ }
    }, 3500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sessionKey, phase]);

  async function play(list: Msg[], nextButtons: Btn[] = []) {
    if (!list.length) {
      setButtons(nextButtons);
      return;
    }
    setButtons([]);
    for (const m of list) {
      setTyping(true);
      const base = Math.min(Math.max(m.delayMs ?? 750, 450), 4000);
      const jitter = Math.floor(Math.random() * 220);
      await new Promise((r) => setTimeout(r, base + jitter));
      setTyping(false);
      setMsgs((p) => [...p, m]);
      await new Promise((r) => setTimeout(r, 280));
    }
    setButtons(nextButtons);
  }

  async function start() {
    setFormErr('');
    if (!phone.trim()) return setFormErr('Ingresá tu número de WhatsApp.');
    if (!accept) return setFormErr('Necesitás confirmar que es tu número.');
    setStarting(true);
    try {
      const r = await fetch(`/api/chat/${slug}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, name, token, campaign, ccpp }) });
      const d = await r.json();
      if (!r.ok || !d.ok) { setStarting(false); return setFormErr(d.error || 'No pudimos iniciar. Probá de nuevo.'); }
      setSessionKey(d.sessionKey);
      try {
        localStorage.setItem(`chat_${slug}`, d.sessionKey);
        // Metemos la sesión en la URL: si guardan el acceso directo ahora, la
        // conserva y la conversación se reanuda al reabrir desde el ícono.
        const u = new URL(window.location.href);
        u.searchParams.set('s', d.sessionKey);
        window.history.replaceState(null, '', u.toString());
      } catch { /* privado */ }
      setPhase('chat');
      setStep(d.step ?? 'welcome');
      if (d.resumed) {
        // Sesión existente (mismo teléfono): mostramos el historial tal cual, sin re-animar.
        setMsgs(d.messages ?? []);
        setButtons(d.buttons ?? []);
        pollBase.current = typeof d.total === 'number' ? d.total : (d.messages?.length ?? 0);
      } else {
        play(d.messages ?? [], d.buttons ?? []);
      }
    } catch {
      setStarting(false);
      setFormErr('Error de conexión. Probá de nuevo.');
    }
  }

  async function tapButton(btn: Btn) {
    setButtons([]);
    setMsgs((p) => [...p, { from: 'user', text: btn.label }]);
    // Mandamos el label para que el server lo persista como mensaje del cliente
    // (así el panel ve la conversación completa).
    const r = await fetch(`/api/chat/${slug}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionKey, action: btn.id, label: btn.label }) });
    const d = await r.json().catch(() => ({}));
    if (typeof d.total === 'number' && d.step !== 'validando') pollBase.current = d.total;
    else if (d.step === 'validando') pollBase.current = null;
    if (d.step) setStep(d.step);
    await play(d.messages ?? [], d.buttons ?? []);
  }

  // Opciones post-acreditación (no tocan el estado `buttons`; el menú se renderiza
  // según step==='done').
  async function tapMenu(id: string, label: string) {
    setMsgs((p) => [...p, { from: 'user', text: label }]);
    // "Descargar la app": lo resolvemos EN EL CLIENTE (guía/instalador nativo),
    // no en el server. Nunca debe derivar a "un asesor te responde".
    if (id === 'download_app') {
      setMsgs((p) => [...p, { from: 'bot', text: 'Te ayudo a instalar la app en tu teléfono.' }]);
      await installApp();
      return;
    }
    const r = await fetch(`/api/chat/${slug}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionKey, action: id, label }) });
    const d = await r.json().catch(() => ({}));
    // Al entrar a "validando" reinicializamos la base del polling para no
    // reproducir de nuevo los mensajes que ya mostramos acá.
    // Sincronizamos la base del poll ANTES de animar los mensajes: así el poll de
    // fondo (recordatorios / mensajes del operador) no reproduce lo que estamos por
    // mostrar mientras dura la animación.
    if (d.step === 'validando') pollBase.current = null;
    else if (typeof d.total === 'number') pollBase.current = d.total;
    if (d.step) setStep(d.step);
    await play(d.messages ?? [], []);
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMsgs((p) => [...p, { from: 'user', text }]);
    const r = await fetch(`/api/chat/${slug}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionKey, text }) });
    const d = await r.json().catch(() => ({}));
    if (typeof d.total === 'number') pollBase.current = d.total;
    if (d.step) setStep(d.step);
    await play(d.messages ?? [], d.buttons ?? buttons);
  }

  async function upload(file: File) {
    setButtons([]);
    const localUrl = URL.createObjectURL(file);
    setMsgs((p) => [...p, { from: 'user', image: localUrl }]);
    const fd = new FormData();
    fd.append('sessionKey', sessionKey);
    fd.append('image', file);
    const r = await fetch(`/api/chat/${slug}/upload`, { method: 'POST', body: fd });
    const d = await r.json().catch(() => ({}));
    // Sincronizamos el contador y el estado ANTES de animar, para que el poll de
    // fondo no reproduzca de nuevo estos mensajes mientras dura la animación
    // (era la causa del doble envío del comprobante).
    if (typeof d.total === 'number') pollBase.current = d.total;
    if (d.step) setStep(d.step);
    await play(d.messages ?? [], []);
  }

  const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);
  const isIos = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Notificaciones: pide el permiso REAL. En iOS sin app instalada no se puede
  // (limitación de Apple) → se guía y se da por hecho para no bloquear.
  // Web Push: suscribe el dispositivo para recibir avisos CON LA APP CERRADA. Es
  // una habilitación PROLONGADA (dura hasta que el cliente revoque el permiso; no
  // hay que reactivar por sesión). Best-effort: si el push no está configurado
  // (sin VAPID) o algo falla, seguimos con las notificaciones in-page de siempre.
  async function subscribeWebPush() {
    try {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
      if (!sessionKey) return;
      const keyRes = await fetch(`/api/chat/${slug}/push`);
      const kd = await keyRes.json();
      if (!kd?.ok || !kd.publicKey) return; // push no configurado → fallback in-page
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(kd.publicKey) as unknown as BufferSource,
        });
      }
      await fetch(`/api/chat/${slug}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey, subscription: sub }),
      });
    } catch {
      /* fallback: notificaciones in-page mientras el chat esté abierto */
    }
  }

  async function enableNotifs() {
    if (isIos() && !isStandalone()) {
      setMsgs((p) => [...p, { from: 'bot', text: 'En iPhone las notificaciones se activan al *abrir la app instalada*. Con el Paso 1 ya queda listo, ahí adentro te llegan tus avisos.' }]);
      setAppNotif(true);
      return;
    }
    if (!('Notification' in window)) {
      setMsgs((p) => [...p, { from: 'bot', text: 'Igual te avisamos por acá' }]);
      setAppNotif(true);
      return;
    }
    try {
      const p = await Notification.requestPermission(); // ← dispara el diálogo real
      if (p === 'granted') {
        setAppNotif(true);
        void subscribeWebPush(); // habilitación prolongada (push con la app cerrada)
        try { new Notification(`${skin.brand}`, { body: 'Notificaciones activadas. Te avisamos de tus bonos.' }); } catch {}
        setMsgs((x) => [...x, { from: 'bot', text: 'Notificaciones activadas.' }]);
      } else {
        // No concedido: no marcamos el paso, lo tiene que aceptar.
        setMsgs((x) => [...x, { from: 'bot', text: '⚠️ Tenés que *permitir* las notificaciones para poder enviar tu imagen. Tocá de nuevo el Paso 2 y elegí *Permitir*.' }]);
      }
    } catch {
      setMsgs((x) => [...x, { from: 'bot', text: 'Tocá de nuevo el Paso 2 y aceptá el permiso.' }]);
    }
  }

  // Instalar la app: dispara el instalador NATIVO (Android/Chrome). En iOS/otros,
  // guía paso a paso (Apple no permite instalar por código).
  async function installApp() {
    if (isStandalone()) { setAppInstall(true); setMsgs((p) => [...p, { from: 'bot', text: '✓ ¡Ya la tenés instalada! 🎉' }]); return; }
    if (deferredPrompt) {
      deferredPrompt.prompt(); // ← diálogo nativo de instalación
      const r = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
      setDeferredPrompt(null);
      if (r.outcome === 'accepted') {
        setAppInstall(true); // (appinstalled también lo confirma)
        setMsgs((p) => [...p, { from: 'bot', text: 'Instalada.' }]);
      } else {
        setMsgs((p) => [...p, { from: 'bot', text: 'Tocá de nuevo *Paso 1* y elegí *Instalar* para agregarla.' }]);
      }
      return;
    }
    // iOS: guía visual paso a paso (Apple no permite instalar por código).
    if (isIos()) {
      setIosGuided(true);
      setMsgs((p) => [
        ...p,
        { from: 'bot', text: `*Guardá ${skin.brand} en tu iPhone:*` },
        { from: 'bot', image: '/ios-install-guide.svg' },
        { from: 'bot', text: '1. Tocá el botón *Compartir* (el cuadradito con la flecha ↑, abajo en el centro).\n2. Deslizá y elegí *"Agregar a inicio"*.\n3. Tocá *"Agregar"* arriba a la derecha.\n\nCuando lo hagas, tocá *"Ya la agregué"* acá abajo.' },
      ]);
      return;
    }
    // Desktop / otros sin instalador nativo → guía + tolerancia (no bloqueamos).
    setAppInstall(true);
    setMsgs((p) => [...p, { from: 'bot', text: 'En tu navegador: menú (⋮) → *Instalar app*.' }]);
  }

  // Tolerancia iOS: el usuario confirma que agregó la app (o sigue igual). No la
  // podemos verificar por código en iPhone, así que lo dejamos avanzar.
  function iosConfirm() {
    setAppInstall(true);
    setMsgs((p) => [...p, { from: 'bot', text: 'Listo, sigamos.' }]);
  }

  function copyCbu(value: string) {
    navigator.clipboard?.writeText(value).then(() => { setCopied(value); setTimeout(() => setCopied(null), 1600); }).catch(() => {});
  }

  function handleWaBtn() {
    if (step === 'done') {
      window.open(waBtn.url, '_blank');
      return;
    }
    if (!waBtnClicked) setWaBtnClicked(true);
    setWaBtnToast(true);
    setTimeout(() => setWaBtnToast(false), 4000);
  }

  const header = skin.primaryColor || primaryColor || C.header;
  const initial = (skin.brand || brand || 'K').charAt(0).toUpperCase();

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', background: C.bg }}>
      <div style={{ background: header, color: '#fff', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 3px rgba(0,0,0,.2)' }}>
        {(skin.avatarUrl || avatarUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={skin.avatarUrl || avatarUrl || ''} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', background: '#25D366' }} />
        ) : (
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#25D366', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18 }}>{initial}</div>
        )}
        <div style={{ lineHeight: 1.15, flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{skin.brand}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{typing ? 'escribiendo…' : 'en línea'}</div>
        </div>
        {phase === 'chat' && waBtn.enabled && waBtn.url && (
          <button
            onClick={handleWaBtn}
            className={step === 'done' ? 'wa-hdr wa-hdr--fast' : (waBtnClicked ? '' : 'wa-hdr')}
            title="Ir a WhatsApp"
            style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer', background: '#25D366', color: '#fff', flexShrink: 0, borderRadius: 20, padding: '7px 14px 7px 10px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style={{ flexShrink: 0 }}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            Ir a WhatsApp
          </button>
        )}
        {phase === 'chat' && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={enableNotifs}
              disabled={appNotif}
              title={appNotif ? 'Notificaciones activadas' : 'Activar notificaciones'}
              aria-label="Activar notificaciones"
              className={appNotif ? '' : 'hdr-pulse'}
              style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: appNotif ? 'default' : 'pointer', background: appNotif ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.18)', color: '#fff' }}
            >
              {appNotif ? (
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              )}
            </button>
            <button
              onClick={installApp}
              disabled={appInstall}
              title={appInstall ? 'App instalada' : 'Descargar app'}
              aria-label="Descargar app"
              className={appInstall ? '' : 'hdr-pulse'}
              style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: appInstall ? 'default' : 'pointer', background: appInstall ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.18)', color: '#fff' }}
            >
              {appInstall ? (
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              )}
            </button>
          </div>
        )}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 10px', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Ccircle cx=%223%22 cy=%223%22 r=%221%22 fill=%22%23d8cfc4%22/%3E%3C/svg%3E")' }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
            <div style={{ maxWidth: '80%', background: m.from === 'user' ? C.userBubble : C.botBubble, color: '#111827', padding: '7px 10px', borderRadius: 10, borderTopLeftRadius: m.from === 'bot' ? 2 : 10, borderTopRightRadius: m.from === 'user' ? 2 : 10, boxShadow: '0 1px 1px rgba(0,0,0,.12)', fontSize: 15, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {m.image ? (
                <a href={m.image} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                  <img
                    src={m.image}
                    alt=""
                    onError={(e) => {
                      const img = e.currentTarget as HTMLImageElement;
                      img.style.display = 'none';
                      const span = img.nextElementSibling as HTMLElement | null;
                      if (span) span.style.display = 'inline-flex';
                    }}
                    style={{ maxWidth: 240, maxHeight: 320, borderRadius: 8, display: 'block' }}
                  />
                  <span style={{ display: 'none', alignItems: 'center', gap: 6, padding: '8px 10px', fontSize: 14, fontWeight: 600, color: C.send }}>
                    📄 Archivo enviado ✓
                  </span>
                </a>
              ) : (
                m.copy ? (
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: 0.3, fontFamily: 'ui-monospace, Menlo, monospace' }}>{m.text}</div>
                    <button onClick={() => copyCbu(m.copy!)} style={{ marginTop: 6, background: copied === m.copy ? '#25D366' : '#EAF7EF', color: copied === m.copy ? '#fff' : C.send, border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                      {copied === m.copy ? 'Copiado' : 'Copiar CBU'}
                    </button>
                  </div>
                ) : renderText(m.text ?? '')
              )}
            </div>
          </div>
        ))}
        {typing && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
            <div style={{ background: C.botBubble, padding: '10px 14px', borderRadius: 10, boxShadow: '0 1px 1px rgba(0,0,0,.12)' }}>
              <span className="dot" /> <span className="dot" /> <span className="dot" />
            </div>
          </div>
        )}
        {/* Botones tipo quick-reply */}
        {buttons.length > 0 && !typing && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            {buttons.map((b) => (
              <button key={b.id} onClick={() => tapButton(b)} style={{ background: '#fff', color: C.send, border: `1px solid ${C.send}`, borderRadius: 12, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>{b.label}</button>
            ))}
          </div>
        )}
        {/* Menú POST-acreditación: todo empuja a operar desde el portal */}
        {step === 'done' && !typing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', marginTop: 4 }}>
            {POST_MENU.map((m) => (
              <button key={m.id} onClick={() => tapMenu(m.id, m.label)} style={{ background: '#fff', color: '#111827', border: `1px solid #D1D7DB`, borderRadius: 12, padding: '10px 16px', fontSize: 14, fontWeight: 500, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,.05)', minWidth: 200, textAlign: 'center' }}>{m.label}</button>
            ))}
          </div>
        )}
        {/* GATE de app obligatorio (post-comprobante): pasos para "enviar" la foto */}
        {step === 'app_onboarding' && !typing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', marginTop: 4 }}>
            {appInstall ? (
              <button disabled style={{ background: '#EAF7EF', color: C.send, border: `1px solid ${C.send}`, borderRadius: 12, padding: '11px 18px', fontSize: 14, fontWeight: 600, minWidth: 230, textAlign: 'center', opacity: 0.85 }}>App instalada</button>
            ) : iosGuided ? (
              <button onClick={iosConfirm} style={{ background: C.send, color: '#fff', border: 'none', borderRadius: 12, padding: '11px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer', minWidth: 230, textAlign: 'center' }}>Ya la agregué</button>
            ) : (
              <button onClick={installApp} style={{ background: '#fff', color: C.send, border: `1px solid ${C.send}`, borderRadius: 12, padding: '11px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer', minWidth: 230, textAlign: 'center' }}>Paso 1: Instalar app</button>
            )}
            <button onClick={enableNotifs} disabled={appNotif} style={{ background: appNotif ? '#EAF7EF' : '#fff', color: C.send, border: `1px solid ${C.send}`, borderRadius: 12, padding: '11px 18px', fontSize: 14, fontWeight: 600, cursor: appNotif ? 'default' : 'pointer', minWidth: 230, textAlign: 'center', opacity: appNotif ? 0.85 : 1 }}>{appNotif ? 'Notificaciones activas' : 'Paso 2: Activar notificaciones'}</button>
            {(() => {
              const done = appInstall && appNotif;
              const canSend = done || canSkip15;
              return (
                <>
                  <button onClick={() => canSend && tapMenu('finish_upload', 'Enviar mi imagen')} disabled={!canSend} style={{ background: canSend ? C.send : '#cfd8d3', color: '#fff', border: 'none', borderRadius: 12, padding: '13px 18px', fontSize: 14, fontWeight: 700, cursor: canSend ? 'pointer' : 'not-allowed', minWidth: 230, textAlign: 'center' }}>
                    Enviar mi imagen
                  </button>
                  {!canSend && <div style={{ fontSize: 12, color: C.sub, textAlign: 'right', maxWidth: 230 }}>Completá los pasos o esperá <b>{secsLeft}s</b> para enviar directo.</div>}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {phase === 'chat' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#F0F2F5' }}>
          <button onClick={() => fileRef.current?.click()} title="Adjuntar imagen" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#54656F', display: 'flex', alignItems: 'center', padding: '4px' }}>
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path></svg>
          </button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf,.heic,.heif" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ''; }} />
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Escribe un mensaje" style={{ flex: 1, border: 'none', borderRadius: 20, padding: '10px 14px', fontSize: 15, outline: 'none', background: '#fff', color: '#111827' }} />
          <button onClick={send} style={{ background: C.send, color: '#fff', border: 'none', width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'translate(-1px, 1px)' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </div>
          </button>
        </div>
      )}

      {phase === 'form' && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 380, boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              {(skin.avatarUrl || avatarUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={skin.avatarUrl || avatarUrl || ''} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', background: '#25D366' }} />
              ) : (
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#25D366', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700 }}>{initial}</div>
              )}
              <div style={{ fontWeight: 700, fontSize: 18, color: '#111827' }}>{skin.brand}</div>
            </div>
            <p style={{ color: '#54656F', fontSize: 14, margin: '4px 0 16px' }}>Dejanos tu número para crear tu usuario y darte tu bonificación</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre o apodo" style={inputStyle} />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Tu WhatsApp (ej: 11 2345 6789)" style={inputStyle} />
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#111827', margin: '6px 0 14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} style={{ marginTop: 2 }} />
              <span>Confirmo que este es <b>mi número</b>. Si no lo es, no podré recibir mi bonificación.</span>
            </label>
            {formErr && <div style={{ color: '#C0392B', fontSize: 13, marginBottom: 10 }}>{formErr}</div>}
            <button onClick={start} disabled={starting} style={{ width: '100%', background: C.send, color: '#fff', border: 'none', borderRadius: 24, padding: '13px', fontSize: 16, fontWeight: 600, cursor: 'pointer', opacity: starting ? 0.7 : 1 }}>{starting ? 'Verificando…' : 'Comenzar'}</button>
          </div>
        </div>
      )}

      {waBtnToast && step !== 'done' && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
          display: 'grid', placeItems: 'center', zIndex: 100,
          animation: 'fadeIn .2s ease', padding: 20,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '28px 24px',
            maxWidth: 340, width: '100%', textAlign: 'center',
            boxShadow: '0 12px 40px rgba(0,0,0,.3)',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
            <p style={{ fontSize: 17, lineHeight: 1.5, color: '#111827', margin: '0 0 20px', fontWeight: 500 }}>
              Cuando tengas tu usuario y hayas recibido tu bono, te daremos acceso a soporte
            </p>
            <button
              onClick={() => setWaBtnToast(false)}
              style={{ background: header, color: '#fff', border: 'none', borderRadius: 12, padding: '12px 32px', fontSize: 16, fontWeight: 600, cursor: 'pointer', width: '100%' }}
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      <style>{`.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#9aa;animation:b 1.2s infinite}.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}@keyframes b{0%,60%,100%{opacity:.3}30%{opacity:1}}.wa-hdr{animation:waH 5s infinite}@keyframes waH{0%,88%,100%{transform:scale(1)}93%{transform:scale(1.08)}96%{transform:scale(1)}}.wa-hdr--fast{animation:waHF 2s infinite}@keyframes waHF{0%,70%,100%{transform:scale(1)}35%{transform:scale(1.08)}}.hdr-pulse{animation:hp 1.6s infinite}@keyframes hp{0%{box-shadow:0 0 0 0 rgba(255,255,255,.55)}70%{box-shadow:0 0 0 8px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid #D1D7DB', borderRadius: 10, padding: '12px 14px', fontSize: 15, marginBottom: 10, outline: 'none', background: '#fff', color: '#111827' };
