import { Routes, UrlSegment } from '@angular/router';
import { Escena } from './vistas/escena';
import { Rendimiento } from './vistas/rendimiento';
import { Recorrido } from './vistas/recorrido';

/** Producción y Subsuelo usan la misma ruta, así el mapa no se vuelve a crear al pasar de una a otra. */
function escena(segmentos: UrlSegment[]) {
  if (segmentos.length === 1 && ['produccion', 'subsuelo'].includes(segmentos[0].path)) {
    return { consumed: segmentos, posParams: { seccion: segmentos[0] } };
  }
  return null;
}

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'produccion' },
  { path: 'que-es', component: Recorrido },
  { matcher: escena, component: Escena },
  { path: 'rendimiento', component: Rendimiento },
  { path: '**', redirectTo: 'produccion' },
];
