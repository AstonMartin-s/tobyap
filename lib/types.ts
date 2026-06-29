// Tenant ya resuelto: secretos descifrados en memoria + helpers derivados.
// Es lo que consumen lib/meta.ts y el webhook (no tocan la fila cruda de DB).
export interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;

  // Kommo (token descifrado)
  kommoSubdomain: string | null;
  kommoToken: string | null;
  kommoPipelineId: number | null;

  // Meta (token descifrado)
  metaPixelId: string | null;
  metaCapiToken: string | null;
  eventSuffix: string; // "" si no está seteado

  // API externa del cliente (sistema PAYBOT original) — para importar/reportar
  apiUrl: string | null;
  externalApiKey: string | null; // descifrado

  // Mapa de custom fields de Kommo
  customFields: Record<string, number>;
  // Override CCPP -> bono (se combina con el mapa global por defecto)
  bonoMap: Record<string, string>;
  // Solo-lectura: no escribir en los leads del CRM del cliente.
  readonly: boolean;

  // Derivados de customFields (atajos):
  statusCargoId: number | null; // customFields.status_cargo
  statusRevisarImagenId: number | null; // customFields.status_revisar_imagen
  fieldFbclid: number | null;
  fieldFbc: number | null;
  fieldFbp: number | null;
  fieldUtmCampaign: number | null;
  fieldUtmSource: number | null;
  fieldUtmContent: number | null;
}

// --- Sub-bloques opcionales del documento de cliente ---
export interface TenantSettingsInput {
  accountName?: string;
  accountCbu?: string;
  context?: string; // prompt del asistente IA
  message?: string;
  regularMessage?: string;
  walink?: string;
}

export interface TenantNumberInput {
  name?: string;
  phone?: string;
  status?: boolean; // activo/inactivo
  type?: 'publi' | 'regular' | 'spam' | 'soporte' | string;
}

export interface TenantRuleInput {
  rule?: string;
  text?: string;
  crm?: string;
  pipeline?: string;
  priority?: number;
  status?: string;
}

// Forma del JSON de alta (CreateTenantInput). Secretos en claro SOLO local:
// el script/endpoint los cifra al insertar. No commitear archivos con tokens.
export interface CreateTenantInput {
  slug: string;
  name: string;

  // Kommo
  kommoSubdomain?: string;
  kommoToken?: string;
  kommoEmail?: string;
  kommoPassword?: string;
  kommoPipelineId?: number;

  // Panel
  panelUser?: string;
  panelPassword?: string; // se hashea con bcrypt

  // OpenAI / Meta
  openaiApiKey?: string;
  metaPixelId?: string;
  metaCapiToken?: string;
  eventSuffix?: string;

  // Mapa de custom fields + status ids de Kommo
  customFields?: Record<string, number>;
  // Override CCPP -> bono
  bonoMap?: Record<string, string>;
  readonly?: boolean;

  // Documento de cliente (estructura PAYBOT §4)
  role?: 'client' | 'admin' | string;
  platform?: string;
  apiUrl?: string;
  kommoDb?: string;
  projectId?: string;
  pspActive?: boolean;
  pspKey?: string; // cifrado
  externalApiKey?: string; // cifrado

  // Sub-entidades opcionales (se insertan en sus tablas)
  settings?: TenantSettingsInput;
  numbers?: TenantNumberInput[];
  rules?: TenantRuleInput[];
}
