import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav class="navegacion" aria-label="Vistas">
      <a routerLink="/que-es" routerLinkActive="activa" ariaCurrentWhenActive="page">Qué es</a>
      <a routerLink="/produccion" routerLinkActive="activa" ariaCurrentWhenActive="page" queryParamsHandling="">Producción</a>
      <a routerLink="/subsuelo" routerLinkActive="activa" ariaCurrentWhenActive="page">Subsuelo</a>
      <a routerLink="/rendimiento" routerLinkActive="activa" ariaCurrentWhenActive="page">Rendimiento</a>
    </nav>
    <router-outlet />
  `,
})
export class App {
  constructor() {
    // Si la pestaña vuelve después de mucho tiempo (el celular la congeló o el navegador la
    // restauró de su caché), se recarga para arrancar de cero con los datos al día.
    const LIMITE = 30 * 60 * 1000;
    let ocultaDesde = 0;
    const volver = () => {
      if (ocultaDesde && Date.now() - ocultaDesde > LIMITE) location.reload();
      ocultaDesde = 0;
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ocultaDesde = Date.now();
      else volver();
    });
    window.addEventListener('pagehide', () => (ocultaDesde = Date.now()));
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) volver();
    });
  }
}
