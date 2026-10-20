import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { enIngles, fijarIdiomaDesde, ruta, rutaEnOtroIdioma } from './idioma';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav class="navegacion" [attr.aria-label]="en() ? 'Sections' : 'Vistas'">
      <a [routerLink]="ruta('que-es')" routerLinkActive="activa" ariaCurrentWhenActive="page">{{ en() ? 'What is it' : 'Qué es' }}</a>
      <a [routerLink]="ruta('produccion')" routerLinkActive="activa" ariaCurrentWhenActive="page">{{ en() ? 'Production' : 'Producción' }}</a>
      <a [routerLink]="ruta('subsuelo')" routerLinkActive="activa" ariaCurrentWhenActive="page">{{ en() ? 'Underground' : 'Subsuelo' }}</a>
      <a [routerLink]="ruta('rendimiento')" routerLinkActive="activa" ariaCurrentWhenActive="page">{{ en() ? 'Performance' : 'Rendimiento' }}</a>
      <a class="idioma" [href]="otroIdioma()" (click)="cambiarIdioma($event)"
        [attr.hreflang]="en() ? 'es' : 'en'" [attr.lang]="en() ? 'es' : 'en'"
        [attr.aria-label]="en() ? 'Ver en español' : 'View in English'">{{ en() ? 'ES' : 'EN' }}</a>
    </nav>
    <router-outlet />
  `,
})
export class App {
  protected readonly en = enIngles;
  protected readonly ruta = ruta;
  private readonly router = inject(Router);
  /** La misma página en el otro idioma. */
  protected readonly otroIdioma = signal(rutaEnOtroIdioma(typeof location === 'undefined' ? '/' : location.pathname + location.search));

  constructor() {
    // El idioma se fija al empezar cada navegación, antes de que se armen las vistas.
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) fijarIdiomaDesde(e.url);
      if (e instanceof NavigationEnd) this.otroIdioma.set(rutaEnOtroIdioma(e.urlAfterRedirects));
    });

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

  protected cambiarIdioma(evt: MouseEvent): void {
    // Con Ctrl/Cmd o la rueda abre en otra pestaña como cualquier link.
    if (evt.ctrlKey || evt.metaKey || evt.shiftKey || evt.button !== 0) return;
    evt.preventDefault();
    this.router.navigateByUrl(this.otroIdioma());
  }
}
