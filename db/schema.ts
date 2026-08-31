import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  unique,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// ledger — gasto/ingreso (depósitos) manual por cliente y día. Alimenta los
// reportes diarios de ads: $/chat, $/carga, balance. Una fila por (tenant, día);
// "Agregar Ingreso/Gasto" suma sobre la fila del día.
// ---------------------------------------------------------------------------
export const ledger = pgTable(
  'ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    day: text('day').notNull(), // 'YYYY-MM-DD' (zona AR del operador)
    gasto: doublePrecision('gasto').default(0), // inversión en ads (USD)
    ingreso: doublePrecision('ingreso').default(0), // depósitos / ingresos (USD)
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({ uniqDay: unique('ledger_tenant_day').on(t.tenantId, t.day) }),
);

// ---------------------------------------------------------------------------
// influencer_spend — gasto en campañas de INFLUENCERS, caja APARTE del cliente.
// NO toca el ledger ni el saldo disponible (el cliente maneja su propia caja):
// es SOLO trazabilidad para calcular CPA/rendimiento del canal influencer.
// Una fila por (tenant, campaña, día). Lo carga el admin del cliente.
// ---------------------------------------------------------------------------
export const influencerSpend = pgTable(
  'influencer_spend',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    campaign: text('campaign').notNull(), // ej. "INFLUjuan" (prefijo influ*)
    day: text('day').notNull(), // 'YYYY-MM-DD' (zona AR)
    amount: doublePrecision('amount').default(0), // gasto en ARS
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({ uniqSpend: unique('influencer_spend_tenant_campaign_day').on(t.tenantId, t.campaign, t.day) }),
);
export type InfluencerSpendRow = typeof influencerSpend.$inferSelect;

// ---------------------------------------------------------------------------
// tenants — un registro por cliente. Secretos cifrados (AES-256-GCM) en reposo.
// ---------------------------------------------------------------------------
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(), // usado en la URL del webhook
  name: text('name').notNull(),

  // Kommo
  kommoSubdomain: text('kommo_subdomain'),
  kommoToken: text('kommo_token'), // cifrado
  kommoEmail: text('kommo_email'),
  kommoPassword: text('kommo_password'), // cifrado
  kommoPipelineId: bigint('kommo_pipeline_id', { mode: 'number' }),

  // Panel
  panelUser: text('panel_user'),
  panelPasswordHash: text('panel_password_hash'), // bcrypt

  // OpenAI
  openaiApiKey: text('openai_api_key'), // cifrado

  // Meta
  metaPixelId: text('meta_pixel_id'),
  metaCapiToken: text('meta_capi_token'), // cifrado
  eventSuffix: text('event_suffix'), // "30" -> ConversacionCRM30 / CargoCRM30

  // Mapa flexible de custom fields de Kommo (ids) + status ids:
  // { fbclid, utm_campaign, utm_source, utm_content, fbc?, fbp?, status_cargo? }
  customFields: jsonb('custom_fields').$type<Record<string, number>>().default({}),

  // --- Documento de cliente (estructura PAYBOT, §4) ---
  role: text('role').default('client'), // client | admin
  platform: text('platform').default('meta'),
  // Nicho: gran rama de negocio que determina el proceso de venta / guion.
  // 'circo' (casino/apuestas, default = todo lo existente) | 'tienda' (ecommerce).
  niche: text('niche').default('circo'),
  apiUrl: text('api_url'), // URL externa del cliente (api-paybot-...)
  kommoDb: text('kommo_db'), // etiqueta lógica de partición de eventos
  projectId: text('project_id'), // proyecto Vercel asociado
  pspActive: boolean('psp_active').default(false),
  pspKey: text('psp_key'), // cifrado — clave del PSP
  externalApiKey: text('external_api_key'), // cifrado — pbx_ext_live_... (API externa §8)

  // Pagoda (dat4win) — integración de creación de cuentas de portal. El bot pide
  // un usuario y Pagoda devuelve login_url/usuario/clave. Por-cliente.
  pagodaUrl: text('pagoda_url'), // ej: https://pagoda.dat4win.com
  pagodaApiKey: text('pagoda_api_key'), // cifrado — pgk_...

  // Proveedor de creación de cuenta de portal: 'pagoda' (King) | 'partner_api'
  // (bblack — server-to-server, nosotros generamos user/pass). Default 'pagoda'
  // preserva el comportamiento de todos los tenants existentes.
  provider: text('provider').default('pagoda'),
  // Partner API (ej. KingPlay/bblack) — alta de jugador + login único.
  partnerApiUrl: text('partner_api_url'), // ej: https://api-kplay.com/api/v1
  partnerApiKey: text('partner_api_key'), // cifrado — pk_...

  // Afiliados Telegram — secreto compartido para firmar (HMAC-SHA256) el webhook
  // entrante que nos devuelve conversiones por code (registro / primera carga).
  affiliateWebhookSecret: text('affiliate_webhook_secret'), // cifrado

  // Override por cliente del mapa CCPP -> bono (ej. { "A1": "Bono10%" }).
  // Si falta una clave, se usa el mapa global por defecto (lib/attribution).
  bonoMap: jsonb('bono_map').$type<Record<string, string>>().default({}),

  // Modo solo-lectura: trackeamos (leemos + DB propia + Meta) pero NUNCA escribimos
  // en los leads del CRM del cliente (sin etiquetas, sin CBU, sin custom fields).
  readonly: boolean('readonly').default(false),
  // Excepción a readonly: permite postear SOLO etiquetas (categoría + bono),
  // manteniendo bloqueados CBU/titular y custom fields (fbclid/utm).
  allowTags: boolean('allow_tags').default(false),
  // Cursor para rotación round-robin estricta de números publi en las landings.
  rotationCursor: integer('rotation_cursor').default(0),

  active: boolean('active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// client_settings — configuración general del cliente (§6.1). 1:1 con tenant.
// ---------------------------------------------------------------------------
export const clientSettings = pgTable('client_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  accountName: text('account_name'),
  accountCbu: text('account_cbu'),
  context: text('context'), // prompt del asistente IA (§6.5)
  message: text('message'), // mensaje/bono de bienvenida
  regularMessage: text('regular_message'),
  walink: text('walink'), // número base del link de WhatsApp
  // Piel del chat web (Fase 4): nombre, color, foto. Vacío = fallback tenant.name + verde WA.
  chatConfig: jsonb('chat_config').$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// numbers — números de contacto rotativos (§6.2).
// ---------------------------------------------------------------------------
export const numbers = pgTable('numbers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name'),
  phone: text('phone'),
  status: boolean('status').default(true), // activo/inactivo
  type: text('type'), // publi | regular | spam | soporte
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// statuses — espejo de los estados del pipeline de Kommo (§6.3).
// ---------------------------------------------------------------------------
export const statuses = pgTable('statuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  kommoStatusId: bigint('kommo_status_id', { mode: 'number' }),
  name: text('name'),
  description: text('description'),
  color: text('color'),
  pipelineId: bigint('pipeline_id', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// rules — reglas del clasificador IA (§6.4). Configuradas; hoy apagadas.
// ---------------------------------------------------------------------------
export const rules = pgTable('rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  rule: text('rule'), // instrucción en lenguaje natural
  text: text('text'), // etiqueta/estado destino
  crm: text('crm').default('kommo'),
  pipeline: text('pipeline').default('sales'),
  priority: bigint('priority', { mode: 'number' }).default(1),
  status: text('status').default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// landings — páginas de redirect por cliente (§7). Deploy en Vercel.
// ---------------------------------------------------------------------------
export const landings = pgTable(
  'landings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // landingSlug: identifica la landing dentro del cliente => /l/<tenant>/<landingSlug>
    landingSlug: text('landing_slug'),
    // alias: URL corta que NO expone el tenant => /l/<alias> (único globalmente).
    alias: text('alias').unique(),
    name: text('name'),
    type: text('type'), // publi | regular | spam | remarketing | soporte
    active: boolean('active').default(true),
    // Presentación + comportamiento de NUESTRA landing (servida en Railway):
    // { brandName, primaryColor, logoUrl, headline, subtext, message, waNumber,
    //   pixelId, ccpp, campaign, redirectDelayMs }
    config: jsonb('config').$type<Record<string, string | number | boolean | null>>().default({}),
    url: text('url'), // URL final (dominio propio cuando se mapee)
    environments: jsonb('environments').$type<string[]>().default(['production']),
    db: text('db'),
    vercel: jsonb('vercel'), // legado del sistema original
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniqLanding: unique('landings_tenant_slug').on(t.tenantId, t.landingSlug),
  }),
);

// ---------------------------------------------------------------------------
// ad_accounts — cuentas publicitarias de Meta (§5.1). Globales.
// ---------------------------------------------------------------------------
export const adAccounts = pgTable('ad_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  metaAccountId: text('meta_account_id').notNull().unique(), // act_...
  name: text('name'),
  accountStatus: bigint('account_status', { mode: 'number' }),
  currency: text('currency'),
  timezoneName: text('timezone_name'),
  owner: text('owner'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// campaigns — campañas de Meta por cliente (§5.2).
// ---------------------------------------------------------------------------
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  campaignId: text('campaign_id'),
  campaignName: text('campaign_name'),
  ref: text('ref'),
  accountId: text('account_id'),
  accountName: text('account_name'),
  objective: text('objective'),
  platform: text('platform').default('meta'),
  status: text('status'),
  dailyBudget: text('daily_budget'),
  lifetimeBudget: text('lifetime_budget'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// leads — espejo del lead de Kommo + atribución de Meta. Particionado por tenant.
// ---------------------------------------------------------------------------
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    kommoLeadId: bigint('kommo_lead_id', { mode: 'number' }),
    kommoContactId: bigint('kommo_contact_id', { mode: 'number' }),
    phone: text('phone'),
    name: text('name'),
    campaignId: text('campaign_id'),

    // atribución capturada en la landing
    fbp: text('fbp'),
    fbc: text('fbc'),
    fbclid: text('fbclid'),
    eventSourceUrl: text('event_source_url'),

    status: text('status'), // estado actual del pipeline
    converted: boolean('converted').default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniqLead: unique('leads_tenant_kommo_lead').on(t.tenantId, t.kommoLeadId),
  }),
);

// ---------------------------------------------------------------------------
// meta_events — cada intento de envío a Meta (idempotencia + auditoría).
// ---------------------------------------------------------------------------
export const metaEvents = pgTable(
  'meta_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),

    eventName: text('event_name').notNull(), // ConversacionCRM30 | CargoCRM30
    eventId: text('event_id').notNull(), // dedup / idempotencia
    eventType: text('event_type'), // redirect | conversacion | cargo  (event1/event2/visita)
    payload: jsonb('payload'),
    response: jsonb('response'),
    status: text('status').default('pending'), // pending | sent | failed

    // --- Campos crudos del evento (estructura PAYBOT §5.5) ---
    conversionData: jsonb('conversion_data'), // payload exacto a Meta CAPI
    messageData: jsonb('message_data'), // mensaje de Kommo origen
    extractedCode: text('extracted_code'), // código de carga extraído
    campaignId: text('campaign_id'),
    metaCampaignId: text('meta_campaign_id'),
    metaCampaignName: text('meta_campaign_name'),
    metaAdId: text('meta_ad_id'),
    metaAdName: text('meta_ad_name'),
    success: boolean('success'),

    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniqEvent: unique('meta_events_tenant_event').on(t.tenantId, t.eventId),
  }),
);

// ---------------------------------------------------------------------------
// attributions — atribución de una visita, indexada por un TOKEN único que viaja
// en el mensaje de WhatsApp. Al llegar el lead se matchea por el token y se
// asignan etiquetas (campaña + bono) + se escriben fbclid/utm en el lead.
// ---------------------------------------------------------------------------
export const attributions = pgTable(
  'attributions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(), // token único en el mensaje

    campaignId: text('campaign_id'), // CC1 (== nombre de campaña en Meta)
    ccpp: text('ccpp'), // A1 (código promocional)
    bono: text('bono'), // Bono10% (resuelto desde ccpp)

    fbclid: text('fbclid'),
    fbp: text('fbp'),
    fbc: text('fbc'),
    utmSource: text('utm_source'),
    utmCampaign: text('utm_campaign'),
    utmContent: text('utm_content'),
    namead: text('namead'),
    eventSourceUrl: text('event_source_url'),

    matchedLeadId: bigint('matched_lead_id', { mode: 'number' }),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniqCode: unique('attributions_tenant_code').on(t.tenantId, t.code),
  }),
);

// ---------------------------------------------------------------------------
// send_list — lista de envío de reactivación (phone -> tier/ccpp) por tenant.
// Fallback de atribución para el CRM cuando el lead borra/modifica el token del
// mensaje: se resuelve el bono por teléfono contra esta lista (latest-wins).
// La escribe el admin (carga por campaña); la LEE el CRM vía /api/v1/resolve?phone=.
// phoneKey = solo dígitos (sin +, espacios ni guiones) para matchear formatos.
// ---------------------------------------------------------------------------
export const sendList = pgTable(
  'send_list',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(), // E.164 como vino (display)
    phoneKey: text('phone_key').notNull(), // solo dígitos, clave de match
    ccpp: text('ccpp').notNull(), // tier / código promocional (W50, E15, ...)
    campaign: text('campaign'), // opcional, nombre de la campaña de envío
    portalSlug: text('portal_slug'), // opcional, portal multi-landing al que va el segmento
    sentAt: timestamp('sent_at', { withTimezone: true }), // enviado_at (para latest-wins / ts)
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniqPhone: unique('send_list_tenant_phone').on(t.tenantId, t.phoneKey),
  }),
);

// ---------------------------------------------------------------------------
// kommo_webhook_log — log crudo para debug / reprocesar.
// ---------------------------------------------------------------------------
export const kommoWebhookLog = pgTable('kommo_webhook_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),
  body: jsonb('body'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow(),
  processed: boolean('processed').default(false),
});

// ---------------------------------------------------------------------------
// chatSessions — sesión del CHAT WEB embebido (look WhatsApp) que reemplaza el
// redirect a wa.me. Adaptador B: el guion corre en nuestro backend, se espeja en
// Kommo y dispara Pagoda. Una fila por conversación.
// ---------------------------------------------------------------------------
export const chatSessions = pgTable('chat_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  sessionKey: text('session_key').notNull().unique(), // id opaco que usa el widget
  phone: text('phone'),
  name: text('name'),
  waVerified: boolean('wa_verified').default(false), // pasó el wachecker
  token: text('token'), // código de atribución del redirect
  campaign: text('campaign'),
  ccpp: text('ccpp'),
  step: text('step').default('form'), // form|welcome|credenciales|cbu|comprobante|done
  kommoLeadId: bigint('kommo_lead_id', { mode: 'number' }),
  data: jsonb('data').$type<Record<string, unknown>>().default({}), // credenciales, etc.
  messages: jsonb('messages').$type<Array<{ from: 'bot' | 'user'; text?: string; image?: string; at: number }>>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
export type ChatSessionRow = typeof chatSessions.$inferSelect;

export type TenantRow = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type LeadRow = typeof leads.$inferSelect;
export type ClientSettingsRow = typeof clientSettings.$inferSelect;
export type NumberRow = typeof numbers.$inferSelect;
export type StatusRow = typeof statuses.$inferSelect;
export type RuleRow = typeof rules.$inferSelect;
export type LandingRow = typeof landings.$inferSelect;
export type AdAccountRow = typeof adAccounts.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;
export type MetaEventRow = typeof metaEvents.$inferSelect;
export type AttributionRow = typeof attributions.$inferSelect;

// ===========================================================================
// MÓDULO AISLADO A3 (ClienteA3 · Pagoda + Meta Ads · landing + relay webhook).
// Tablas propias con prefijo a3_. NO se relacionan con tenants ni con el resto
// del circuito (Kommo/CAPI/attributions). Sólo las usa el namespace `a3`.
// ===========================================================================

// Una fila por conversación NUEVA (primer mensaje entrante de un teléfono por
// línea). Sirve para medir conversaciones generadas y atribuirlas a la campaña
// (parseada del marcador [campaign] del texto pre-cargado por la landing).
export const a3Conversations = pgTable(
  'a3_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    line: text('line').notNull(), // clave de línea (ej. "sri", "shinde")
    phoneKey: text('phone_key').notNull(), // solo dígitos
    phone: text('phone'), // wa_id como vino
    campaign: text('campaign'), // del marcador [C1]; null si no vino
    firstText: text('first_text'), // texto del primer mensaje (debug)
    waMessageId: text('wa_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({ uniqConv: unique('a3_conv_line_phone').on(t.line, t.phoneKey) }),
);

// Estado interno del módulo a3 (cursor de rotación round-robin de líneas).
export const a3State = pgTable('a3_state', {
  id: integer('id').primaryKey().default(1),
  rotationCursor: integer('rotation_cursor').default(0),
});

export type A3ConversationRow = typeof a3Conversations.$inferSelect;

// ---------------------------------------------------------------------------
// partner_operations — cargas/retiros de saldo real hechos vía Partner API
// (bblack/KingPlay) desde el panel. Una fila por operación. Sirve para:
//  (a) idempotencia: la `reference` única evita duplicar ante doble-click/retry.
//  (b) "Balance Total" del panel (sumatoria de cargado/retirado — la API no lo da).
// ---------------------------------------------------------------------------
export const partnerOperations = pgTable('partner_operations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id'), // chat asociado (si aplica)
  username: text('username').notNull(), // jugador en la plataforma
  type: text('type').notNull(), // 'deposit' | 'withdraw'
  amount: doublePrecision('amount').notNull(), // en pesos
  reference: text('reference').notNull().unique(), // llave de idempotencia
  bonusPercent: integer('bonus_percent'), // bono aplicado (solo deposit)
  ledgerId: bigint('ledger_id', { mode: 'number' }), // id de la op en la plataforma
  balanceAfter: doublePrecision('balance_after'), // saldo resultante que devolvió la API
  operator: text('operator'), // quién la disparó (panel)
  status: text('status').default('pending'), // pending | done | failed
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
export type PartnerOperationRow = typeof partnerOperations.$inferSelect;

// ---------------------------------------------------------------------------
// panel_users — operadores y admins del panel. Cada tenant tiene al menos un
// admin (migrado automáticamente desde tenants.panelUser). Los operadores
// tienen acceso limitado según su rol.
// ---------------------------------------------------------------------------
export const panelUsers = pgTable('panel_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  role: text('role').notNull().default('operador'), // 'admin' | 'supervisor' | 'operador'
  active: boolean('active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
export type PanelUserRow = typeof panelUsers.$inferSelect;
