// Normalización de teléfonos para la lista de envío (send_list).
// El match se hace por SOLO DÍGITOS para tolerar diferencias de formato
// (+, espacios, guiones, paréntesis) entre lo que carga el admin y lo que
// consulta el CRM. No intenta "arreglar" prefijos nacionales (ej. el 9/15 de
// Argentina): eso es responsabilidad de quien normaliza el E.164 de origen.

// Clave de match: solo los dígitos del número.
export function phoneKey(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

// Forma de display en E.164 (+ y dígitos). Si ya trae +, se respeta el resto.
export function phoneE164(raw: string | null | undefined): string {
  const digits = phoneKey(raw);
  return digits ? `+${digits}` : '';
}

// Candidatos de match: el número tal cual + variante con/sin el "9" de móvil
// argentino (prefijo 54). Cubre que el origen mande "54XXXX" o "549XXXX" sin
// depender de la normalización exacta del otro lado. Para no-AR devuelve [key].
export function phoneCandidates(raw: string | null | undefined): string[] {
  const key = phoneKey(raw);
  if (!key) return [];
  const set = new Set<string>([key]);
  if (key.startsWith('54')) {
    const rest = key.slice(2);
    if (rest.startsWith('9')) {
      set.add('54' + rest.slice(1)); // saca el 9
    } else {
      set.add('549' + rest); // agrega el 9
    }
  }
  return [...set];
}
