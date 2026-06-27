import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Cifrado de secretos en reposo — AES-256-GCM (autenticado).
// Formato del ciphertext: "<iv_hex>:<tag_hex>:<data_hex>".
// La master key (ENCRYPTION_KEY) son 32 bytes en hex, solo en ENV.
// ---------------------------------------------------------------------------

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY ausente o inválida (esperado 32 bytes en hex = 64 chars)');
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

export function decrypt(blob: string): string {
  const [ivHex, tagHex, dataHex] = blob.split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('ciphertext con formato inválido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

// Cifra solo si hay valor; devuelve null para vacíos (evita guardar basura).
export function encryptOptional(plain?: string | null): string | null {
  return plain ? encrypt(plain) : null;
}

export function decryptOptional(blob?: string | null): string | null {
  return blob ? decrypt(blob) : null;
}
