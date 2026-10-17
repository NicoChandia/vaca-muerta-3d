import { Component, computed, input, output, signal } from '@angular/core';
import { Datos, simplificar } from './datos';

export type Resultado =
  | { tipo: 'pozo'; indice: number; texto: string; detalle: string; lon: number; lat: number }
  | { tipo: 'area'; indice: number; texto: string; detalle: string; lon: number; lat: number };

const MAXIMO = 8;

/** Buscador de pozos y áreas con la navegación de teclado de un combobox. */
@Component({
  selector: 'vm-buscador',
  template: `
    <div class="caja" [class.abierta]="abierto() && resultados().length > 0">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input
        type="search"
        role="combobox"
        aria-label="Buscar un pozo o un área"
        aria-autocomplete="list"
        aria-controls="resultados-busqueda"
        [attr.aria-expanded]="abierto() && resultados().length > 0"
        [attr.aria-activedescendant]="activo() >= 0 ? 'resultado-' + activo() : null"
        placeholder="Buscar pozo o área"
        autocomplete="off"
        spellcheck="false"
        [value]="texto()"
        (input)="escribir($event)"
        (focus)="abierto.set(true)"
        (blur)="cerrarLuego()"
        (keydown)="teclado($event)"
      />
    </div>
    @if (abierto() && texto().trim().length >= 2) {
      <ul class="lista" id="resultados-busqueda" role="listbox" aria-label="Resultados">
        @for (r of resultados(); track r.tipo + r.indice; let i = $index) {
          <li
            role="option"
            [id]="'resultado-' + i"
            [attr.aria-selected]="i === activo()"
            [class.activo]="i === activo()"
            (mousedown)="$event.preventDefault()"
            (click)="elegirResultado(r)"
          >
            <span class="texto">{{ r.texto }}</span>
            <span class="detalle">{{ r.detalle }}</span>
          </li>
        } @empty {
          <li class="vacio" role="option" aria-disabled="true">No hay pozos ni áreas con ese nombre.</li>
        }
      </ul>
    }
  `,
  styles: `
    :host { position: relative; display: block; }
    .caja {
      display: flex; align-items: center; gap: 8px; padding: 0 12px; min-height: 40px;
      background: rgba(0, 0, 0, 0.22); border: 1px solid var(--linea); border-radius: 10px;
      color: var(--tinta-suave);
    }
    .caja:focus-within { border-color: var(--barda); color: var(--tinta); }
    input {
      flex: 1; min-width: 0; background: none; border: 0; outline: none; color: var(--tinta);
      font: inherit; padding: 8px 0;
    }
    input::placeholder { color: var(--tinta-suave); }
    input::-webkit-search-cancel-button { filter: invert(0.8); }
    .lista {
      position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 6px);
      list-style: none; margin: 0; padding: 6px; max-height: 320px; overflow: auto;
      background: var(--panel-solido); border: 1px solid var(--linea); border-radius: 12px;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
    }
    li { display: grid; gap: 1px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
    li.activo, li:hover { background: rgba(201, 182, 150, 0.14); }
    .texto { overflow-wrap: anywhere; }
    .detalle { font-size: 12px; color: var(--tinta-suave); }
    .vacio { color: var(--tinta-suave); cursor: default; }
    .vacio:hover { background: none; }
  `,
})
export class Buscador {
  readonly datos = input.required<Datos>();
  readonly elegir = output<Resultado>();

  protected readonly texto = signal('');
  protected readonly abierto = signal(false);
  protected readonly activo = signal(-1);

  /** Centro de cada área: promedio de sus pozos. */
  private readonly centrosArea = computed(() => {
    const d = this.datos();
    const suma = d.meta.areas.map(() => ({ lon: 0, lat: 0, n: 0 }));
    for (const p of d.pozos) {
      const s = suma[p.area];
      s.lon += p.lon;
      s.lat += p.lat;
      s.n++;
    }
    return suma.map((s) => (s.n ? { lon: s.lon / s.n, lat: s.lat / s.n, n: s.n } : null));
  });

  private readonly indicePozos = computed(() => this.datos().pozos.map((p) => simplificar(p.nombre)));

  protected readonly resultados = computed<Resultado[]>(() => {
    const q = simplificar(this.texto().trim());
    if (q.length < 2) return [];
    const d = this.datos();
    const salida: Resultado[] = [];
    d.meta.areas.forEach((a, i) => {
      const c = this.centrosArea()[i];
      if (c && simplificar(a).includes(q)) {
        salida.push({ tipo: 'area', indice: i, texto: a, detalle: `Área, ${c.n.toLocaleString('es-AR')} pozos`, lon: c.lon, lat: c.lat });
      }
    });
    const nombres = this.indicePozos();
    for (let i = 0; i < nombres.length && salida.length < MAXIMO * 2; i++) {
      if (nombres[i].includes(q)) {
        const p = d.pozos[i];
        salida.push({
          tipo: 'pozo',
          indice: i,
          texto: p.nombre,
          detalle: `${d.meta.empresas[p.empresa]?.nombre}, ${d.meta.areas[p.area]}`,
          lon: p.lon,
          lat: p.lat,
        });
      }
    }
    // Primero los que empiezan con lo escrito.
    const empieza = (r: Resultado) => (simplificar(r.texto).startsWith(q) ? 0 : 1);
    return salida.sort((a, b) => empieza(a) - empieza(b)).slice(0, MAXIMO);
  });

  protected escribir(evt: Event): void {
    this.texto.set((evt.target as HTMLInputElement).value);
    this.abierto.set(true);
    this.activo.set(-1);
  }

  protected teclado(evt: KeyboardEvent): void {
    const n = this.resultados().length;
    if (evt.key === 'ArrowDown' && n) {
      evt.preventDefault();
      this.abierto.set(true);
      this.activo.set((this.activo() + 1) % n);
    } else if (evt.key === 'ArrowUp' && n) {
      evt.preventDefault();
      this.activo.set((this.activo() - 1 + n) % n);
    } else if (evt.key === 'Enter') {
      const r = this.resultados()[Math.max(0, this.activo())];
      if (r) {
        evt.preventDefault();
        this.elegirResultado(r);
      }
    } else if (evt.key === 'Escape') {
      this.abierto.set(false);
    }
  }

  protected elegirResultado(r: Resultado): void {
    this.texto.set(r.texto);
    this.abierto.set(false);
    this.activo.set(-1);
    this.elegir.emit(r);
  }

  protected cerrarLuego(): void {
    setTimeout(() => this.abierto.set(false), 120);
  }
}
