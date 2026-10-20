/**
 * Baja un archivo binario de datos. Primero prueba la versión comprimida (.gz, unas 4 veces
 * más liviana) y la descomprime en el navegador; si no está o el navegador no puede
 * descomprimir, baja la versión sin comprimir. Devuelve null si no existe ninguna.
 */
export async function bajarBinario(url: string): Promise<ArrayBuffer | null> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const r = await fetch(url + '.gz');
      if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) {
        const datos = await r.arrayBuffer();
        const b = new Uint8Array(datos, 0, 2);
        // Algunos servidores ya lo entregan descomprimido: solo se descomprime si empieza
        // con la firma de gzip (1f 8b).
        if (b[0] !== 0x1f || b[1] !== 0x8b) return datos;
        const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('gzip'));
        return await new Response(flujo).arrayBuffer();
      }
    } catch {
      // Si algo falla, se usa la versión sin comprimir.
    }
  }
  const r = await fetch(url);
  if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return null;
  return r.arrayBuffer();
}
