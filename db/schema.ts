import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
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
  apiUrl: text('api_url'), // URL externa del cliente (api-paybot-...)
  kommoDb: text('kommo_db'), // etiqueta lógica de partición de eventos
  projectId: text('project_id'), // proyecto Vercel asociado
  pspActive: boolean('psp_active').default(false),
  pspKey: text('psp_key'), // cifrado — clave del PSP
  externalApiKey: text('external_api_key'), // cifrado — pbx_ext_live_... (API externa §8)

  // Override por cliente del mapa CCPP -> bono (ej. { "A1": "Bono10%" }).
  // Si falta una clave, se usa el mapa global por defecto (lib/attribution).
  bonoMap: jsonb('bono_map').$type<Record<string, string>>().default({}),

  // Modo solo-lectura: trackeamos (leemos + DB propia + Meta) pero NUNCA escribimos
  // en los leads del CRM del cliente (sin etiquetas, sin CBU, sin custom fields).
  readonly: boolean('readonly').default(false),
  // Excepción a readonly: permite postear SOLO etiquetas (categoría + bono),
  // manteniendo bloqueados CBU/titular y custom fields (fbclid/utm).
  allowTags: boolean('allow_tags').default(false),

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
    name: text('name'),
    type: text('type'), // publi | regular | spam | remarketing | soporte
    active: boolean('active').default(true),
    // Presentación + comportamiento de NUESTRA landing (servida en Railway):
    // { brandName, primaryColor, logoUrl, headline, subtext, message, waNumber,
    //   pixelId, ccpp, campaign, redirectDelayMs }
    config: jsonb('config').$type<Record<string, string | number | null>>().default({}),
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
// kommo_webhook_log — log crudo para debug / reprocesar.
// ---------------------------------------------------------------------------
export const kommoWebhookLog = pgTable('kommo_webhook_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),
  body: jsonb('body'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow(),
  processed: boolean('processed').default(false),
});

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
