// Aislamiento de pauta Meta: si el tenant tiene landingDomain propio y no
// chatDomain, landing + chat van same-origin en el host que recibió el clic
// (go.juegayahorra.online, go.fichaslibres.online, etc.). Soporte no se mueve.

export const JUEGA_LANDING_HOST = 'go.juegayahorra.online';

function hostOf(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
}

export function adsLandingHost(chatConfig: unknown): string {
  const cc = chatConfig && typeof chatConfig === 'object' && !Array.isArray(chatConfig)
    ? (chatConfig as Record<string, unknown>)
    : {};
  return hostOf(cc.landingDomain);
}

export function adsChatHost(chatConfig: unknown): string {
  const cc = chatConfig && typeof chatConfig === 'object' && !Array.isArray(chatConfig)
    ? (chatConfig as Record<string, unknown>)
    : {};
  return hostOf(cc.chatDomain);
}

/** landingDomain seteado y sin chatDomain → chat relativo en el mismo host. */
export function usesAdsSameOrigin(chatConfig: unknown): boolean {
  return !!adsLandingHost(chatConfig) && !adsChatHost(chatConfig);
}

export function isChatLandingConfig(cfg: Record<string, unknown> | null | undefined): boolean {
  return typeof cfg?.chatSlug === 'string' && String(cfg.chatSlug).trim() !== '';
}
