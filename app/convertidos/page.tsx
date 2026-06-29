import { redirect } from 'next/navigation';

// Pestaña retirada: el convertido se dispara automáticamente por el webhook al
// pasar a Cargo$ (que también manda la conversión a Meta). Redirige a Reportes.
export default function ConvertidosPage() {
  redirect('/reportes');
}
