import { Routes, UrlSegment } from '@angular/router';
import { Escena } from './vistas/escena';
import { Rendimiento } from './vistas/rendimiento';
import { Recorrido } from './vistas/recorrido';

/**
 * Producción y Subsuelo usan la misma ruta, así el mapa no se vuelve a crear al pasar de una a otra.
 * En inglés las direcciones son /en/production y /en/underground; la vista recibe igual
 * "produccion" o "subsuelo".
 */
function escena(segmentos: UrlSegment[]) {
  if (segmentos.length === 1 && ['produccion', 'subsuelo'].includes(segmentos[0].path)) {
    return { consumed: segmentos, posParams: { seccion: segmentos[0] } };
  }
  return null;
}

function escenaEn(segmentos: UrlSegment[]) {
  const equivalente: Record<string, string> = { production: 'produccion', underground: 'subsuelo' };
  const seccion = segmentos.length === 1 ? equivalente[segmentos[0].path] : undefined;
  return seccion ? { consumed: segmentos, posParams: { seccion: new UrlSegment(seccion, {}) } } : null;
}

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'produccion' },
  { path: 'que-es', component: Recorrido },
  { matcher: escena, component: Escena },
  { path: 'rendimiento', component: Rendimiento },
  {
    path: 'en',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'production' },
      { path: 'what-is', component: Recorrido },
      { matcher: escenaEn, component: Escena },
      { path: 'performance', component: Rendimiento },
      { path: '**', redirectTo: 'production' },
    ],
  },
  { path: '**', redirectTo: 'produccion' },
];
