import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/session';

// POST /api/logout — cierra la sesión del panel.
export async function POST() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
