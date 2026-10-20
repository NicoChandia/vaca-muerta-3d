import { Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { MapViewState } from '@deck.gl/core';
import { DatosService, formato } from '../datos';
import { EXAGERACION_VERTICAL, Mapa3d, Vista } from '../mapa-3d';
import { TrayectoriasService } from '../trayectorias';
import { calcularRendimiento } from '../rendimiento-calculo';
import { Seo } from '../seo';
import { enIngles, ruta } from '../idioma';
import { textoFuente } from '../datos';

interface Paso {
  titulo: string;
  tituloEn: string;
  vista: Vista;
  camara: MapViewState;
}

const PASOS: Paso[] = [
  { tituloEn: 'A rock 3 kilometers down', titulo: 'Una roca a 3 kilómetros de profundidad', vista: 'subsuelo', camara: { longitude: -68.85, latitude: -38.46, zoom: 9.35, pitch: 74, bearing: -18 } },
  { tituloEn: 'Wells that drop and turn', titulo: 'Pozos que bajan y doblan', vista: 'subsuelo', camara: { longitude: -68.9, latitude: -38.4, zoom: 11.6, pitch: 62, bearing: -30 } },
  { tituloEn: 'Fracturing the rock', titulo: 'Fracturar la roca', vista: 'subsuelo', camara: { longitude: -68.9, latitude: -38.4, zoom: 13.3, pitch: 58, bearing: 10 } },
  { tituloEn: 'A lot at first, less later', titulo: 'Mucho al principio, menos después', vista: 'superficie', camara: { longitude: -68.88, latitude: -38.36, zoom: 9.2, pitch: 55, bearing: -22 } },
  { tituloEn: 'That is why drilling never stops', titulo: 'Por eso nunca se deja de perforar', vista: 'superficie', camara: { longitude: -68.88, latitude: -38.36, zoom: 8.6, pitch: 50, bearing: -10 } },
  { tituloEn: 'Now, explore', titulo: 'Ahora, explorá', vista: 'superficie', camara: { longitude: -68.86, latitude: -38.3, zoom: 8.3, pitch: 45, bearing: -22 } },
];

/** Recorrido de entrada: explica Vaca Muerta en seis pasos sobre el mismo mapa 3D. */
@Component({
  selector: 'vm-recorrido',
  imports: [Mapa3d, RouterLink],
  templateUrl: './recorrido.html',
  styleUrl: './recorrido.css',
  host: { '(document:keydown)': 'teclado($event)' },
})
export class Recorrido implements OnDestroy {
  protected readonly servicio = inject(DatosService);
  protected readonly trayectorias = inject(TrayectoriasService);
  protected readonly f = formato;
  protected readonly pasos = PASOS;
  protected readonly en = enIngles;
  protected readonly ruta = ruta;
  protected readonly fuente = textoFuente;
  protected readonly paso = signal(0);
  protected readonly mes = signal(0);
  private animacion?: ReturnType<typeof setInterval>;

  constructor() {
    inject(Seo).aplicar('que-es');
    window.addEventListener('resize', this.alRedimensionar);
    this.servicio.cargar();
    effect(() => {
      const d = this.servicio.datos();
      if (!d) return;
      untracked(() => {
        this.trayectorias.cargar(d);
        this.mes.set(d.meta.meses.length - 1);
      });
    });
    // En el paso 5 la línea de tiempo corre sola desde 2011.
    effect(() => {
      const p = this.paso();
      const d = this.servicio.datos();
      untracked(() => {
        clearInterval(this.animacion);
        if (!d) return;
        const ultimo = d.meta.meses.length - 1;
        if (p !== 4 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
          this.mes.set(ultimo);
          return;
        }
        this.mes.set(0);
        this.animacion = setInterval(() => {
          if (this.mes() >= ultimo) clearInterval(this.animacion);
          else this.mes.set(this.mes() + 1);
        }, 70);
      });
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.animacion);
    window.removeEventListener('resize', this.alRedimensionar);
  }

  protected readonly actual = computed(() => PASOS[this.paso()]);
  protected readonly tituloActual = computed(() => (this.en() ? this.actual().tituloEn : this.actual().titulo));

  /** El pozo que se muestra en el paso 2: el más productivo con trayectoria publicada. */
  protected readonly pozoEjemplo = computed(() => {
    const d = this.servicio.datos();
    const t = this.trayectorias.datos();
    if (!d || !t) return null;
    const r = calcularRendimiento(d, 'petroleo');
    const destacado = r.destacados.find((x) => t.porPozo.has(x.indice));
    const tr = destacado ? t.porPozo.get(destacado.indice)! : [...t.porPozo.values()].sort((a, b) => b.rama - a.rama)[0];
    const fin = tr.camino[tr.camino.length - 1];
    const inicio = tr.camino[0];
    // Rumbo de la rama (desde el norte, en grados): la cámara la mira de costado.
    const rama = tr.camino.filter(([, , h]) => h <= -tr.profundidad + 1);
    const a = rama[0] ?? inicio;
    const dx = (fin[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
    const dy = fin[1] - a[1];
    const rumbo = (Math.atan2(dx, dy) * 180) / Math.PI;
    const medio = rama[Math.floor(rama.length / 2)] ?? fin;
    return { tr, boca: [inicio[0], inicio[1]] as [number, number], medio: [medio[0], medio[1]] as [number, number], rumbo };
  });

  /** Caída típica del primer año, con la cohorte más reciente que tenga 12 meses. */
  protected readonly declino = computed(() => {
    const d = this.servicio.datos();
    if (!d) return null;
    const r = calcularRendimiento(d, 'petroleo');
    const curva = [...r.curvas].reverse().find((c) => c.valores[11] !== null && c.valores[11] !== undefined);
    if (!curva) return null;
    const v = curva.valores.slice(0, 24).map((x) => x ?? null);
    const pico = Math.max(...v.slice(0, 4).filter((x): x is number => x !== null));
    const alAnio = v[11]!;
    const max = Math.max(...v.filter((x): x is number => x !== null));
    const puntos = v
      .map((x, k) => (x === null ? null : `${((k / 23) * 300).toFixed(1)},${(96 - (x / max) * 88).toFixed(1)}`))
      .filter(Boolean)
      .join('L');
    return { anio: curva.anio, pico, alAnio, caida: (1 - alAnio / pico) * 100, path: `M${puntos}` };
  });

  /** Parte de la producción del último mes que viene de pozos con menos de dos años. */
  protected readonly renovacion = computed(() => {
    const d = this.servicio.datos();
    if (!d) return null;
    const n = d.meta.meses.length;
    const ultimo = n - 1;
    let total = 0;
    let nuevos = 0;
    for (const p of d.pozos) {
      const v = d.series.petroleo[p.indice * n + ultimo];
      total += v;
      if (p.conProduccion && p.inicio > ultimo - 24) nuevos += v;
    }
    return { porcentaje: (nuevos / Math.max(1, total)) * 100, mes: d.meta.meses[ultimo] };
  });

  /** Ancho de la ventana, para correr el encuadre fuera de la tarjeta. */
  private readonly anchoVentana = signal(window.innerWidth);
  private readonly altoVentana = signal(window.innerHeight);
  private readonly alRedimensionar = () => {
    this.anchoVentana.set(window.innerWidth);
    this.altoVentana.set(window.innerHeight);
  };

  /** En el celular, lo que tapan el menú (arriba) y la tarjeta con el pie (abajo). */
  protected readonly margen = computed(() =>
    // Se usa el alto máximo de la tarjeta (52% de la pantalla) y no el de cada paso: así el
    // margen no cambia en medio de un vuelo de cámara, que lo cortaría.
    this.anchoVentana() <= 700 ? { arriba: 60, abajo: Math.round(this.altoVentana() * 0.52) + 50 } : null,
    { equal: (a, b) => a?.arriba === b?.arriba && a?.abajo === b?.abajo },
  );

  protected readonly camara = computed<MapViewState>(() => {
    const p = this.actual();
    const ej = this.pozoEjemplo();
    let base = p.camara;
    if ((this.paso() === 1 || this.paso() === 2) && ej) {
      // Paso 2: el pozo entero, mirado a media profundidad. Paso 3: la rama, de cerca.
      const enRama = this.paso() === 2;
      const objetivo = enRama ? ej.medio : [(ej.boca[0] + ej.medio[0]) / 2, (ej.boca[1] + ej.medio[1]) / 2];
      const profundidad = (enRama ? ej.tr.profundidad : ej.tr.profundidad / 2) * EXAGERACION_VERTICAL;
      base = { ...p.camara, longitude: objetivo[0], latitude: objetivo[1], bearing: ej.rumbo - 90, position: [0, 0, -profundidad] };
    }
    return encuadrar(base, this.anchoVentana(), this.paso());
  });

  protected readonly seleccionado = computed(() => {
    const ej = this.pozoEjemplo();
    return (this.paso() === 1 || this.paso() === 2) && ej ? ej.tr.pozo : null;
  });

  protected ir(i: number): void {
    this.paso.set(Math.max(0, Math.min(PASOS.length - 1, i)));
  }

  protected teclado(evt: KeyboardEvent): void {
    const objetivo = evt.target as HTMLElement;
    if (objetivo?.closest('input, textarea')) return;
    if (evt.key === 'ArrowRight') this.ir(this.paso() + 1);
    if (evt.key === 'ArrowLeft') this.ir(this.paso() - 1);
  }
}

/** Ancho que ocupa la tarjeta del recorrido, con su margen. */
const ANCHO_TARJETA = 500;

/**
 * Corre la cámara para que lo que mira quede centrado en el espacio libre a la derecha de
 * la tarjeta, en lugar del centro de la pantalla. En pantallas angostas la tarjeta va abajo
 * y no hace falta.
 */
/** Cuánto más se aleja la cámara en el celular según el paso (la escena es más ancha). */
const ALEJAR_CELULAR = [0.3, 0, 0.5, 0, 0, 0];

function encuadrar(v: MapViewState, ancho: number, paso: number): MapViewState {
  // En el celular la pantalla es angosta: la cámara se aleja un poco. El encuadre vertical lo
  // resuelve el margen que se le pasa al mapa (el espacio que tapa la tarjeta).
  if (ancho <= 700) return { ...v, zoom: v.zoom - (ancho < 500 ? 0.8 : 0.5) - (ALEJAR_CELULAR[paso] ?? 0) };
  return desplazarALaDerecha(v, ancho);
}

function desplazarALaDerecha(v: MapViewState, anchoVentana: number): MapViewState {
  const pixeles = Math.min(ANCHO_TARJETA, anchoVentana * 0.4) / 2;
  const gradosPorPixel = 360 / (512 * 2 ** v.zoom);
  const rumbo = ((v.bearing ?? 0) * Math.PI) / 180;
  const corrimiento = pixeles * gradosPorPixel;
  return {
    ...v,
    // La cámara se mueve hacia la izquierda de la pantalla para que la escena quede a la derecha.
    longitude: v.longitude - corrimiento * Math.cos(rumbo),
    latitude: v.latitude + corrimiento * Math.sin(rumbo) * Math.cos((v.latitude * Math.PI) / 180),
  };
}
