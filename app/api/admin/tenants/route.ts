import { NextRequest, NextResponse } from 'next/server';
import { createTenant } from '@/lib/tenants';
import type { CreateTenantInput } from '@/lib/types';

// POST /api/admin/tenants
// Alta de cliente. Protegido por header x-admin-token === ADMIN_TOKEN.
export async function POST(req: NextRequest) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.headers.get('x-admin-token') !== adminToken) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }

  let input: CreateTenantInput;
  try {
    input = (await req.json()) as CreateTenantInput;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!input.slug || !input.name) {
    return NextResponse.json({ error: 'slug y name son requeridos' }, { status: 400 });
  }

  try {
    const row = await createTenant(input);
    // Nunca devolvemos los secretos cifrados.
    return NextResponse.json({ ok: true, id: row.id, slug: row.slug });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
