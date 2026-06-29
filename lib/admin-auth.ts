import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';

// Auth admin: sesión con rol admin O header x-admin-token === ADMIN_TOKEN.
export async function isAdmin(req: NextRequest): Promise<boolean> {
  const session = await getSession();
  if (session?.role === 'admin') return true;
  const token = req.headers.get('x-admin-token');
  return !!token && !!process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN;
}
