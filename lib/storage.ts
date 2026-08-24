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
  const rel = path.join('comprobantes', `${sessionKey}-${Date.now()}.${extFromMime(mime)}`);
  const full = path.join(DIR, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
  return rel;
}

export async function saveBrandAvatar(tenantId: string, buf: Buffer, mime: string): Promise<string | null> {
  if (!storageEnabled()) return null;
  const rel = path.join('brand', `${tenantId}.${extFromMime(mime)}`);
  const full = path.join(DIR, rel);
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
