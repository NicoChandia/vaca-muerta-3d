import { computed, signal } from '@angular/core';

/**
 * Idioma de la página. Sale de la dirección: todo lo que empieza con /en está en inglés.
 * Cada sección tiene su dirección en cada idioma, así Google indexa las dos versiones.
 */
export type Idioma = 'es' | 'en';
export type Seccion = 'que-es' | 'produccion' | 'subsuelo' | 'rendimiento';

export const RUTAS: Record<Seccion, Record<Idioma, string>> = {
  'que-es': { es: '/que-es', en: '/en/what-is' },
  produccion: { es: '/produccion', en: '/en/production' },
  subsuelo: { es: '/subsuelo', en: '/en/underground' },
  rendimiento: { es: '/rendimiento', en: '/en/performance' },
};

/** Nombre de la sección en la dirección en inglés -> sección. */
export const SECCION_EN: Record<string, Seccion> = {
  'what-is': 'que-es',
  production: 'produccion',
  underground: 'subsuelo',
  performance: 'rendimiento',
};

const desdeRuta = (url: string): Idioma => (/^\/en(\/|\?|$)/.test(url) ? 'en' : 'es');

const actual = signal<Idioma>(typeof location === 'undefined' ? 'es' : desdeRuta(location.pathname));

/** El idioma actual (señal: las vistas se actualizan solas cuando cambia). */
export const idioma = actual.asReadonly();
export const enIngles = computed(() => actual() === 'en');

/** Se llama al empezar cada navegación, antes de que se armen las vistas. */
export function fijarIdiomaDesde(url: string): void {
  const nuevo = desdeRuta(url);
  actual.set(nuevo);
  if (typeof document !== 'undefined') document.documentElement.lang = nuevo === 'en' ? 'en' : 'es-AR';
}

/** Dirección de una sección en el idioma actual (o en el indicado). */
export function ruta(seccion: Seccion, i: Idioma = actual()): string {
  return RUTAS[seccion][i];
}

/** La misma página en el otro idioma, conservando lo que va después de "?" (por ejemplo ?pozo=). */
export function rutaEnOtroIdioma(url: string): string {
  const [camino, consulta] = url.split('?');
  const otro: Idioma = desdeRuta(camino) === 'en' ? 'es' : 'en';
  const seccion = (Object.keys(RUTAS) as Seccion[]).find((s) => RUTAS[s].es === camino || RUTAS[s].en === camino) ?? 'produccion';
  return RUTAS[seccion][otro] + (consulta ? `?${consulta}` : '');
}

/** Elige el texto según el idioma: tr('Hola', 'Hello'). */
export function tr(es: string, en: string): string {
  return actual() === 'en' ? en : es;
}

/** Configuración regional para números y fechas. */
export const locale = () => (actual() === 'en' ? 'en-US' : 'es-AR');
