import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { basePhones, basesCsv } from '@/lib/bases';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const slug = req.nextUrl.searchParams.get('slug')?.trim();
  if (!slug) return NextResponse.json({ error: 'slug requerido' }, { status: 400 });
  const phones = await basePhones(slug);
  const csv = basesCsv(phones);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="base-${slug}.csv"`,
    },
  });
}
