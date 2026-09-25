// Botones de bienvenida. Archivo sin deps de server para que el widget y
// start/route usen la misma lista (si no, el resume del cliente se desfasaba).

export interface WelcomeBtn { id: string; label: string }

export const WANT_ACCOUNT_BTN: WelcomeBtn = { id: 'want_account', label: 'Quiero mi cuenta 🎁' };
export const WANT_AGENT_BTN: WelcomeBtn = { id: 'want_agent', label: 'Hablar con un agente 🧑‍💼' };
export const WANT_USER_BTN: WelcomeBtn = { id: 'want_account', label: 'Quiero mi usuario' };
export const WANT_AGENT_PLAIN_BTN: WelcomeBtn = { id: 'want_agent', label: 'Hablar con un agente' };
export const HAVE_USER_BTN: WelcomeBtn = { id: 'have_user', label: 'Ya tengo usuario' };
export const WANT_CBU_BTN: WelcomeBtn = { id: 'want_cbu', label: 'Quiero el CBU 💳' };

export const AGENT_BUTTON_SLUGS = ['king', 'paradise', 'elganador', 'luck'];

// Clientes que NO muestran el botón "Ya tengo usuario" en la bienvenida.
// PiliKing (Pili): gente sin usuario lo tocaba y se iba a WhatsApp sin crear
// cuenta ni interactuar. Los recurrentes igual pueden escribir "ya tengo
// usuario" por texto (HAVE_USER_RE) y se desbloquea igual.
export const NO_HAVE_USER_SLUGS = ['piliking'];

// Luck (Laureano): sin gate de instalar app. La gente grande se traba, sobre
// todo en iPhone. El comprobante entra directo a revisión.
export const SKIP_APP_STEP_SLUGS = ['luck'];

export function skipsAppStep(slug: string): boolean {
  return SKIP_APP_STEP_SLUGS.includes(slug);
}

export function hasAgentButton(slug: string): boolean {
  return AGENT_BUTTON_SLUGS.includes(slug);
}

export function welcomeButtons(agentButton = false): WelcomeBtn[] {
  return agentButton ? [WANT_ACCOUNT_BTN, WANT_AGENT_BTN] : [WANT_ACCOUNT_BTN];
}

export function welcomeButtonsFor(slug: string): WelcomeBtn[] {
  // ElGanador (manual): demo en la bienvenida, va directo al CBU.
  // Luck: mismo esquema que Paradise → [Quiero mi cuenta / Hablar con un agente];
  // Green crea el usuario automático y luego se ofrece el CBU.
  if (slug === 'elganador') return [WANT_CBU_BTN];
  if (hasAgentButton(slug)) return welcomeButtons(true);
  if (NO_HAVE_USER_SLUGS.includes(slug)) return [WANT_ACCOUNT_BTN];
  return [WANT_ACCOUNT_BTN, HAVE_USER_BTN];
}
