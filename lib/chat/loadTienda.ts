import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { parseTiendaConfig, type TiendaConfig } from '@/lib/chat/tienda';
import { parseChatFlow, EMPTY_FLOW, type ChatFlow } from '@/lib/chat/flowGraph';

// Carga la config del nicho TIENDA (chat_config.tienda) para un tenant.
export async function loadTiendaConfig(tenantId: string, fallbackBrand: string): Promise<TiendaConfig> {
  try {
    const [row] = await db
      .select({ chatConfig: clientSettings.chatConfig })
      .from(clientSettings)
      .where(eq(clientSettings.tenantId, tenantId))
      .limit(1);
    return parseTiendaConfig(row?.chatConfig, fallbackBrand);
  } catch {
    return parseTiendaConfig({}, fallbackBrand);
  }
}

// Carga el flow custom (chat_config.flow). Si no hay/está deshabilitado, devuelve EMPTY_FLOW.
export async function loadChatFlow(tenantId: string): Promise<ChatFlow> {
  try {
    const [row] = await db
      .select({ chatConfig: clientSettings.chatConfig })
      .from(clientSettings)
      .where(eq(clientSettings.tenantId, tenantId))
      .limit(1);
    return parseChatFlow(row?.chatConfig);
  } catch {
    return EMPTY_FLOW;
  }
}
