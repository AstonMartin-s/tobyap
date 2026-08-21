import type { BotMsg } from '@/lib/chat/flow';

/** Escalona `at` según delayMs para que bloques de bot no parezcan un solo disparo. */
export function staggerBotMessages(messages: BotMsg[]): BotMsg[] {
  let t = Date.now();
  return messages.map((m) => {
    const pause = m.delayMs ?? 700;
    t += pause;
    return { ...m, at: t, delayMs: pause };
  });
}

export type StoredBotMsg = {
  from: 'bot';
  text?: string;
  image?: string;
  copy?: string;
  at: number;
  delayMs?: number;
  op?: boolean;
};

export function toStoredBot(m: BotMsg, extra?: Partial<StoredBotMsg>): StoredBotMsg {
  return {
    from: 'bot',
    text: m.text,
    image: m.image,
    copy: m.copy,
    at: m.at,
    delayMs: m.delayMs,
    ...extra,
  };
}

export function prepareBotBatch(messages: BotMsg[], extra?: Partial<StoredBotMsg>): StoredBotMsg[] {
  return staggerBotMessages(messages).map((m) => toStoredBot(m, extra));
}
