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
export class App {}
