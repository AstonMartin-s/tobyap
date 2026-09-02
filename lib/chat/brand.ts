// Copy editable del formulario de inicio del chat (gate). Vacío = usa el default
// del nicho en el widget (Circo: usuario/bonificación · Tienda: compra/producto).
export type ChatGateCopy = {
  title: string;   // subtítulo bajo la marca ("Dejanos tu número...")
  note: string;    // aviso de atención automática (sin negritas)
  confirm: string; // texto del checkbox de confirmación de número
};

export type ChatBrand = {
  brandName: string;
  primaryColor: string;
  avatarUrl: string | null;
  gate: ChatGateCopy;
};

export const DEFAULT_HEADER = '#008069';

export function parseGateCopy(raw: unknown): ChatGateCopy {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return { title: s(o.title), note: s(o.note), confirm: s(o.confirm) };
}

export function parseChatConfig(raw: unknown, fallbackName: string, slug: string): ChatBrand {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const name = typeof o.brandName === 'string' ? o.brandName.trim() : '';
  const color = typeof o.primaryColor === 'string' ? o.primaryColor.trim() : '';
  const avatar = typeof o.avatarUrl === 'string' ? o.avatarUrl.trim() : '';
  const avatarPath = typeof o.avatarPath === 'string' ? o.avatarPath : null;
  return {
    brandName: name || fallbackName || 'Soporte',
    primaryColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_HEADER,
    avatarUrl: publicAvatarUrl(slug, { avatarUrl: avatar, avatarPath }),
    gate: parseGateCopy(o.gate),
  };
}

export function publicAvatarUrl(slug: string, cfg: { avatarUrl?: string | null; avatarPath?: string | null }): string | null {
  if (cfg.avatarPath) return `/api/chat/${slug}/avatar`;
  const u = (cfg.avatarUrl ?? '').trim();
  return u || null;
}
