export type ChatBrand = {
  brandName: string;
  primaryColor: string;
  avatarUrl: string | null;
};

export const DEFAULT_HEADER = '#008069';

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
  };
}

export function publicAvatarUrl(slug: string, cfg: { avatarUrl?: string | null; avatarPath?: string | null }): string | null {
  if (cfg.avatarPath) return `/api/chat/${slug}/avatar`;
  const u = (cfg.avatarUrl ?? '').trim();
  return u || null;
}
