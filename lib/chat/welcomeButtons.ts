// Botones de bienvenida. Archivo sin deps de server para que el widget y
// start/route usen la misma lista (si no, el resume del cliente se desfasaba).

export interface WelcomeBtn { id: string; label: string }

export const WANT_ACCOUNT_BTN: WelcomeBtn = { id: 'want_account', label: 'Quiero mi cuenta 🎁' };
export const WANT_AGENT_BTN: WelcomeBtn = { id: 'want_agent', label: 'Hablar con un agente 🧑‍💼' };
export const WANT_USER_BTN: WelcomeBtn = { id: 'want_account', label: 'Quiero mi usuario' };
export const WANT_AGENT_PLAIN_BTN: WelcomeBtn = { id: 'want_agent', label: 'Hablar con un agente' };
export const HAVE_USER_BTN: WelcomeBtn = { id: 'have_user', label: 'Ya tengo usuario' };

export const AGENT_BUTTON_SLUGS = ['king', 'paradise', 'elganador'];

export function hasAgentButton(slug: string): boolean {
  return AGENT_BUTTON_SLUGS.includes(slug);
}

export function welcomeButtons(agentButton = false): WelcomeBtn[] {
  return agentButton ? [WANT_ACCOUNT_BTN, WANT_AGENT_BTN] : [WANT_ACCOUNT_BTN];
}

export function welcomeButtonsFor(slug: string): WelcomeBtn[] {
  if (slug === 'elganador') return [WANT_USER_BTN, WANT_AGENT_PLAIN_BTN];
  if (hasAgentButton(slug)) return welcomeButtons(true);
  return [WANT_ACCOUNT_BTN, HAVE_USER_BTN];
}
