/**
 * DEPRECADO — no borrar filas para resetear stats.
 *
 * Los reportes excluyen campaña "Test" en lib/reports.ts (filas quedan en DB,
 * contador en 0). Panel KPIs también excluyen campaign=Test.
 *
 * Si necesitás ocultar chats de prueba sin borrar: archivar desde el panel.
 */
console.error('Este script ya no borra datos. Los reportes excluyen campaña Test automáticamente.');
console.error('Ver lib/reports.ts → notTestCampaign()');
process.exit(1);
