import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Datos, MEDIDA_INFO, Medida, Momento, nombreMes } from './datos';

interface Capa {
  empresa: number;
  color: string;
  path: string;
}

const ALTO = 112;
const MARGEN = { izq: 16, der: 16, arriba: 8, abajo: 22 };

/**
 * Línea de tiempo con forma de estratos: la producción de cada empresa se apila
 * como capas geológicas. Arrastrar o usar las flechas cambia el mes del mapa.
 */
@Component({
  selector: 'vm-estratos',
  template: `
    <div class="contenedor" #contenedor>
      <svg
        [attr.width]="ancho()"
        [attr.height]="alto"
        [attr.viewBox]="'0 0 ' + ancho() + ' ' + alto"
        role="slider"
        tabindex="0"
        aria-label="Mes del mapa"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="datos().meta.meses.length - 1"
        [attr.aria-valuenow]="mes()"
        [attr.aria-valuetext]="textoMes()"
        (pointerdown)="empezarArrastre($event)"
        (pointermove)="mover($event)"
        (pointerup)="soltar($event)"
        (pointerleave)="hover.set(null)"
        (keydown)="teclado($event)"
      >
        @for (c of capas(); track c.empresa) {
          <path
            [attr.d]="c.path"
            [attr.fill]="c.color"
            [attr.fill-opacity]="empresaResaltada() === null || empresaResaltada() === c.empresa ? 0.92 : 0.18"
            stroke="var(--fondo)"
            stroke-width="1"
          />
        }
        <!-- Lo que todavía no pasó queda velado -->
        <rect
          [attr.x]="x(mes())"
          [attr.y]="0"
          [attr.width]="ancho() - x(mes())"
          [attr.height]="alto - margen.abajo"
          fill="var(--fondo)"
          fill-opacity="0.62"
        />
        @for (t of marcasAnio(); track t.mes) {
          <line [attr.x1]="x(t.mes)" [attr.x2]="x(t.mes)" [attr.y1]="alto - margen.abajo" [attr.y2]="alto - margen.abajo + 4" class="marca" />
          <text [attr.x]="x(t.mes)" [attr.y]="alto - 6" class="anio">{{ t.anio }}</text>
        }
        @if (hover() !== null) {
          <line [attr.x1]="x(hover()!)" [attr.x2]="x(hover()!)" y1="0" [attr.y2]="alto - margen.abajo" class="cruz" />
        }
        <line [attr.x1]="x(mes())" [attr.x2]="x(mes())" y1="0" [attr.y2]="alto - margen.abajo" class="cursor" />
        <circle [attr.cx]="x(mes())" [attr.cy]="alto - margen.abajo" r="5" class="perilla" />
      </svg>
      @for (m of marcasMomento(); track m.mes) {
        <button
          type="button"
          class="momento"
          [class.actual]="m.indice === mes()"
          [style.left.px]="x(m.indice)"
          [attr.aria-label]="m.titulo + ', ' + m.fecha"
          [title]="m.titulo"
          (click)="cambiarMes.emit(m.indice)"
        ></button>
      }
      @if (hover() !== null) {
        <div class="globo" [style.left.px]="posGlobo()">
          <strong>{{ textoHover() }}</strong>
          <span>{{ valorHover() }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .contenedor { position: relative; width: 100%; }
    svg { display: block; touch-action: none; cursor: ew-resize; border-radius: 8px; }
    svg:focus-visible { outline: 2px solid var(--barda-clara); outline-offset: 3px; }
    .anio { fill: var(--tinta-suave); font-size: 11px; text-anchor: middle; font-variant-numeric: tabular-nums; }
    .marca { stroke: var(--linea); }
    .cursor { stroke: var(--tinta); stroke-width: 2; }
    .cruz { stroke: var(--tinta-suave); stroke-dasharray: 3 3; }
    .perilla { fill: var(--tinta); stroke: var(--fondo); stroke-width: 2; }
    .globo {
      position: absolute; bottom: calc(100% + 6px); transform: translateX(-50%);
      background: var(--panel-solido); border: 1px solid var(--linea); border-radius: 8px;
      padding: 6px 10px; font-size: 12px; white-space: nowrap; pointer-events: none;
      display: grid; gap: 1px;
    }
    .globo span { color: var(--tinta-suave); font-variant-numeric: tabular-nums; }
    /* Marcas de momentos clave: rombos sobre el borde superior, con área de toque amplia. */
    .momento {
      position: absolute; top: -10px; width: 24px; height: 24px; margin-left: -12px;
      border: 0; padding: 0; background: none; cursor: pointer;
    }
    .momento::before {
      content: ''; position: absolute; left: 7px; top: 7px; width: 9px; height: 9px;
      background: var(--fondo); border: 2px solid var(--barda-clara); transform: rotate(45deg);
      transition: background 0.2s;
    }
    .momento:hover::before, .momento.actual::before { background: var(--barda-clara); }
    .momento:focus-visible { outline: 2px solid var(--barda-clara); outline-offset: 0; border-radius: 6px; }
  `,
})
export class Estratos implements OnDestroy {
  readonly datos = input.required<Datos>();
  readonly mes = input.required<number>();
  readonly medida = input<Medida>('petroleo');
  readonly empresaResaltada = input<number | null>(null);
  readonly momentos = input<Momento[]>([]);
  readonly cambiarMes = output<number>();

  protected readonly alto = ALTO;
  protected readonly margen = MARGEN;
  protected readonly ancho = signal(600);
  protected readonly hover = signal<number | null>(null);
  private readonly contenedor = viewChild.required<ElementRef<HTMLDivElement>>('contenedor');
  private observador?: ResizeObserver;
  private arrastrando = false;

  constructor() {
    afterNextRender(() => {
      const el = this.contenedor().nativeElement;
      this.ancho.set(Math.max(240, el.clientWidth));
      this.observador = new ResizeObserver(([e]) => this.ancho.set(Math.max(240, e.contentRect.width)));
      this.observador.observe(el);
    });
  }

  ngOnDestroy(): void {
    this.observador?.disconnect();
  }

  private readonly series = computed(() => {
    const t = this.datos().totales;
    return t.porEmpresa[this.medida()];
  });

  private readonly maximo = computed(() => {
    const t = this.datos().totales;
    const tot = t.total[this.medida()];
    return Math.max(...tot) || 1;
  });

  protected readonly capas = computed<Capa[]>(() => {
    const series = this.series();
    const n = this.datos().meta.meses.length;
    const base = new Float64Array(n);
    const max = this.maximo();
    const y = (v: number) => MARGEN.arriba + (1 - v / max) * (ALTO - MARGEN.arriba - MARGEN.abajo);
    // Las empresas más grandes abajo, como el estrato más profundo.
    return series.map((s, empresa) => {
      const arriba: string[] = [];
      const abajo: string[] = [];
      for (let m = 0; m < n; m++) {
        const b = base[m];
        const t = b + s[m];
        arriba.push(`${this.x(m).toFixed(1)},${y(t).toFixed(1)}`);
        abajo.push(`${this.x(m).toFixed(1)},${y(b).toFixed(1)}`);
        base[m] = t;
      }
      return {
        empresa,
        color: this.datos().meta.empresas[empresa].color,
        path: `M${arriba.join('L')}L${abajo.reverse().join('L')}Z`,
      };
    });
  });

  protected readonly marcasAnio = computed(() => {
    const meses = this.datos().meta.meses;
    const paso = this.ancho() < 520 ? 3 : this.ancho() < 820 ? 2 : 1;
    const marcas: { mes: number; anio: string }[] = [];
    meses.forEach((m, i) => {
      if (m.endsWith('-01')) {
        const anio = Number(m.slice(0, 4));
        if (anio % paso === 0) marcas.push({ mes: i, anio: String(anio) });
      }
    });
    return marcas;
  });

  protected readonly marcasMomento = computed(() => {
    const meses = this.datos().meta.meses;
    return this.momentos()
      .map((m) => ({ ...m, indice: meses.indexOf(m.mes), fecha: nombreMes(m.mes) }))
      .filter((m) => m.indice >= 0);
  });

  protected readonly textoMes = computed(() => nombreMes(this.datos().meta.meses[this.mes()]));
  protected readonly textoHover = computed(() => {
    const h = this.hover();
    return h === null ? '' : nombreMes(this.datos().meta.meses[h]);
  });
  protected readonly valorHover = computed(() => {
    const h = this.hover();
    if (h === null) return '';
    const t = this.datos().totales;
    return MEDIDA_INFO[this.medida()].corto(t.total[this.medida()][h]);
  });
  protected readonly posGlobo = computed(() => {
    const h = this.hover() ?? 0;
    return Math.min(this.ancho() - 80, Math.max(80, this.x(h)));
  });

  x(m: number): number {
    const n = this.datos().meta.meses.length;
    return MARGEN.izq + (m / Math.max(1, n - 1)) * (this.ancho() - MARGEN.izq - MARGEN.der);
  }

  private mesDesdeX(evt: PointerEvent): number {
    const r = (evt.currentTarget as SVGElement).getBoundingClientRect();
    const n = this.datos().meta.meses.length;
    const f = (evt.clientX - r.left - MARGEN.izq) / (r.width - MARGEN.izq - MARGEN.der);
    return Math.round(Math.min(1, Math.max(0, f)) * (n - 1));
  }

  protected empezarArrastre(evt: PointerEvent): void {
    this.arrastrando = true;
    (evt.currentTarget as SVGElement).setPointerCapture(evt.pointerId);
    this.cambiarMes.emit(this.mesDesdeX(evt));
  }

  protected mover(evt: PointerEvent): void {
    const m = this.mesDesdeX(evt);
    this.hover.set(evt.pointerType === 'mouse' ? m : null);
    if (this.arrastrando) this.cambiarMes.emit(m);
  }

  protected soltar(evt: PointerEvent): void {
    this.arrastrando = false;
    (evt.currentTarget as SVGElement).releasePointerCapture(evt.pointerId);
  }

  protected teclado(evt: KeyboardEvent): void {
    const n = this.datos().meta.meses.length;
    const pasos: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, PageDown: -12, PageUp: 12 };
    if (evt.key in pasos) {
      evt.preventDefault();
      this.cambiarMes.emit(Math.min(n - 1, Math.max(0, this.mes() + pasos[evt.key])));
    } else if (evt.key === 'Home') {
      evt.preventDefault();
      this.cambiarMes.emit(0);
    } else if (evt.key === 'End') {
      evt.preventDefault();
      this.cambiarMes.emit(n - 1);
    }
  }
}
