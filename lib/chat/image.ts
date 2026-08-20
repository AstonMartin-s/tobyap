// Normaliza una imagen subida para que SIEMPRE se pueda ver en el panel/chat.
//
// Motivo: los iPhone suben las fotos en HEIC/HEIF, un formato que los navegadores
// (Chrome de escritorio, entre otros) no renderizan. El comprobante quedaba
// guardado pero "invisible" (el <img> fallaba y se ocultaba). Acá detectamos HEIC
// por mime, extensión o magic bytes y lo transcodificamos a JPEG. Cualquier otro
// formato (jpeg/png/webp/gif) pasa tal cual.

function isHeic(buf: Buffer, mime: string, name: string): boolean {
  const m = (mime || '').toLowerCase();
  if (m.includes('heic') || m.includes('heif')) return true;
  const n = (name || '').toLowerCase();
  if (n.endsWith('.heic') || n.endsWith('.heif')) return true;
  // Magic bytes: contenedor ISO-BMFF con marca 'ftyp' + brand heic/heif/mif1/heix.
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12).toLowerCase();
    if (['heic', 'heix', 'heif', 'mif1', 'msf1', 'heim', 'heis', 'hevc', 'hevx'].includes(brand)) return true;
  }
  return false;
}

/**
 * Devuelve el buffer y mime listos para guardar/servir. Si es HEIC, lo convierte
 * a JPEG; si la conversión falla, devuelve el original (nunca perdemos el archivo).
 */
export async function normalizeUploadImage(
  buf: Buffer,
  mime: string,
  name: string,
): Promise<{ buf: Buffer; mime: string; converted: boolean }> {
  if (!isHeic(buf, mime, name)) return { buf, mime: mime || 'image/jpeg', converted: false };
  try {
    const { default: convert } = await import('heic-convert');
    const out = await convert({ buffer: new Uint8Array(buf), format: 'JPEG', quality: 0.92 });
    return { buf: Buffer.from(out), mime: 'image/jpeg', converted: true };
  } catch {
    // Si no se pudo convertir, conservamos el original: preferible un archivo
    // "difícil de ver" a perder el comprobante.
    return { buf, mime: mime || 'image/heic', converted: false };
  }
}
