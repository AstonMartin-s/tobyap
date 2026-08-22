export const MESSAGE_TEMPLATE_IDS = [
  'welcome_body',
  'account_creating',
  'account_checking',
  'account_done',
  'account_existing',
  'account_error',
  'cbu_intro',
  'comprobante_upload_1',
  'comprobante_upload_2',
  'comprobante_review',
  'comprobante_pending',
  'comprobante_rejected',
  'accredited',
  'accredited_cajera',
  'support',
  'post_deposit',
  'post_withdraw',
  'post_forgot',
] as const;

export type MessageTemplateId = typeof MESSAGE_TEMPLATE_IDS[number];

export type PanelQuickTexts = {
  barPlaceholder?: string;
  barPresets?: string[];
};

export const DEFAULT_PANEL_QUICK: PanelQuickTexts = {
  barPlaceholder: 'Mensaje libre al cliente…',
  barPresets: [
    '¿Seguís por ahí? 👀',
    'En breve te confirmamos la acreditación 🙌',
    'Reenviame el comprobante completo y legible 📸',
  ],
};

/** Defaults = guion actual (editable en Ajustes → Guion). */
export const DEFAULT_TEMPLATES: Record<MessageTemplateId, string> = {
  welcome_body: 'Un gusto atenderte 🎰\nBienvenido a *{brand}*.\n\n{offer_welcome}',
  account_creating: 'Genial 🙌 Te estoy creando tu usuario, dame un segundo…',
  account_checking: 'Dejame chequear tu cuenta… 👀',
  account_done: '✅ *¡Felicitaciones!* Tu usuario ya está creado:{creds_block}',
  account_existing: '👋 *¡Ya tenés cuenta con nosotros!* Te la recuerdo:{creds_block}',
  account_error: 'Uy, tuve un problemita con tu usuario. Un asesor te ayuda en un momento 🙌',
  cbu_intro: 'Perfecto 🙌 Datos para tu carga:\n🏦 Titular: *{titular}*',
  comprobante_upload_1: 'Recibimos tu imagen! Último paso y la enviamos a revisión 👇',
  comprobante_upload_2: '📲 Instalá la app y activá las notificaciones — así te acreditamos más rápido y recibís tus bonos cada semana 🎁',
  comprobante_review: '✅ ¡Listo! Tu imagen entró en revisión 🔎 En breve validamos y te acreditamos tu saldo + bono 🎉',
  comprobante_pending: '⏳ Estamos revisando tu comprobante. Aguardá unos minutos que ya te confirmamos la acreditación 🙌',
  comprobante_rejected: '⚠️ No pudimos validar el comprobante. Reenvialo por acá 📸 pero que se vea *completo y legible*:\n\n• *Nombre de quien envía* (titular de la cuenta)\n• *Nombre de quien recibe* (destinatario)\n• *Fecha* e *importe*\n\nAsí lo acreditamos al toque 🎁',
  accredited: '✅ *¡Acreditado con éxito!*\n🎉 ¡Gracias por elegir {brand}! Ya tenés tu saldo.\n\n🎮 Entrá directo a jugar acá 👇\n{portal_play}',
  accredited_cajera: 'Queres un EXTRA? 📲 Agendá a tu cajera para no perderte las promos activas 🔥\n📞 Número: {support}\n📸 Pasale la captura y recibí +1000 EXTRAS de regalo 🎁🤑',
  support: '🙋 Para ayudarte mejor, escribinos por WhatsApp y te atendemos al toque, 24hs 👇\n{support}',
  post_deposit: '💰 *Cargar saldo*\nEntrá al portal y tocá *"Cargar saldo"* 👇\n{portal_deposit}\n\n{offer_deposit}',
  post_withdraw: '💸 *Retirar saldo*\nEntrá al portal y tocá *"Retirar saldo"* 👇\n{portal_withdraw}\n\nCargá tu CBU en "Mi cuenta bancaria" y listo.',
  post_forgot: '🔐 Tus datos de acceso:\n\n👤 Usuario: *{username}*\n🔑 Contraseña: *{password}*\n\n🔗 Entrá directo acá 👇\n{portal_forgot}',
};

export const TEMPLATE_UI_GROUPS: Array<{
  title: string;
  hint?: string;
  items: Array<{ id: MessageTemplateId; label: string; vars: string[] }>;
}> = [
  {
    title: 'Bienvenida y cuenta',
    items: [
      { id: 'welcome_body', label: 'Bienvenida (tras el hola)', vars: ['{brand}', '{offer_welcome}'] },
      { id: 'account_creating', label: 'Creando usuario…', vars: [] },
      { id: 'account_checking', label: 'Usuario ya existía (1)', vars: [] },
      { id: 'account_done', label: 'Usuario creado', vars: ['{creds_block}'] },
      { id: 'account_existing', label: 'Usuario ya existía (2)', vars: ['{creds_block}'] },
      { id: 'account_error', label: 'Error al crear usuario', vars: [] },
    ],
  },
  {
    title: 'CBU y comprobante',
    hint: 'El número de CBU se manda en burbuja aparte (Configuración → CBU).',
    items: [
      { id: 'cbu_intro', label: 'Intro CBU (titular)', vars: ['{titular}'] },
      { id: 'comprobante_upload_1', label: 'Imagen recibida (1)', vars: [] },
      { id: 'comprobante_upload_2', label: 'Paso app (2)', vars: [] },
      { id: 'comprobante_review', label: 'En revisión', vars: [] },
      { id: 'comprobante_pending', label: 'Pendiente (botón panel)', vars: [] },
      { id: 'comprobante_rejected', label: 'Erróneo (botón panel)', vars: [] },
    ],
  },
  {
    title: 'Acreditación',
    items: [
      { id: 'accredited', label: 'Acreditado + jugar', vars: ['{brand}', '{portal_play}'] },
      { id: 'accredited_cajera', label: 'Promo cajera (2° mensaje)', vars: ['{support}'] },
    ],
  },
  {
    title: 'Post-acreditación y soporte',
    items: [
      { id: 'support', label: 'Soporte / walink', vars: ['{support}'] },
      { id: 'post_deposit', label: 'Botón Cargar', vars: ['{portal_deposit}', '{offer_deposit}'] },
      { id: 'post_withdraw', label: 'Botón Retirar', vars: ['{portal_withdraw}'] },
      { id: 'post_forgot', label: 'Botón Datos', vars: ['{username}', '{password}', '{portal_forgot}'] },
    ],
  },
];

export function parseTemplates(raw: unknown): Partial<Record<MessageTemplateId, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<Record<MessageTemplateId, string>> = {};
  for (const id of MESSAGE_TEMPLATE_IDS) {
    const v = o[id];
    if (typeof v === 'string' && v.trim()) out[id] = v;
  }
  return out;
}

export function parsePanelQuick(raw: unknown): PanelQuickTexts {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_PANEL_QUICK };
  const o = raw as Record<string, unknown>;
  const barPresets = Array.isArray(o.barPresets)
    ? o.barPresets.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
    : DEFAULT_PANEL_QUICK.barPresets;
  const barPlaceholder = typeof o.barPlaceholder === 'string' && o.barPlaceholder.trim()
    ? o.barPlaceholder.trim()
    : DEFAULT_PANEL_QUICK.barPlaceholder;
  return { barPlaceholder, barPresets };
}
