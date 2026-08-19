import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientSettings } from '@/db/schema';
import { parseChatConfig, type ChatBrand } from '@/lib/chat/brand';

export async function loadChatBrand(tenantId: string, slug: string, fallbackName: string): Promise<ChatBrand> {
  try {
    const [row] = await db.select({ chatConfig: clientSettings.chatConfig }).from(clientSettings).where(eq(clientSettings.tenantId, tenantId)).limit(1);
    return parseChatConfig(row?.chatConfig, fallbackName, slug);
  } catch {
    return parseChatConfig({}, fallbackName, slug);
  }
}
