import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { tenants } from '@/db/schema';
import { getTenantBySlug, invalidateTenant } from '@/lib/tenants';

// Completa el mapeo de Kommo para bblack (Partner API): crea los custom fields
// de portal que faltan y agrega los status ids ya existentes en el embudo
// (Pidio Usuario, Usuario Creado, Pidio CbuAlias, No Cargo) + el pipeline de
// Clientes / Atencion manual. NO toca los campos ya configurados (fbclid, CBU,
// TITULAR, status_cargo, status_revisar_imagen).
async function kommo<T>(subdomain: string, token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://${subdomain}.kommo.com/api/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Kommo ${init?.method ?? 'GET'} ${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function main() {
  const t = await getTenantBySlug('bblack');
  if (!t || !t.kommoSubdomain || !t.kommoToken) throw new Error('bblack sin kommo config');

  // 1) Crear los 3 campos de portal si no existen.
  const cur = await kommo<{ _embedded?: { custom_fields?: Array<{ id: number; name: string }> } }>(
    t.kommoSubdomain, t.kommoToken, '/leads/custom_fields?limit=250',
  );
  const byName = new Map<string, number>();
  for (const f of cur._embedded?.custom_fields ?? []) byName.set(f.name.trim().toLowerCase(), f.id);

  const wanted = ['Usuario Portal', 'Clave Portal', 'URL Portal'];
  const missing = wanted.filter((n) => !byName.has(n.toLowerCase()));
  if (missing.length) {
    const res = await kommo<{ _embedded: { custom_fields: Array<{ id: number; name: string }> } }>(
      t.kommoSubdomain, t.kommoToken, '/leads/custom_fields',
      { method: 'POST', body: JSON.stringify(missing.map((name) => ({ name, type: 'text' }))) },
    );
    for (const f of res._embedded.custom_fields) byName.set(f.name.toLowerCase(), f.id);
    console.log('creados:', missing.join(', '));
  } else {
    console.log('los 3 campos de portal ya existían');
  }

  // 2) Merge de customFields: preservo lo existente, agrego lo nuevo.
  const merged: Record<string, number> = {
    ...t.customFields,
    portal_user_field: byName.get('usuario portal')!,
    portal_pass_field: byName.get('clave portal')!,
    portal_url_field: byName.get('url portal')!,
    status_pidio_usuario: 109835531, // "Pidio Usuario"
    status_usuario_creado: 109835535, // "Usuario Creado"
    status_pidio_cbu: 109835539, // "Pidio CbuAlias"
    status_no_cargo: 109835559, // "No Cargo"
    clientes_pipeline: 14222063, // "Clientes"
    status_atencion_manual: 109807579, // "Atencion manual" (dentro de Clientes)
  };

  await db.update(tenants).set({ customFields: merged, updatedAt: new Date() }).where(eq(tenants.slug, 'bblack'));
  invalidateTenant('bblack');
  console.log('customFields actualizado:', JSON.stringify(merged, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
