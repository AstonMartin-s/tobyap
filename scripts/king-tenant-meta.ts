import { db } from '@/db';
import { tenants } from '@/db/schema';
import { eq } from 'drizzle-orm';
async function main(){
  const [row] = await db.select().from(tenants).where(eq(tenants.slug, 'king'));
  console.log('updatedAt:', row.updatedAt, '| createdAt:', row.createdAt);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
