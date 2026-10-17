import { Component, ElementRef, OnDestroy, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatosService, formato } from '../datos';
import { AnioPerforacion, Fluido, calcularPerforacion, calcularRendimiento } from '../rendimiento-calculo';
import { TrayectoriasService } from '../trayectorias';

/** Rampa de un solo tono para los años: los más viejos tenues, los más nuevos brillantes. */
const RAMPA_ANIOS = ['#2f4f86', '#3a68ad', '#4a84d4', '#73a6ea', '#a9cbf7'];

interface Hover {
  x: number;
  y: number;
  titulo: string;
  lineas: string[];
}

@Component({
  selector: 'vm-rendimiento',
  imports: [RouterLink],
  templateUrl: './rendimiento.html',
  styleUrl: './rendimiento.css',
})
export class Rendimiento implements OnDestroy {
  protected readonly servicio = inject(DatosService);
  protected readonly f = formato;
  protected readonly fluido = signal<Fluido>('petroleo');
  protected readonly ancho = signal(720);
  protected readonly hover = signal<Hover | null>(null);
  protected readonly mesCurva = signal<number | null>(null);
  private readonly columna = viewChild<ElementRef<HTMLElement>>('columna');
  private observador?: ResizeObserver;

  private readonly trayectorias = inject(TrayectoriasService);

  constructor() {
    this.servicio.cargar();
    effect(() => {
      const d = this.servicio.datos();
      if (d) untracked(() => this.trayectorias.cargar(d));
    });
    afterNextRender(() => {
      this.observador = new ResizeObserver((e) => this.ancho.set(Math.max(300, Math.min(820, e[0].contentRect.width))));
      const el = this.columna()?.nativeElement ?? document.body;
      this.observador.observe(el);
    });
  }

  ngOnDestroy(): void {
    this.observador?.disconnect();
  }

  protected readonly r = computed(() => {
    const d = this.servicio.datos();
    return d ? calcularRendimiento(d, this.fluido()) : null;
  });

  /** Unidad del primer año: petróleo en miles de barriles, gas en millones de m³. */
  protected primerAnio(v: number): string {
    return this.fluido() === 'petroleo' ? `${formato.entero(v / 1000)} mil barriles` : `${formato.decimal(v / 1000)} millones de m³`;
  }
  protected primerAnioCorto(v: number): string {
    return this.fluido() === 'petroleo' ? formato.entero(v / 1000) : formato.decimal(v / 1000);
  }
  protected readonly unidadPrimerAnio = computed(() =>
    this.fluido() === 'petroleo' ? 'miles de barriles en el primer año' : 'millones de m³ en el primer año',
  );
  protected readonly unidadCaudal = computed(() =>
    this.fluido() === 'petroleo' ? 'barriles por día' : 'miles de m³ por día',
  );

  /** La frase principal: el primer año contra el último año comparable. */
  protected readonly titular = computed(() => {
    const r = this.r();
    if (!r || r.cohortes.length < 2) return null;
    const primero = r.cohortes[0];
    const ultimo = r.cohortes[r.cohortes.length - 1];
    // Primer año en que la mayoría de los pozos ya eran horizontales.
    const horizontal = r.cohortes.find((c) => c.horizontales >= 50) ?? null;
    return {
      primero,
      ultimo,
      horizontal: horizontal && horizontal.anio > primero.anio && horizontal.anio < ultimo.anio ? horizontal : null,
      vecesHorizontal: horizontal ? ultimo.mediana / Math.max(1, horizontal.mediana) : 0,
      veces: ultimo.mediana / Math.max(1, primero.mediana),
      tipo: this.fluido() === 'petroleo' ? 'de petróleo' : 'de gas',
    };
  });

  // ---------- Gráfico de cohortes (barras por año) ----------
  protected readonly alto = 260;
  protected readonly margen = { izq: 44, der: 8, arriba: 16, abajo: 40 };

  protected readonly barras = computed(() => {
    const r = this.r();
    if (!r) return null;
    const { izq, der, arriba, abajo } = this.margen;
    const w = this.ancho() - izq - der;
    const h = this.alto - arriba - abajo;
    const max = Math.max(...r.cohortes.map((c) => c.p75), 1);
    const paso = w / r.cohortes.length;
    const anchoBarra = Math.min(36, paso * 0.62);
    const y = (v: number) => arriba + h - (v / max) * h;
    const ticks = escalaTicks(max, 4).map((v) => ({ v, y: y(v), texto: this.primerAnioCorto(v) }));
    const mostrarAnio = (i: number) => paso >= 34 || i % 2 === 0 || i === r.cohortes.length - 1;
    return {
      ticks,
      base: arriba + h,
      barras: r.cohortes.map((c, i) => {
        const cx = izq + paso * i + paso / 2;
        return {
          c,
          cx,
          x: cx - anchoBarra / 2,
          ancho: anchoBarra,
          y: y(c.mediana),
          alto: Math.max(1, arriba + h - y(c.mediana)),
          y25: y(c.p25),
          y75: y(c.p75),
          etiqueta: mostrarAnio(i),
          zona: { x: izq + paso * i, ancho: paso },
        };
      }),
    };
  });

  /** Barra con las esquinas superiores redondeadas y la base recta sobre el eje. */
  protected barra(x: number, y: number, w: number, h: number): string {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  /** Posición vertical de un valor en el gráfico de curvas. */
  protected punto(v: number): number {
    const c = this.curvas();
    if (!c) return 0;
    const max = c.ticksY.length ? Math.max(...this.r()!.curvas.flatMap((x) => x.valores.filter((y): y is number => y !== null)), 1) : 1;
    const h = this.altoCurva - this.margen.arriba - this.margen.abajo;
    return this.margen.arriba + h - (v / max) * h;
  }

  protected hoverBarra(b: { c: { anio: number; mediana: number; p25: number; p75: number; n: number; horizontales: number }; cx: number; y: number }): void {
    this.hover.set({
      x: b.cx,
      y: b.y,
      titulo: `Pozos que arrancaron en ${b.c.anio}`,
      lineas: [
        `Mediana: ${this.primerAnio(b.c.mediana)}`,
        `La mitad está entre ${this.primerAnioCorto(b.c.p25)} y ${this.primerAnio(b.c.p75)}`,
        `${formato.entero(b.c.n)} pozos, ${formato.entero(b.c.horizontales)}% horizontales`,
      ],
    });
  }

  // ---------- Curvas de declino ----------
  protected readonly altoCurva = 280;

  protected readonly curvas = computed(() => {
    const r = this.r();
    if (!r || !r.curvas.length) return null;
    const { izq, der, arriba, abajo } = this.margen;
    const w = this.ancho() - izq - der - 52; // espacio a la derecha para las etiquetas directas
    const h = this.altoCurva - arriba - abajo;
    const meses = r.curvas[0].valores.length;
    const max = Math.max(...r.curvas.flatMap((c) => c.valores.filter((v): v is number => v !== null)), 1);
    const x = (k: number) => izq + (k / (meses - 1)) * w;
    const y = (v: number) => arriba + h - (v / max) * h;
    const colores = r.curvas.map((_, i) => RAMPA_ANIOS[Math.round((i * (RAMPA_ANIOS.length - 1)) / Math.max(1, r.curvas.length - 1))]);
    const lineas = r.curvas.map((c, i) => {
      let path = '';
      let ultimo: { x: number; y: number } | null = null;
      c.valores.forEach((v, k) => {
        if (v === null) return;
        const px = x(k);
        const py = y(v);
        path += `${path ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
        ultimo = { x: px, y: py };
      });
      return { anio: c.anio, color: colores[i], path, ultimo: ultimo as { x: number; y: number } | null, valores: c.valores };
    });
    // Etiquetas directas sin superponerse.
    const etiquetas = lineas
      .filter((l) => l.ultimo)
      .map((l) => ({ anio: l.anio, color: l.color, x: l.ultimo!.x + 8, y: l.ultimo!.y }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < etiquetas.length; i++) {
      if (etiquetas[i].y - etiquetas[i - 1].y < 14) etiquetas[i].y = etiquetas[i - 1].y + 14;
    }
    return {
      lineas,
      etiquetas,
      ticksY: escalaTicks(max, 4).map((v) => ({ v, y: y(v), texto: formato.entero(v) })),
      ticksX: [0, 6, 12, 18, 24, 30].filter((k) => k < meses).map((k) => ({ k, x: x(k) })),
      base: arriba + h,
      x,
      meses,
      izq,
      derecha: izq + w,
    };
  });

  protected moverCurva(evt: PointerEvent): void {
    const c = this.curvas();
    if (!c) return;
    const svg = evt.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * this.ancho();
    const k = Math.round(((px - c.izq) / (c.derecha - c.izq)) * (c.meses - 1));
    if (k < 0 || k >= c.meses) {
      this.mesCurva.set(null);
      this.hover.set(null);
      return;
    }
    this.mesCurva.set(k);
    const lineas = c.lineas
      .filter((l) => l.valores[k] !== null)
      .map((l) => `${l.anio}: ${formato.entero(l.valores[k]!)} ${this.fluido() === 'petroleo' ? 'bbl/d' : 'mil m³/d'}`);
    this.hover.set({
      x: c.x(k),
      y: this.margen.arriba,
      titulo: k === 0 ? 'Primer mes' : `Mes ${k + 1} desde el arranque`,
      lineas: lineas.length ? lineas : ['Sin pozos suficientes'],
    });
  }

  protected salirCurva(): void {
    this.mesCurva.set(null);
    this.hover.set(null);
  }

  // ---------- Cómo cambiaron los pozos ----------
  protected readonly perforacion = computed(() => {
    const d = this.servicio.datos();
    return d ? calcularPerforacion(d, this.trayectorias.datos()) : [];
  });

  /** Primer y último año con dato, para la frase del bloque. */
  protected readonly cambioPozos = computed(() => {
    const p = this.perforacion();
    const ambos = p.filter((a) => a.rama !== null && a.dias !== null);
    if (ambos.length < 2) return null;
    const a0 = ambos[0], a1 = ambos[ambos.length - 1];
    const cambioDias = (a1.dias! - a0.dias!) / a0.dias!;
    const dias = ambos.map((a) => a.dias!);
    return {
      a0,
      a1,
      diasParecidos: Math.abs(cambioDias) < 0.25,
      cambioRama: a1.rama! / a0.rama!,
      diasMin: Math.min(...dias),
      diasMax: Math.max(...dias),
    };
  });

  protected readonly altoMini = 200;
  protected readonly anchoMini = computed(() => (this.ancho() >= 640 ? Math.floor((this.ancho() - 32) / 2) : this.ancho()));

  /** Barras chicas para una serie por año (small multiples, misma escala de años). */
  protected mini(serie: 'rama' | 'dias') {
    const datos = this.perforacion().filter((a) => a[serie] !== null);
    if (!datos.length) return null;
    const izq = 40, der = 6, arriba = 12, abajo = 30;
    const w = this.anchoMini() - izq - der;
    const h = this.altoMini - arriba - abajo;
    const max = Math.max(...datos.map((a) => a[serie]!), 1);
    const paso = w / datos.length;
    const ancho = Math.min(22, paso * 0.62);
    const y = (v: number) => arriba + h - (v / max) * h;
    return {
      base: arriba + h,
      izq,
      der: izq + w,
      ticks: escalaTicks(max, 3).map((v) => ({ v, y: y(v), texto: formato.entero(v) })),
      barras: datos.map((a, i) => {
        const cx = izq + paso * i + paso / 2;
        const v = a[serie]!;
        return {
          a,
          cx,
          x: cx - ancho / 2,
          ancho,
          y: y(v),
          alto: Math.max(1, arriba + h - y(v)),
          etiqueta: i === 0 || i === datos.length - 1 || (paso >= 30 ? true : i % 3 === 0),
          zona: { x: izq + paso * i, ancho: paso },
        };
      }),
    };
  }

  protected readonly hoverMini = signal<{ serie: string; x: number; y: number; lineas: string[]; titulo: string } | null>(null);

  protected marcarMini(serie: 'rama' | 'dias', b: { a: AnioPerforacion; cx: number; y: number }): void {
    this.hoverMini.set({
      serie,
      x: b.cx,
      y: b.y,
      titulo: `Pozos que empezaron a perforarse en ${b.a.anio}`,
      lineas:
        serie === 'rama'
          ? [`Rama típica: ${formato.entero(b.a.rama!)} m`, `${formato.entero(b.a.nRama)} pozos con trayectoria`]
          : [`Perforación típica: ${formato.entero(b.a.dias!)} días`, `${formato.entero(b.a.n)} pozos horizontales`],
    });
  }

  // ---------- Empresas ----------
  protected readonly empresas = computed(() => {
    const r = this.r();
    if (!r) return [];
    const max = Math.max(...r.empresas.map((e) => e.mediana), 1);
    return r.empresas.map((e) => ({ ...e, ancho: (e.mediana / max) * 100 }));
  });
}

/** Marcas "redondas" para un eje que va de 0 a max. */
function escalaTicks(max: number, cantidad: number): number[] {
  const crudo = max / cantidad;
  const mag = 10 ** Math.floor(Math.log10(crudo));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= crudo) ?? crudo;
  const salida: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += paso) salida.push(v);
  return salida;
}
