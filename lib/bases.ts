import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { phoneForExport } from '@/lib/phone';

const AR = 'America/Argentina/Buenos_Aires';

export type BaseSummary = {
  slug: string;
  name: string;
  hasKommo: boolean;
  sessions: number;
  uniquePhones: number;
  inKommo: number;
  newToday: number;
  new7d: number;
};

export type BasePhone = {
  phone: string;
  name: string;
  firstAt: string;
  lastAt: string;
  step: string;
  campaign: string;
  inKommo: boolean;
};

export type BaseDay = { day: string; nuevos: number; acumulado: number };

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === 'object' && Array.isArray((res as { rows?: T[] }).rows)) {
    return (res as { rows: T[] }).rows;
  }
  return [];
}

export async function listBases(): Promise<BaseSummary[]> {
  const res = await db.execute(sql`
    with firsts as (
      select tenant_id, phone, min(created_at) as first_at
      from chat_sessions
      where phone is not null and phone <> ''
      group by tenant_id, phone
    ),
    growth as (
      select tenant_id,
        count(*) filter (
          where (first_at at time zone ${AR})::date = (now() at time zone ${AR})::date
        )::int as new_today,
        count(*) filter (
          where first_at >= now() - interval '7 days'
        )::int as new_7d
      from firsts
      group by tenant_id
    )
    select t.slug, t.name,
      (coalesce(t.kommo_subdomain, '') <> '') as has_kommo,
      count(s.id)::int as sessions,
      count(distinct nullif(s.phone, ''))::int as unique_phones,
      count(s.kommo_lead_id)::int as in_kommo,
      coalesce(g.new_today, 0)::int as new_today,
      coalesce(g.new_7d, 0)::int as new_7d
    from tenants t
    left join chat_sessions s on s.tenant_id = t.id
    left join growth g on g.tenant_id = t.id
    where t.role = 'client'
    group by t.slug, t.name, t.kommo_subdomain, g.new_today, g.new_7d
    order by unique_phones desc, t.name
  `);
  return rowsOf<{
    slug: string; name: string; has_kommo: boolean; sessions: number;
    unique_phones: number; in_kommo: number; new_today: number; new_7d: number;
  }>(res).map((r) => ({
    slug: r.slug,
    name: r.name,
    hasKommo: !!r.has_kommo,
    sessions: Number(r.sessions),
    uniquePhones: Number(r.unique_phones),
    inKommo: Number(r.in_kommo),
    newToday: Number(r.new_today),
    new7d: Number(r.new_7d),
  }));
}

export async function basePhones(slug: string): Promise<BasePhone[]> {
  const res = await db.execute(sql`
    select s.phone,
      (array_agg(s.name order by s.updated_at desc nulls last))[1] as name,
      min(s.created_at) as first_at,
      max(s.updated_at) as last_at,
      (array_agg(s.step order by s.updated_at desc nulls last))[1] as step,
      (array_agg(s.campaign order by s.updated_at desc nulls last))[1] as campaign,
      bool_or(s.kommo_lead_id is not null) as in_kommo
    from chat_sessions s
    join tenants t on t.id = s.tenant_id
    where t.slug = ${slug} and s.phone is not null and s.phone <> ''
    group by s.phone
    order by min(s.created_at) desc
  `);
  return rowsOf<{
    phone: string; name: string | null; first_at: Date | string; last_at: Date | string;
    step: string | null; campaign: string | null; in_kommo: boolean;
  }>(res).map((r) => ({
    phone: phoneForExport(r.phone),
    name: r.name ?? '',
    firstAt: new Date(r.first_at).toISOString(),
    lastAt: new Date(r.last_at).toISOString(),
    step: r.step ?? '',
    campaign: r.campaign ?? '',
    inKommo: !!r.in_kommo,
  }));
}

export async function baseGrowth(slug: string): Promise<BaseDay[]> {
  const res = await db.execute(sql`
    with firsts as (
      select min(s.created_at) as first_at
      from chat_sessions s
      join tenants t on t.id = s.tenant_id
      where t.slug = ${slug} and s.phone is not null and s.phone <> ''
      group by s.phone
    )
    select to_char(first_at at time zone ${AR}, 'YYYY-MM-DD') as day,
      count(*)::int as nuevos
    from firsts
    group by 1
    order by 1
  `);
  const days = rowsOf<{ day: string; nuevos: number }>(res);
  let acc = 0;
  return days.map((d) => {
    acc += Number(d.nuevos);
    return { day: d.day, nuevos: Number(d.nuevos), acumulado: acc };
  });
}

export function basesCsv(phones: BasePhone[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = ['telefono,nombre,primero,ultimo,estado,campana,en_kommo'];
  for (const p of phones) {
    lines.push([
      p.phone, p.name, p.firstAt, p.lastAt, p.step, p.campaign, p.inKommo ? 'si' : 'no',
    ].map(esc).join(','));
  }
  return lines.join('\n');
}
