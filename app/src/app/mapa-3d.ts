import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Deck, FlyToInterpolator, LinearInterpolator, MapView, type MapViewState, type PickingInfo } from '@deck.gl/core';
import { ColumnLayer, LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { DatosTrayectorias, Trayectoria } from './trayectorias';
import { HexagonLayer } from '@deck.gl/aggregation-layers';
import maplibregl from 'maplibre-gl';
import { CARTO_KEY } from './config';
import { Datos, MEDIDA_INFO, Medida, Pozo, hexARgb, produce, valorPozo } from './datos';

export type Modo = 'columnas' | 'hexagonos';
export type ColorPor = 'empresa' | 'tipo';
export type Vista = 'superficie' | 'subsuelo';

interface Celda {
  contorno: number[][][];
  profundidad: number;
  pozos: number;
  relativa: number;
}

/** La profundidad se exagera para que se lea a la escala de la cuenca (100 km de ancho). */
export const EXAGERACION_VERTICAL = 4;

const ESTILO_MAPA = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json';
// Mismo mapa oscuro, con nombres de provincias, ciudades, rutas y límites.
const ESTILO_CON_NOMBRES = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/** Agrega la clave de CARTO a todo lo que se pide a sus servidores (estilo, mosaicos, fuentes). */
function conClave(url: string): { url: string } {
  if (!CARTO_KEY || !url.includes('cartocdn.com') || /[?&]key=/.test(url)) return { url };
  return { url: `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(CARTO_KEY)}` };
}

// Metros de altura por unidad: 1.000 bbl/d -> 6 km; 100 mil m3/d de gas -> 3 km; 100 m3/d de agua -> 6 km.
const ESCALA: Record<Medida, number> = { petroleo: 6, gas: 30, agua: 60 };
// Valor por hexágono que corresponde a la altura y el color máximos.
const DOMINIO_HEX: Record<Medida, number> = { petroleo: 16000, gas: 3500, agua: 1500 };
const RGB_PETROLEO = hexARgb('#c98500');
const RGB_GAS = hexARgb('#3987e5');
const RGB_PARADO: [number, number, number] = [150, 156, 176];
const RGB_ABANDONADO: [number, number, number] = [96, 102, 124];
// Altura fija de los pozos sin producción, para que se vean como una marca baja.
const ALTURA_INACTIVO = 160;

// Rampa secuencial de un solo tono (oscuro -> claro, porque el fondo es oscuro).
const RAMPA_PETROLEO: [number, number, number][] = [
  [74, 52, 20], [120, 82, 18], [168, 112, 10], [201, 133, 0], [232, 170, 60], [252, 214, 140],
];
const RAMPA_GAS: [number, number, number][] = [
  [26, 44, 92], [34, 72, 150], [48, 104, 205], [57, 135, 229], [112, 170, 240], [180, 210, 250],
];
const RAMPA_AGUA: [number, number, number][] = [
  [14, 58, 62], [16, 88, 92], [22, 120, 122], [36, 152, 150], [96, 190, 184], [168, 226, 218],
];
const RAMPAS: Record<Medida, [number, number, number][]> = { petroleo: RAMPA_PETROLEO, gas: RAMPA_GAS, agua: RAMPA_AGUA };

const VISTA_INICIAL: MapViewState = {
  longitude: -68.86,
  latitude: -38.3,
  zoom: 7.2,
  pitch: 0,
  bearing: 0,
};
// Bajo tierra la cámara mira más de costado, para que se lea la profundidad.
const VISTA_SUBSUELO: MapViewState = {
  longitude: -68.86,
  latitude: -38.47,
  zoom: 9.3,
  pitch: 75,
  bearing: -20,
};
// Tamaño de cada celda de la superficie de la formación, en grados (unos 2,5 km).
const CELDA = 0.025;
/**
 * Límites de la cámara: se puede acercar hasta ver un pozo, pero no alejar tanto que se
 * pierda la región, ni inclinar más allá de mirar casi de costado.
 */
const LIMITES = { minZoom: 6.3, maxZoom: 14.5, maxPitch: 85 };
/** Hasta dónde se puede arrastrar el mapa: la cuenca y alrededores, para no perder los pozos. */
const AREA_PERMITIDA = { oeste: -69.2, este: -68.35, sur: -38.75, norte: -37.95 };
const acotar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/**
 * Densidad de píxeles a dibujar. Los celulares tienen pantallas de 2x o 3x: dibujar a 3x
 * es 9 veces más trabajo para la placa de video. A 1,5x se ve igual de nítido y anda fluido.
 */
const DENSIDAD = Math.min(window.devicePixelRatio || 1, 1.5);
// Ciudades de referencia en la superficie.
const CIUDADES = [
  { nombre: 'Añelo', lon: -68.788, lat: -38.355 },
  { nombre: 'Neuquén', lon: -68.059, lat: -38.952 },
];
const VISTA_3D: MapViewState = {
  longitude: -68.88,
  latitude: -38.36,
  zoom: 8.75,
  pitch: 55,
  bearing: -22,
};

@Component({
  selector: 'vm-mapa-3d',
  host: { '[class.bajo-tierra]': "vista() === 'subsuelo'" },
  template: `
    <div class="mapa-base" #base aria-hidden="true"></div>
    <div class="mapa-deck" #lienzo role="img" [attr.aria-label]="descripcion()"></div>
  `,
  styles: `
    :host { position: absolute; inset: 0; display: block; background: var(--fondo); }
    .mapa-base, .mapa-deck { position: absolute; inset: 0; }
    .mapa-base { transition: opacity 1.2s, filter 1.2s; }
    /* Bajo tierra la superficie queda como un velo para ver a través. */
    :host(.bajo-tierra) .mapa-base { opacity: 0.28; filter: saturate(0.4); }
    .mapa-deck { cursor: grab; }
  `,
})
export class Mapa3d implements AfterViewInit, OnDestroy {
  readonly datos = input.required<Datos>();
  readonly mes = input.required<number>();
  readonly medida = input<Medida>('petroleo');
  readonly modo = input<Modo>('columnas');
  readonly colorPor = input<ColorPor>('empresa');
  readonly empresaResaltada = input<number | null>(null);
  readonly seleccionado = input<number | null>(null);
  readonly descripcion = input('Mapa 3D de pozos');
  readonly conNombres = input(false);
  readonly mostrarInactivos = input(false);
  readonly vista = input<Vista>('superficie');
  readonly trayectorias = input<DatosTrayectorias | null>(null);
  /** Si se indica, la cámara va a este punto en lugar de la vista por defecto (lo usa el recorrido). */
  readonly camara = input<MapViewState | null>(null);
  /** Un solo color para todos los pozos bajo tierra (el recorrido no muestra empresas). */
  readonly colorUnico = input<string | null>(null);
  /** Atenúa todos los pozos menos el elegido y lo rotula (lo usa el recorrido). */
  readonly aislado = input(false);
  /** Marca etapas de fractura ilustrativas sobre la rama del pozo elegido. */
  readonly etapas = input(false);
  /**
   * Píxeles tapados arriba y abajo por otros elementos (en el celular, el menú y la tarjeta del
   * recorrido). La cámara centra lo que mira en el espacio libre que queda entre ambos.
   */
  readonly margen = input<{ arriba: number; abajo: number } | null>(null);
  readonly elegirPozo = output<number | null>();

  private readonly base = viewChild.required<ElementRef<HTMLDivElement>>('base');
  private readonly lienzo = viewChild.required<ElementRef<HTMLDivElement>>('lienzo');
  private deck?: Deck<any>;
  private mapa?: maplibregl.Map;
  /** 0 al arrancar y 1 después: anima el crecimiento de las columnas una sola vez. */
  private crecimiento = 0;
  private readonly reducirMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;

  private vistaAnterior: Vista | null = null;

  constructor() {
    // Al cambiar entre superficie y subsuelo, la cámara viaja de una vista a la otra.
    effect(() => {
      const v = this.vista();
      if (this.vistaAnterior !== null && this.vistaAnterior !== v && !this.camara()) {
        this.deck?.setProps({
          initialViewState: {
            ...LIMITES,
            ...(v === 'subsuelo' ? VISTA_SUBSUELO : VISTA_3D),
            transitionDuration: this.reducirMovimiento ? 0 : 2200,
            transitionInterpolator: new FlyToInterpolator({ speed: 1.1 }),
          },
        });
      }
      this.vistaAnterior = v;
    });
    // Cámara guiada: cada cambio vuela al nuevo punto.
    effect(() => {
      const c = this.camara();
      if (!c || !this.deck) return;
      this.deck.setProps({
        initialViewState: {
            ...LIMITES,
          position: [0, 0, 0],
          ...c,
          maxPitch: 85,
          transitionDuration: this.reducirMovimiento ? 0 : 2400,
          // Lineal para poder mover también el punto de mira bajo tierra (position).
          transitionInterpolator: new LinearInterpolator(['longitude', 'latitude', 'zoom', 'bearing', 'pitch', 'position']),
        },
      });
    });
    // Si cambia el espacio libre, la vista y el mapa base se ajustan juntos.
    effect(() => {
      const m = this.margen();
      this.deck?.setProps({ views: this.vista3d() });
      this.mapa?.setPadding({ top: m?.arriba ?? 0, bottom: m?.abajo ?? 0, left: 0, right: 0 });
    });
    // Cambia el mapa base cuando se activan o desactivan los nombres de lugares.
    effect(() => {
      const nombres = this.conNombres();
      this.mapa?.setStyle(nombres ? ESTILO_CON_NOMBRES : ESTILO_MAPA);
    });
    effect(() => {
      // Lee todas las señales para que el efecto se dispare con cualquier cambio.
      this.datos(); this.mes(); this.medida(); this.modo(); this.colorPor();
      this.empresaResaltada(); this.seleccionado(); this.mostrarInactivos(); this.trayectorias();
      this.actualizarCapas();
    });
  }

  ngAfterViewInit(): void {
    // En pantallas angostas la cámara se aleja para que entre toda la cuenca.
    if (this.lienzo().nativeElement.clientWidth < 700) {
      VISTA_3D.zoom = 7.7;
      VISTA_INICIAL.zoom = 6.4;
    }
    const inicial = this.reducirMovimiento ? VISTA_3D : VISTA_INICIAL;
    try {
      this.mapa = new maplibregl.Map({
        container: this.base().nativeElement,
        style: this.conNombres() ? ESTILO_CON_NOMBRES : ESTILO_MAPA,
        center: [(this.vista() === 'subsuelo' ? VISTA_SUBSUELO : inicial).longitude, (this.vista() === 'subsuelo' ? VISTA_SUBSUELO : inicial).latitude],
        zoom: (this.vista() === 'subsuelo' ? VISTA_SUBSUELO : inicial).zoom,
        pitch: (this.vista() === 'subsuelo' ? VISTA_SUBSUELO : inicial).pitch,
        bearing: (this.vista() === 'subsuelo' ? VISTA_SUBSUELO : inicial).bearing,
        interactive: false,
        pixelRatio: DENSIDAD,
        attributionControl: { compact: true },
        maxPitch: 85,
        transformRequest: (url) => conClave(url),
      });
    } catch {
      // Sin WebGL para el mapa base: las columnas igual se dibujan sobre el fondo.
      this.mapa = undefined;
    }

    this.vistaAnterior = this.vista();
    const arranque = this.camara() ?? (this.vista() === 'subsuelo' ? VISTA_SUBSUELO : inicial);
    this.deck = new Deck({
      parent: this.lienzo().nativeElement,
      // Plano lejano más amplio para que lo que está bajo tierra no se recorte.
      views: this.vista3d(),
      useDevicePixels: DENSIDAD,
      initialViewState: { ...arranque, ...LIMITES },
      controller: { dragRotate: true, touchRotate: true, keyboard: true },
      onViewStateChange: ({ viewState, interactionState }) => {
        // El límite de arrastre es para la persona; los vuelos de cámara guiados (el recorrido)
        // pueden necesitar ubicarse un poco afuera para encuadrar la escena.
        const guiado = interactionState?.inTransition && !interactionState.isDragging;
        const v = guiado
          ? (viewState as unknown as MapViewState)
          : {
              ...(viewState as unknown as MapViewState),
              longitude: acotar(viewState.longitude, AREA_PERMITIDA.oeste, AREA_PERMITIDA.este),
              latitude: acotar(viewState.latitude, AREA_PERMITIDA.sur, AREA_PERMITIDA.norte),
            };
        this.mapa?.jumpTo({
          center: [v.longitude, v.latitude],
          zoom: v.zoom,
          bearing: v.bearing ?? 0,
          pitch: v.pitch ?? 0,
        });
        return v as any;
      },
      getTooltip: (info) => this.tooltip(info),
      layers: [],
    });
    this.escucharToques(this.lienzo().nativeElement);
    this.actualizarCapas();

    if (this.reducirMovimiento) {
      this.crecimiento = 1;
      this.actualizarCapas();
    } else {
      // Un único momento orquestado: la cámara se inclina y las columnas crecen.
      setTimeout(() => {
        this.deck?.setProps({
          initialViewState: {
            ...LIMITES,
            ...(this.camara() ?? (this.vista() === 'subsuelo' ? VISTA_SUBSUELO : VISTA_3D)),
            maxPitch: 85,
            transitionDuration: 2800,
            transitionInterpolator: new FlyToInterpolator({ speed: 0.9 }),
          },
        });
        this.crecimiento = 1;
        this.actualizarCapas();
      }, 350);
    }
  }

  /**
   * Selección de pozos: un toque corto sin arrastrar elige el pozo que está debajo.
   * Se resuelve con pickObject para no depender del reconocedor de clics de deck.gl.
   */
  private escucharToques(el: HTMLElement): void {
    let inicio: { x: number; y: number; t: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      inicio = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener('pointerup', (e) => {
      if (!inicio || !this.deck) return;
      const movio = Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 6;
      const largo = performance.now() - inicio.t > 500;
      inicio = null;
      if (movio || largo) return;
      const r = el.getBoundingClientRect();
      const info = this.deck.pickObject({ x: e.clientX - r.left, y: e.clientY - r.top, radius: 4, layerIds: ['pozos', 'trayectorias'] });
      const objeto = info?.object as (Pozo & Trayectoria) | undefined;
      if (info?.layer?.id === 'trayectorias') {
        this.elegirPozo.emit(objeto && objeto.pozo >= 0 ? objeto.pozo : null);
        return;
      }
      this.elegirPozo.emit(objeto && this.visible(objeto) ? objeto.indice : null);
    });
  }

  ngOnDestroy(): void {
    this.deck?.finalize();
    this.mapa?.remove();
  }

  /** Lleva la cámara a un punto, por ejemplo al elegir un resultado del buscador. */
  volarA(lon: number, lat: number, zoom = 11.5): void {
    // Bajo tierra se mira más de costado y desde un poco más lejos, para ver la profundidad.
    const subsuelo = this.vista() === 'subsuelo';
    this.deck?.setProps({
      initialViewState: {
            ...LIMITES,
        longitude: lon,
        latitude: subsuelo ? lat - 0.06 : lat,
        zoom: subsuelo ? zoom - 0.8 : zoom,
        pitch: subsuelo ? 72 : 55,
        bearing: -22,
        maxPitch: 85,
        transitionDuration: this.reducirMovimiento ? 0 : 1600,
        transitionInterpolator: new FlyToInterpolator({ speed: 1.4 }),
      },
    });
  }

  private visible(p: Pozo): boolean {
    const mes = this.mes();
    if (p.inicio > mes) return false;
    return produce(this.datos(), p.indice, mes) || this.mostrarInactivos();
  }

  /** Vuelve a la vista inicial en 3D. */
  recentrar(): void {
    this.deck?.setProps({
      initialViewState: {
            ...LIMITES,
        ...(this.vista() === 'subsuelo' ? VISTA_SUBSUELO : VISTA_3D),
        transitionDuration: this.reducirMovimiento ? 0 : 1200,
        transitionInterpolator: new FlyToInterpolator(),
      },
    });
  }

  private actualizarCapas(): void {
    if (!this.deck) return;
    const d = this.datos();
    const mes = this.mes();
    const medida = this.medida();
    const resaltada = this.empresaResaltada();
    const sel = this.seleccionado();
    const colorPor = this.colorPor();
    const escala = ESCALA[medida] * this.crecimiento;
    const coloresEmpresa = d.meta.empresas.map((e) => hexARgb(e.color));
    const transicion = this.reducirMovimiento ? 0 : 260;

    const inactivos = this.mostrarInactivos();
    const color = (p: Pozo): [number, number, number, number] => {
      if (p.inicio > mes) return [0, 0, 0, 0];
      const apagado = resaltada !== null && p.empresa !== resaltada;
      if (!produce(d, p.indice, mes)) {
        if (!inactivos) return [0, 0, 0, 0];
        const gris = p.estado === 'abandonado' ? RGB_ABANDONADO : RGB_PARADO;
        return [gris[0], gris[1], gris[2], apagado ? 24 : 200];
      }
      const rgb = colorPor === 'empresa' ? coloresEmpresa[p.empresa] : p.esGas ? RGB_GAS : RGB_PETROLEO;
      return [rgb[0], rgb[1], rgb[2], apagado ? 28 : 235];
    };
    const altura = (p: Pozo): number => {
      if (p.inicio > mes) return 0;
      if (!produce(d, p.indice, mes)) return inactivos ? ALTURA_INACTIVO * this.crecimiento : 0;
      return valorPozo(d, medida, p.indice, mes) * escala;
    };

    const disparadores = [mes, medida, colorPor, resaltada, this.crecimiento, inactivos];
    const capas: any[] = [];

    if (this.vista() === 'subsuelo') {
      capas.push(...this.capasSubsuelo(coloresEmpresa));
    } else if (this.modo() === 'columnas') {
      capas.push(
        new ColumnLayer<Pozo>({
          id: 'pozos',
          data: d.pozos,
          diskResolution: 6,
          radius: 420,
          extruded: true,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 90],
          getPosition: (p) => [p.lon, p.lat],
          getElevation: altura,
          getFillColor: color,
          material: { ambient: 0.55, diffuse: 0.6, shininess: 24, specularColor: [255, 240, 220] },
          updateTriggers: { getElevation: disparadores, getFillColor: disparadores },
          transitions: { getElevation: this.crecimiento === 1 && transicion ? transicion : 1600 },
        }),
      );
    } else {
      const activos = d.pozos.filter(
        (p) => p.inicio <= mes && (resaltada === null || p.empresa === resaltada),
      );
      capas.push(
        new HexagonLayer<Pozo>({
          id: 'hexagonos',
          data: activos,
          gpuAggregation: false,
          radius: 2200,
          coverage: 0.86,
          extruded: true,
          pickable: true,
          autoHighlight: true,
          elevationScale: this.crecimiento,
          elevationRange: [0, 14000],
          elevationDomain: [0, DOMINIO_HEX[medida]],
          colorDomain: [0, DOMINIO_HEX[medida]],
          elevationAggregation: 'SUM',
          colorAggregation: 'SUM',
          getPosition: (p) => [p.lon, p.lat],
          getElevationWeight: (p) => valorPozo(d, medida, p.indice, mes),
          getColorWeight: (p) => valorPozo(d, medida, p.indice, mes),
          colorRange: RAMPAS[medida],
          material: { ambient: 0.6, diffuse: 0.6, shininess: 18 },
          updateTriggers: { getElevationWeight: disparadores, getColorWeight: disparadores },
          transitions: { elevationScale: transicion },
        }),
      );
    }

    if (sel !== null && this.vista() === 'superficie') {
      const p = d.pozos[sel];
      capas.push(
        new ScatterplotLayer<Pozo>({
          id: 'seleccion',
          data: [p],
          getPosition: (x) => [x.lon, x.lat],
          getRadius: 900,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 2,
          getLineColor: [255, 255, 255, 230],
        }),
      );
    }

    this.deck.setProps({ layers: capas });
  }

  /** Caminos con la profundidad ya exagerada, calculados una sola vez por juego de datos. */
  private cacheSubsuelo: { fuente: DatosTrayectorias; caminos: Float64Array[]; celdas: Celda[] } | null = null;

  private prepararSubsuelo(t: DatosTrayectorias) {
    if (this.cacheSubsuelo?.fuente === t) return this.cacheSubsuelo;
    const caminos = t.lista.map((tr) => {
      const plano = new Float64Array(tr.camino.length * 3);
      tr.camino.forEach(([x, y, h], i) => {
        plano[i * 3] = x;
        plano[i * 3 + 1] = y;
        plano[i * 3 + 2] = h * EXAGERACION_VERTICAL;
      });
      return plano;
    });

    // Superficie de la formación: la profundidad de aterrizaje promedio de los pozos en cada celda.
    const suma = new Map<string, { i: number; j: number; z: number; n: number }>();
    for (const tr of t.lista) {
      const [x, y] = tr.camino[tr.camino.length - 1];
      const i = Math.floor(x / CELDA);
      const j = Math.floor(y / CELDA);
      const k = `${i},${j}`;
      const c = suma.get(k) ?? { i, j, z: 0, n: 0 };
      c.z += tr.profundidad;
      c.n++;
      suma.set(k, c);
    }
    // Se completa un anillo alrededor de cada celda con pozos, para que la capa sea continua.
    const promedio = new Map([...suma].map(([k, c]) => [k, { i: c.i, j: c.j, prof: c.z / c.n, n: c.n }]));
    const todas = new Map(promedio);
    for (const c of promedio.values()) {
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const k = `${c.i + di},${c.j + dj}`;
          if (todas.has(k)) continue;
          const vecinos = [];
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
            const v = promedio.get(`${c.i + di + a},${c.j + dj + b}`);
            if (v) vecinos.push(v.prof);
          }
          todas.set(k, { i: c.i + di, j: c.j + dj, prof: vecinos.reduce((x, y) => x + y, 0) / vecinos.length, n: 0 });
        }
      }
    }
    const profundidades = [...todas.values()].map((c) => c.prof);
    const minimo = Math.min(...profundidades);
    const maximo = Math.max(...profundidades);
    // Cada esquina toma el promedio de las celdas que la tocan: la superficie queda continua, sin escalones.
    const esquina = (i: number, j: number) => {
      const v = [todas.get(`${i - 1},${j - 1}`), todas.get(`${i},${j - 1}`), todas.get(`${i - 1},${j}`), todas.get(`${i},${j}`)]
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => c.prof);
      return -(v.reduce((a, b) => a + b, 0) / v.length) * EXAGERACION_VERTICAL;
    };
    const celdas: Celda[] = [...todas.values()].map((c) => {
      const x0 = c.i * CELDA, y0 = c.j * CELDA, x1 = x0 + CELDA, y1 = y0 + CELDA;
      return {
        contorno: [[
          [x0, y0, esquina(c.i, c.j)],
          [x1, y0, esquina(c.i + 1, c.j)],
          [x1, y1, esquina(c.i + 1, c.j + 1)],
          [x0, y1, esquina(c.i, c.j + 1)],
        ]],
        profundidad: c.prof,
        pozos: c.n,
        // 0 = la parte más somera, 1 = la más profunda.
        relativa: maximo > minimo ? (c.prof - minimo) / (maximo - minimo) : 0.5,
      };
    });
    this.cacheSubsuelo = { fuente: t, caminos, celdas };
    return this.cacheSubsuelo;
  }

  /** Pozos bajo tierra y un plano translúcido a la profundidad de la formación. */
  private capasSubsuelo(coloresEmpresa: [number, number, number][]): any[] {
    const t = this.trayectorias();
    if (!t) return [];
    const d = this.datos();
    const mes = this.mes();
    const resaltada = this.empresaResaltada();
    const sel = this.seleccionado();
    const colorPor = this.colorPor();
    const { caminos, celdas } = this.prepararSubsuelo(t);
    // Con la línea de tiempo, aparecen los pozos a medida que empiezan a producir.
    const visible = (tr: Trayectoria) => tr.pozo < 0 || !d.pozos[tr.pozo].conProduccion || d.pozos[tr.pozo].inicio <= mes;

    const colorDe = (tr: Trayectoria): [number, number, number, number] => {
      if (!visible(tr)) return [0, 0, 0, 0];
      if (sel !== null && tr.pozo === sel) return [255, 255, 255, 255];
      const p = tr.pozo >= 0 ? d.pozos[tr.pozo] : null;
      const unico = this.colorUnico();
      const rgb = unico
        ? hexARgb(unico)
        : colorPor === 'empresa' ? (coloresEmpresa[tr.empresa] ?? RGB_PARADO) : p?.esGas ? RGB_GAS : RGB_PETROLEO;
      const apagado = resaltada !== null && tr.empresa !== resaltada;
      const fondo = this.aislado() && sel !== null;
      return [rgb[0], rgb[1], rgb[2], fondo ? 14 : apagado ? 22 : 210];
    };
    const indice = new Map(t.lista.map((tr, i) => [tr, i]));

    return [
      new SolidPolygonLayer<Celda>({
        id: 'formacion',
        data: celdas,
        getPolygon: (c) => c.contorno as any,
        // Arenisca: más clara donde la formación está más cerca de la superficie.
        getFillColor: (c) => {
          const f = 1 - c.relativa;
          return [Math.round(120 + 112 * f), Math.round(104 + 110 * f), Math.round(84 + 93 * f), 58];
        },
        _full3d: true,
        pickable: true,
        parameters: { depthWriteEnabled: false },
      }),
      new PathLayer<Trayectoria>({
        id: 'trayectorias',
        data: t.lista,
        getPath: (tr) => caminos[indice.get(tr)!] as any,
        positionFormat: 'XYZ',
        _pathType: 'open',
        // De frente a la cámara: si no, los tramos verticales no tienen ancho y no se dibujan.
        billboard: true,
        getColor: colorDe,
        getWidth: (tr) => (sel !== null && tr.pozo === sel ? (this.aislado() ? 6 : 5) : 2),
        widthUnits: 'pixels',
        widthMinPixels: 1,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 140],
        updateTriggers: { getColor: [colorPor, resaltada, sel, mes, this.colorUnico(), this.aislado()], getWidth: [sel, this.aislado()] },
      }),
      new ScatterplotLayer<Trayectoria>({
        id: 'bocas',
        data: t.lista,
        getPosition: (tr) => [tr.camino[0][0], tr.camino[0][1], 0],
        getRadius: 2,
        radiusUnits: 'pixels',
        // De frente a la cámara, para que no se aplasten en rayitas con la vista inclinada.
        billboard: true,
        getFillColor: (tr) => {
          const c = colorDe(tr);
          return c[3] === 0 ? c : [c[0], c[1], c[2], Math.min(c[3], 150)];
        },
        updateTriggers: { getFillColor: [colorPor, resaltada, sel, mes, this.colorUnico()] },
      }),
      ...this.guiasSubsuelo(t, celdas),
      ...this.rotulosPozo(t),
    ];
  }

  /**
   * Referencias para leer la escena: dónde está la superficie, a qué profundidad está la
   * formación (con una regla en metros reales) y dos ciudades para ubicarse.
   */
  private guiasSubsuelo(t: DatosTrayectorias, celdas: Celda[]): any[] {
    let oeste = Infinity, este = -Infinity, sur = Infinity;
    for (const c of celdas) {
      for (const [x, y] of c.contorno[0]) {
        oeste = Math.min(oeste, x); este = Math.max(este, x); sur = Math.min(sur, y);
      }
    }
    // La regla va adelante y al centro, del lado de la cámara, para que se lea grande.
    const lon = (oeste + este) / 2 + (este - oeste) * 0.12;
    const lat = sur - 0.03;
    const fondo = Math.ceil(t.profundidadPromedio / 1000) * 1000;
    const z = (m: number) => -m * EXAGERACION_VERTICAL;
    const marcas = Array.from({ length: fondo / 1000 + 1 }, (_, i) => i * 1000);
    const lineas = [
      { desde: [lon, lat, 0], hasta: [lon, lat, z(fondo)] },
      ...marcas.map((m) => ({ desde: [lon, lat, z(m)], hasta: [lon + 0.03, lat, z(m)] })),
    ];
    const textos = [
      ...marcas.map((m) => ({ pos: [lon - 0.015, lat, z(m)], texto: m === 0 ? 'Superficie' : `${(m / 1000).toLocaleString('es-AR')}.000 m` , tipo: 'regla' })),
      { pos: [lon + 0.05, lat, z(t.profundidadPromedio)], texto: 'Vaca Muerta', tipo: 'formacion' },
      ...CIUDADES.map((c) => ({ pos: [c.lon, c.lat, 0], texto: c.nombre, tipo: 'ciudad' })),
    ];
    return [
      new LineLayer({
        id: 'regla',
        data: lineas,
        getSourcePosition: (l: { desde: number[] }) => l.desde as any,
        getTargetPosition: (l: { hasta: number[] }) => l.hasta as any,
        getColor: [232, 214, 177, 200],
        getWidth: 1.5,
      }),
      new ScatterplotLayer({
        id: 'ciudades',
        data: CIUDADES,
        getPosition: (c: { lon: number; lat: number }) => [c.lon, c.lat, 0],
        getRadius: 4,
        radiusUnits: 'pixels',
        billboard: true,
        stroked: true,
        getFillColor: [20, 26, 51, 255],
        getLineColor: [238, 240, 247, 230],
        lineWidthMinPixels: 1.5,
      }),
      new TextLayer({
        id: 'textos-guia',
        data: textos,
        getPosition: (x: { pos: number[] }) => x.pos as any,
        getText: (x: { texto: string }) => x.texto,
        characterSet: 'auto',
        fontFamily: 'Instrument Sans, system-ui, sans-serif',
        fontWeight: 600,
        getSize: (x: { tipo: string }) => (x.tipo === 'formacion' ? 16 : 13),
        sizeUnits: 'pixels',
        sizeMinPixels: 12,
        sizeMaxPixels: 16,
        getColor: (x: { tipo: string }) => (x.tipo === 'ciudad' ? [238, 240, 247, 235] : [232, 214, 177, 235]),
        getTextAnchor: (x: { tipo: string }) => (x.tipo === 'regla' ? 'end' : 'start'),
        getAlignmentBaseline: 'center',
        getPixelOffset: (x: { tipo: string }) => (x.tipo === 'ciudad' ? [8, 0] : [0, 0]),
        outlineWidth: 3,
        outlineColor: [20, 26, 51, 255],
        fontSettings: { sdf: true },
        billboard: true,
      }),
    ];
  }

  /** Rótulos del pozo elegido en el recorrido: cuánto baja, cuánto mide la rama y sus etapas. */
  private rotulosPozo(t: DatosTrayectorias): any[] {
    const sel = this.seleccionado();
    if (!this.aislado() || sel === null) return [];
    const tr = t.porPozo.get(sel);
    if (!tr) return [];
    const z = (h: number) => h * EXAGERACION_VERTICAL;
    const [x0, y0] = tr.camino[0];
    // La rama: los puntos que ya están a la profundidad de aterrizaje.
    const rama = tr.camino.filter(([, , h]) => h <= -tr.profundidad + 1);
    const medio = rama[Math.floor(rama.length / 2)] ?? tr.camino[tr.camino.length - 1];
    const textos = [
      { pos: [x0, y0, z(-tr.profundidad / 2)], texto: `Baja ${tr.profundidad.toLocaleString('es-AR')} m` },
      { pos: [medio[0], medio[1], z(medio[2])], texto: `Rama horizontal: ${tr.rama.toLocaleString('es-AR')} m`, rama: true },
    ];
    const capas: any[] = [
      new TextLayer({
        id: 'rotulos-pozo',
        data: textos,
        getPosition: (x: { pos: number[] }) => x.pos as any,
        getText: (x: { texto: string }) => x.texto,
        characterSet: 'auto',
        fontFamily: 'Instrument Sans, system-ui, sans-serif',
        fontWeight: 600,
        getSize: 15,
        sizeUnits: 'pixels',
        getColor: [255, 255, 255, 240],
        getTextAnchor: (x: { rama?: boolean }) => (x.rama ? 'middle' : 'start'),
        getAlignmentBaseline: 'center',
        // El rótulo de la rama va por encima, para no tapar las etapas.
        getPixelOffset: (x: { rama?: boolean }) => (x.rama ? [0, -26] : [12, -14]),
        sizeMinPixels: 14,
        sizeMaxPixels: 16,
        outlineWidth: 3,
        outlineColor: [20, 26, 51, 255],
        fontSettings: { sdf: true },
        billboard: true,
        // Siempre por delante del pozo, para que la línea no tape el texto.
        parameters: { depthCompare: 'always' },
      }),
    ];
    if (this.etapas() && rama.length > 1) {
      // Ilustración: una etapa cada 70 m, la separación típica que publican las operadoras.
      const marcas: number[][] = [];
      let acumulado = 0;
      let siguiente = 0;
      for (let i = 1; i < rama.length; i++) {
        const [ax, ay] = rama[i - 1];
        const [bx, by] = rama[i];
        const tramo = Math.hypot((bx - ax) * 111_320 * Math.cos((ay * Math.PI) / 180), (by - ay) * 111_320);
        while (siguiente <= acumulado + tramo) {
          const f = tramo ? (siguiente - acumulado) / tramo : 0;
          marcas.push([ax + (bx - ax) * f, ay + (by - ay) * f, z(-tr.profundidad)]);
          siguiente += 70;
        }
        acumulado += tramo;
      }
      capas.push(
        new ScatterplotLayer({
          id: 'etapas',
          data: marcas,
          getPosition: (m: number[]) => m as any,
          getRadius: 5,
          radiusUnits: 'pixels',
          billboard: true,
          getFillColor: [232, 160, 70, 255],
          stroked: true,
          getLineColor: [20, 26, 51, 255],
          lineWidthMinPixels: 1.5,
          parameters: { depthCompare: 'always' },
        }),
      );
    }
    return capas;
  }

  private vista3d(): MapView {
    const m = this.margen();
    // Plano lejano más amplio para que lo que está bajo tierra no se recorte.
    return new MapView({
      farZMultiplier: 6,
      nearZMultiplier: 0.05,
      ...(m ? { padding: { top: m.arriba, bottom: m.abajo } } : {}),
    });
  }

  private tooltip(info: PickingInfo): { html: string; style: Record<string, string> } | null {
    if (!info.object) return null;
    const d = this.datos();
    const mes = this.mes();
    const estilo = {
      background: 'rgba(20, 26, 51, 0.94)',
      color: '#eef0f7',
      border: '1px solid rgba(201, 182, 150, 0.28)',
      borderRadius: '10px',
      padding: '10px 12px',
      font: '13px/1.45 "Instrument Sans", system-ui, sans-serif',
      maxWidth: '260px',
    };
    if (this.modo() === 'hexagonos' && this.vista() === 'superficie') {
      const o = info.object as { points?: { source: Pozo }[]; count?: number; elevationValue?: number; colorValue?: number };
      const n = o.count ?? o.points?.length ?? 0;
      const valor = o.colorValue ?? 0;
      const m = MEDIDA_INFO[this.medida()];
      return { html: `<strong>${n.toLocaleString('es-AR')} pozos</strong><br>${m.nombre}: ${m.corto(valor)}`, style: estilo };
    }
    if (info.layer?.id === 'formacion') {
      const c = info.object as Celda;
      return {
        html:
          `<strong>Vaca Muerta a unos ${Math.round(c.profundidad / 10) * 10} m</strong><br>` +
          (c.pozos ? `Promedio de ${c.pozos} pozos en esta zona` : 'Estimado con las zonas vecinas'),
        style: estilo,
      };
    }
    if (info.layer?.id === 'trayectorias') {
      const tr = info.object as Trayectoria;
      const empresaT = d.meta.empresas[tr.empresa]?.nombre ?? '';
      return {
        html:
          `<strong>${escapar(tr.nombre)}</strong><br>` +
          `<span style="color:#b9bfd4">${escapar(empresaT)}</span><br>` +
          `Rama horizontal: ${tr.rama.toLocaleString('es-AR')} m<br>Profundidad: ${tr.profundidad.toLocaleString('es-AR')} m`,
        style: estilo,
      };
    }
    const p = info.object as Pozo;
    if (!this.visible(p)) return null;
    const empresa = d.meta.empresas[p.empresa]?.nombre ?? '';
    const lineas = produce(d, p.indice, mes)
      ? `${MEDIDA_INFO.petroleo.pozo(valorPozo(d, 'petroleo', p.indice, mes))} de petróleo<br>` +
        `${MEDIDA_INFO.gas.pozo(valorPozo(d, 'gas', p.indice, mes))} de gas<br>` +
        `${MEDIDA_INFO.agua.pozo(valorPozo(d, 'agua', p.indice, mes))} de agua`
      : `Sin producción este mes${p.estadoTexto ? `<br>Estado: ${escapar(p.estadoTexto)}` : ''}`;
    return {
      html:
        `<strong>${escapar(p.nombre)}</strong><br>` +
        `<span style="color:#b9bfd4">${escapar(empresa)}, ${escapar(d.meta.areas[p.area] ?? '')}</span><br>` +
        lineas,
      style: estilo,
    };
  }
}

function escapar(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
