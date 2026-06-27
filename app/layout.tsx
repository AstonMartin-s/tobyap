import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'TOBYAP — Tracking',
  description: 'Tracking de conversiones Kommo → Meta CAPI',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#0d0f12',
          color: '#e7e9ec',
        }}
      >
        {children}
      </body>
    </html>
  );
}
