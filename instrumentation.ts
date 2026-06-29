// Solo importamos la lógica (que usa módulos de Node) cuando el runtime es Node.
// Así Next NO intenta bundlear node:crypto para el runtime edge.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
