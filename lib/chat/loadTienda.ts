import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { parseTiendaConfig, type TiendaConfig } from '@/lib/chat/tienda';

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
