import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { parseChatRuntime, type ChatRuntimeConfig } from '@/lib/chat/runtime';

export async function loadChatRuntime(tenantId: string, fallbackBrand: string): Promise<ChatRuntimeConfig> {
  try {
    const [row] = await db
      .select({ chatConfig: clientSettings.chatConfig })
      .from(clientSettings)
      .where(eq(clientSettings.tenantId, tenantId))
      .limit(1);
    return parseChatRuntime(row?.chatConfig, fallbackBrand);
  } catch {
    return parseChatRuntime({}, fallbackBrand);
  }
}
