'use client';
import { useEffect, useRef, useState } from 'react';

type Msg = { from: 'bot' | 'user'; text?: string; image?: string; copy?: string; delayMs?: number };
type Btn = { id: string; label: string };

const C = { header: '#008069', bg: '#ECE5DD', botBubble: '#FFFFFF', userBubble: '#D9FDD3', send: '#008069', ink: '#111B21', sub: '#667781' };

// Menú fijo post-acreditación.
const POST_MENU = [
  { id: 'deposit', label: '💰 Quiero depositar' },
  { id: 'withdraw', label: '💸 Quiero retirar' },
  { id: 'download_app', label: '📲 Descargar la app' },
  { id: 'support', label: '🙋 Soporte' },
  { id: 'forgot_user', label: '😵 Olvidé mi usuario' },
  { id: 'cancel', label: '✖️ Cerrar consulta' },
];

function renderText(text: string) {
  const parts = text.split(/(\*[^*]+\*|https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => {
    if (/^\*[^*]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>;
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" style={{ color: '#027EB5', wordBreak: 'break-all' }}>{p}</a>;
    return <span key={i}>{p}</span>;
  });
}

export default function ChatWidget({ slug, token, campaign, ccpp, brand }: { slug: string; token: string; campaign: string; ccpp: string; brand: string }) {
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

  // PWA: registrar el service worker + capturar el instalador nativo (Android/Chrome).
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/chat-sw.js').catch(() => {});
    }
    // Puede haber disparado antes de montar: lo guardamos en window desde el layout.
    const pre = (window as any).__bipEvent;
    if (pre) setDeferredPrompt(pre);
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferredPrompt(e); };
    const onInstalled = () => { setAppInstall(true); setMsgs((p) => [...p, { from: 'bot', text: '✓ ¡App instalada! 🎉 Ya nos tenés en tu pantalla de inicio.' }]); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    // Si ya está instalada (abierta en modo app), damos el paso 1 por cumplido.
    if (isStandalone()) setAppInstall(true);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }); }, [msgs, typing, buttons]);

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
        if (d.step === 'welcome') setButtons([{ id: 'want_account', label: 'Quiero mi cuenta 🎁' }]);
        else if (d.step === 'credenciales') setButtons([{ id: 'want_cbu', label: 'Quiero el CBU 💳' }]);
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
      if (pend.length) setMsgs((p) => [...p, { from: 'bot', text: `¿Pudiste con ${pend.join(' y ')}? 🤔\nSi te complicó, no te preocupes: ya podés *enviar tu comprobante igual* 👇\n(Pero con la app recibís tus bonos más rápido cada semana 🎁)` }]);
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
    if ((installed || appInstall) && (notif || appNotif)) {
      tapMenu('finish_upload', 'Enviar mi comprobante');
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
            const body = d.step === 'done' ? '✅ ¡Tu carga fue acreditada con éxito!' : (fresh[fresh.length - 1]?.text?.slice(0, 90) ?? 'Tenés un mensaje nuevo 🎁');
            try { new Notification('King 🎰', { body }); } catch { /* sin permiso */ }
          }
        }
      } catch { /* siguiente intento */ }
    }, 3500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sessionKey, phase]);

  async function play(list: Msg[], nextButtons: Btn[] = []) {
    setButtons([]);
    for (const m of list) {
      setTyping(true);
      await new Promise((r) => setTimeout(r, Math.min(m.delayMs ?? 900, 2200)));
      setTyping(false);
      setMsgs((p) => [...p, m]);
      await new Promise((r) => setTimeout(r, 220));
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
      setMsgs((p) => [...p, { from: 'bot', text: '¡Genial! 📲 Te ayudo a instalar la app en tu teléfono, es rápido 👇' }]);
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
  async function enableNotifs() {
    if (isIos() && !isStandalone()) {
      setMsgs((p) => [...p, { from: 'bot', text: '📲 En iPhone las notificaciones se activan al *abrir la app instalada*. Con el Paso 1 ya queda listo, ahí adentro te llegan tus bonos 🔔' }]);
      setAppNotif(true);
      return;
    }
    if (!('Notification' in window)) {
      setMsgs((p) => [...p, { from: 'bot', text: 'Igual te avisamos por acá 👍' }]);
      setAppNotif(true);
      return;
    }
    try {
      const p = await Notification.requestPermission(); // ← dispara el diálogo real
      if (p === 'granted') {
        setAppNotif(true);
        try { new Notification('King 🎰', { body: '¡Notificaciones activadas! Te avisamos de tus bonos.' }); } catch {}
        setMsgs((x) => [...x, { from: 'bot', text: '✓ ¡Notificaciones activadas! 🔔 Vas a recibir tus bonos y avisos al instante.' }]);
      } else {
        // No concedido: no marcamos el paso, lo tiene que aceptar.
        setMsgs((x) => [...x, { from: 'bot', text: '⚠️ Tenés que *permitir* las notificaciones para poder enviar tu comprobante. Tocá de nuevo el Paso 2 y elegí *Permitir* 🙏' }]);
      }
    } catch {
      setMsgs((x) => [...x, { from: 'bot', text: 'Tocá de nuevo el Paso 2 y aceptá el permiso 🙏' }]);
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
        setMsgs((p) => [...p, { from: 'bot', text: '✓ ¡Instalada! 🎉' }]);
      } else {
        setMsgs((p) => [...p, { from: 'bot', text: '👆 Tocá de nuevo *Paso 1* y elegí *Instalar* para agregarla.' }]);
      }
      return;
    }
    // iOS: guía visual paso a paso (Apple no permite instalar por código).
    if (isIos()) {
      setIosGuided(true);
      setMsgs((p) => [
        ...p,
        { from: 'bot', text: '📲 *Guardá King en tu iPhone (30 seg):*' },
        { from: 'bot', image: '/ios-install-guide.svg' },
        { from: 'bot', text: '1️⃣ Tocá el botón *Compartir* (el cuadradito con la flecha ↑, abajo en el centro).\n2️⃣ Deslizá y elegí *"Agregar a inicio"*.\n3️⃣ Tocá *"Agregar"* arriba a la derecha.\n\nCuando lo hagas, tocá *"Ya la agregué"* acá abajo 👇' },
      ]);
      return;
    }
    // Desktop / otros sin instalador nativo → guía + tolerancia (no bloqueamos).
    setAppInstall(true);
    setMsgs((p) => [...p, { from: 'bot', text: '📲 En tu navegador: menú (⋮) → *Instalar app*. ¡Seguimos! 👍' }]);
  }

  // Tolerancia iOS: el usuario confirma que agregó la app (o sigue igual). No la
  // podemos verificar por código en iPhone, así que lo dejamos avanzar.
  function iosConfirm() {
    setAppInstall(true);
    setMsgs((p) => [...p, { from: 'bot', text: '✓ ¡Genial! Sigamos 🙌' }]);
  }

  function copyCbu(value: string) {
    navigator.clipboard?.writeText(value).then(() => { setCopied(value); setTimeout(() => setCopied(null), 1600); }).catch(() => {});
  }

  const initial = (brand || 'K').charAt(0).toUpperCase();

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', background: C.bg }}>
      <div style={{ background: C.header, color: '#fff', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 3px rgba(0,0,0,.2)' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#25D366', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18 }}>{initial}</div>
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{brand}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{typing ? 'escribiendo…' : 'en línea'}</div>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 10px', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Ccircle cx=%223%22 cy=%223%22 r=%221%22 fill=%22%23d8cfc4%22/%3E%3C/svg%3E")' }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
            <div style={{ maxWidth: '80%', background: m.from === 'user' ? C.userBubble : C.botBubble, color: C.ink, padding: '7px 10px', borderRadius: 10, borderTopLeftRadius: m.from === 'bot' ? 2 : 10, borderTopRightRadius: m.from === 'user' ? 2 : 10, boxShadow: '0 1px 1px rgba(0,0,0,.12)', fontSize: 15, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {m.image ? <img src={m.image} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} style={{ maxWidth: 240, maxHeight: 320, borderRadius: 8, display: 'block' }} /> : (
                m.copy ? (
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: 0.3, fontFamily: 'ui-monospace, Menlo, monospace' }}>{m.text}</div>
                    <button onClick={() => copyCbu(m.copy!)} style={{ marginTop: 6, background: copied === m.copy ? '#25D366' : '#EAF7EF', color: copied === m.copy ? '#fff' : C.send, border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                      {copied === m.copy ? '¡Copiado! ✓' : '📋 Copiar CBU'}
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
              <button key={b.id} onClick={() => tapButton(b)} style={{ background: '#fff', color: C.send, border: `1.5px solid ${C.send}`, borderRadius: 20, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,.1)' }}>{b.label}</button>
            ))}
          </div>
        )}
        {/* Menú POST-acreditación: todo empuja a operar desde el portal */}
        {step === 'done' && !typing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', marginTop: 4 }}>
            {POST_MENU.map((m) => (
              <button key={m.id} onClick={() => tapMenu(m.id, m.label)} style={{ background: '#fff', color: C.send, border: `1.5px solid ${C.send}`, borderRadius: 22, padding: '11px 18px', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,.1)', minWidth: 220, textAlign: 'center' }}>{m.label}</button>
            ))}
          </div>
        )}
        {/* GATE de app obligatorio (post-comprobante): pasos para "enviar" la foto */}
        {step === 'app_onboarding' && !typing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', marginTop: 4 }}>
            {appInstall ? (
              <button disabled style={{ background: '#EAF7EF', color: C.send, border: `1.5px solid ${C.send}`, borderRadius: 22, padding: '11px 18px', fontSize: 15, fontWeight: 700, minWidth: 250, textAlign: 'center', opacity: 0.85 }}>✓ Paso 1: App instalada</button>
            ) : iosGuided ? (
              <button onClick={iosConfirm} style={{ background: C.send, color: '#fff', border: 'none', borderRadius: 22, padding: '11px 18px', fontSize: 15, fontWeight: 700, cursor: 'pointer', minWidth: 250, textAlign: 'center' }}>✓ Ya la agregué / Continuar</button>
            ) : (
              <button onClick={installApp} style={{ background: '#fff', color: C.send, border: `1.5px solid ${C.send}`, borderRadius: 22, padding: '11px 18px', fontSize: 15, fontWeight: 700, cursor: 'pointer', minWidth: 250, textAlign: 'center' }}>📲 Paso 1: Instalar app</button>
            )}
            <button onClick={enableNotifs} disabled={appNotif} style={{ background: appNotif ? '#EAF7EF' : '#fff', color: C.send, border: `1.5px solid ${C.send}`, borderRadius: 22, padding: '11px 18px', fontSize: 15, fontWeight: 700, cursor: appNotif ? 'default' : 'pointer', minWidth: 250, textAlign: 'center', opacity: appNotif ? 0.85 : 1 }}>{appNotif ? '✓ Paso 2: Notificaciones activas' : '🔔 Paso 2: Activar notificaciones'}</button>
            {(() => {
              const done = appInstall && appNotif;
              const canSend = done || canSkip15;
              return (
                <>
                  <button onClick={() => canSend && tapMenu('finish_upload', done ? '✅ Terminé, enviar comprobante' : 'Enviar mi comprobante')} disabled={!canSend} style={{ background: canSend ? C.send : '#cfd8d3', color: '#fff', border: 'none', borderRadius: 22, padding: '13px 18px', fontSize: 15, fontWeight: 800, cursor: canSend ? 'pointer' : 'not-allowed', minWidth: 250, textAlign: 'center' }}>
                    {done ? '✅ Enviar mi comprobante' : canSkip15 ? 'Enviar mi comprobante ➡️' : '✅ Enviar mi comprobante'}
                  </button>
                  {!canSend && <div style={{ fontSize: 12, color: C.sub, textAlign: 'right', maxWidth: 250 }}>Completá los pasos para reclamar tu bono… o podés enviar en <b>{secsLeft}s</b></div>}
                  {canSkip15 && !done && <div style={{ fontSize: 12, color: C.sub, textAlign: 'right', maxWidth: 250 }}>Con la app recibís tus bonos más rápido 🎁</div>}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {phase === 'chat' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#F0F2F5' }}>
          <button onClick={() => fileRef.current?.click()} title="Adjuntar comprobante" style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: C.sub }}>📎</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ''; }} />
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Escribí un mensaje" style={{ flex: 1, border: 'none', borderRadius: 20, padding: '10px 14px', fontSize: 15, outline: 'none' }} />
          <button onClick={send} style={{ background: C.send, color: '#fff', border: 'none', width: 42, height: 42, borderRadius: '50%', fontSize: 18, cursor: 'pointer' }}>➤</button>
        </div>
      )}

      {phase === 'form' && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 380, boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#25D366', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700 }}>{initial}</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: C.ink }}>{brand}</div>
            </div>
            <p style={{ color: C.sub, fontSize: 14, margin: '4px 0 16px' }}>Dejanos tu número para crear tu usuario y darte tu bonificación 🎁</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre o apodo" style={inputStyle} />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Tu WhatsApp (ej: 11 2345 6789)" style={inputStyle} />
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: C.ink, margin: '6px 0 14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} style={{ marginTop: 2 }} />
              <span>Confirmo que este es <b>mi número</b>. Si no lo es, no podré recibir mi bonificación.</span>
            </label>
            {formErr && <div style={{ color: '#C0392B', fontSize: 13, marginBottom: 10 }}>{formErr}</div>}
            <button onClick={start} disabled={starting} style={{ width: '100%', background: C.send, color: '#fff', border: 'none', borderRadius: 24, padding: '13px', fontSize: 16, fontWeight: 600, cursor: 'pointer', opacity: starting ? 0.7 : 1 }}>{starting ? 'Verificando…' : 'Comenzar 🚀'}</button>
          </div>
        </div>
      )}

      <style>{`.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#9aa;animation:b 1.2s infinite}.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}@keyframes b{0%,60%,100%{opacity:.3}30%{opacity:1}}`}</style>
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid #D1D7DB', borderRadius: 10, padding: '12px 14px', fontSize: 15, marginBottom: 10, outline: 'none' };
