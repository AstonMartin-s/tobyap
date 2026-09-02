import { promises as fs } from 'fs';
import path from 'path';

// Almacenamiento de imágenes (comprobantes) FUERA de Postgres.
//
// Motivo: guardar el base64 en la fila de la sesión infla la DB (backups, costo,
// performance) y no escala a volumen alto. Con un volumen de Railway montado
// (barato, sin egress, bajo tu control) escribimos los archivos a disco y en la
// DB queda solo la RUTA. Si UPLOAD_DIR no está seteado, se cae al modo anterior
// (base64 en DB) — así nada se rompe hasta que montes el volumen.
//
// Setup (una vez, en Railway): crear un Volume, montarlo (ej. en /data) y setear
//   UPLOAD_DIR=/data
// Listo — los comprobantes nuevos van a disco; los viejos (base64) se siguen
// sirviendo igual.

const DIR = process.env.UPLOAD_DIR || '';

export function storageEnabled(): boolean {
  return DIR.length > 0;
}

// Tipos raster/PDF que aceptamos y servimos INLINE de forma segura. Cualquier
// otra cosa (svg/html/xml → ejecutan JS al servirse como image/svg+xml) se sirve
// como octet-stream (descarga), nunca inline ejecutable.
const SAFE_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/bmp', 'image/tiff', 'image/heic', 'image/heif', 'application/pdf',
]);

function normMime(mime: string): string {
  return (mime || '').toLowerCase().split(';')[0].trim();
}

/** true si el mime es un formato de comprobante seguro para servir inline. */
export function isSafeServeMime(mime: string): boolean {
  return SAFE_MIMES.has(normMime(mime));
}

/** Mime de subida claramente peligroso (ejecuta script al servirse). */
export function isDangerousUploadMime(mime: string): boolean {
  return /svg|html|xml|javascript|xhtml/i.test(mime || '');
}

/** Content-Type seguro para /file: si no está en la whitelist, forzamos descarga. */
export function safeServeContentType(mime: string): string {
  const m = normMime(mime);
  return SAFE_MIMES.has(m) ? m : 'application/octet-stream';
}

/** Resuelve `rel` dentro de DIR o null si escapa (anti path-traversal). */
function safeFullPath(rel: string): string | null {
  const root = path.resolve(DIR);
  const full = path.resolve(DIR, rel);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

/** Sanea un segmento para usar en nombre de archivo (sin separadores ni `..`). */
function safeSegment(s: string): string {
  return (s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'x';
}

const extFromMime = (mime: string): string => {
  const m = (mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('heic')) return 'heic';
  if (m.includes('heif')) return 'heif';
  if (m.includes('bmp')) return 'bmp';
  if (m.includes('tiff')) return 'tiff';
  return 'jpg';
};

// Guarda el buffer y devuelve la ruta RELATIVA (a persistir en la sesión), o null
// si el storage no está configurado (el caller cae a base64).
export async function saveComprobante(sessionKey: string, buf: Buffer, mime: string): Promise<string | null> {
  if (!storageEnabled()) return null;
  const rel = path.join('comprobantes', `${safeSegment(sessionKey)}-${Date.now()}.${extFromMime(mime)}`);
  const full = safeFullPath(rel);
  if (!full) return null;
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
  return rel;
}

export async function saveBrandAvatar(tenantId: string, buf: Buffer, mime: string): Promise<string | null> {
  if (!storageEnabled()) return null;
  const rel = path.join('brand', `${safeSegment(tenantId)}.${extFromMime(mime)}`);
  const full = safeFullPath(rel);
  if (!full) return null;
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
  return rel;
}

// Borra un comprobante del disco por su ruta relativa (limpieza a las 48h).
export async function deleteComprobante(rel: string): Promise<void> {
  if (!storageEnabled() || !rel) return;
  try {
    const full = path.resolve(DIR, rel);
    if (!full.startsWith(path.resolve(DIR))) return;
    await fs.unlink(full);
  } catch {
    /* ya no existe / best-effort */
  }
}

// Lee un comprobante por su ruta relativa. Null si no existe / storage off.
export async function readComprobante(rel: string): Promise<Buffer | null> {
  if (!storageEnabled() || !rel) return null;
  try {
    // Guardas contra path traversal: solo dentro de DIR.
    const full = path.resolve(DIR, rel);
    if (!full.startsWith(path.resolve(DIR))) return null;
    return await fs.readFile(full);
  } catch {
    return null;
  }
}
