import { Component, OnDestroy, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatosService, MEDIDAS, MEDIDA_INFO, Medida, formato, nombreMes } from '../datos';
import { ColorPor, Mapa3d, Modo, Vista } from '../mapa-3d';
import { Estratos } from '../estratos';
import { FichaPozo } from '../ficha-pozo';
import { Buscador, Resultado } from '../buscador';
import { TrayectoriasService } from '../trayectorias';
import { Seo } from '../seo';

const VELOCIDADES = [
  { etiqueta: '1×', ms: 260 },
  { etiqueta: '2×', ms: 130 },
  { etiqueta: '4×', ms: 65 },
];
/** Meses durante los que se muestra el texto de un momento clave. */
const DURACION_MOMENTO = 6;

/**
 * Producción y Subsuelo comparten esta vista: el mismo mapa 3D cambia de capas y de
 * cámara, así el paso de una a otra es una transición continua.
 */
@Component({
  selector: 'vm-escena',
  imports: [Mapa3d, Estratos, FichaPozo, Buscador, RouterLink],
  templateUrl: './escena.html',
})
export class Escena implements OnDestroy {
  /** Viene del parámetro de la ruta: produccion | subsuelo */
  readonly seccion = input<string>('produccion');
  readonly pozo = input<string | undefined>(undefined);

  protected readonly servicio = inject(DatosService);
  protected readonly trayectorias = inject(TrayectoriasService);
  protected readonly datos = this.servicio.datos;
  protected readonly f = formato;

  protected readonly vista = computed<Vista>(() => (this.seccion() === 'subsuelo' ? 'subsuelo' : 'superficie'));
  protected readonly mes = signal(0);
  protected readonly medida = signal<Medida>('petroleo');
  protected readonly modo = signal<Modo>('columnas');
  protected readonly colorPor = signal<ColorPor>('empresa');
  protected readonly empresaResaltada = signal<number | null>(null);
  protected readonly seleccionado = signal<number | null>(null);
  protected readonly reproduciendo = signal(false);
  protected readonly velocidad = signal(1);
  protected readonly conNombres = signal(false);
  protected readonly mostrarInactivos = signal(false);
  protected readonly velocidades = VELOCIDADES;

  private readonly mapa = viewChild(Mapa3d);
  private temporizador?: ReturnType<typeof setInterval>;

  constructor() {
    this.servicio.cargar();
    const seo = inject(Seo);
    effect(() => seo.aplicar(this.vista() === 'subsuelo' ? 'subsuelo' : 'produccion'));
    // Al llegar los datos, el mapa arranca en el último mes disponible.
    effect(() => {
      const d = this.datos();
      if (d) untracked(() => this.mes.set(d.meta.meses.length - 1));
    });
    // Las trayectorias se piden recién cuando alguien entra al subsuelo.
    effect(() => {
      const d = this.datos();
      if (d && this.vista() === 'subsuelo') untracked(() => this.trayectorias.cargar(d));
    });
    // ?pozo=ID abre la ficha de ese pozo (por ejemplo, desde Rendimiento).
    effect(() => {
      const d = this.datos();
      const id = this.pozo();
      if (!d || !id) return;
      const p = d.pozos.find((x) => x.id === id);
      if (p) {
        untracked(() => {
          this.seleccionado.set(p.indice);
          setTimeout(() => this.mapa()?.volarA(p.lon, p.lat), 600);
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.detener();
  }

  protected readonly ultimoMes = computed(() => (this.datos()?.meta.meses.length ?? 1) - 1);
  protected readonly textoMes = computed(() => {
    const d = this.datos();
    return d ? nombreMes(d.meta.meses[this.mes()]) : '';
  });
  protected readonly anio = computed(() => this.textoMes().split(' ').pop() ?? '');
  protected readonly nombreDelMes = computed(() => this.textoMes().split(' ').slice(0, -1).join(' '));
  protected readonly nombreMedida = computed(() => MEDIDA_INFO[this.medida()].nombre);

  /** El momento clave más reciente, si ocurrió hace menos de DURACION_MOMENTO meses. */
  protected readonly momentoActual = computed(() => {
    const d = this.datos();
    if (!d) return null;
    const actual = this.mes();
    let elegido = null;
    for (const m of this.servicio.momentos()) {
      const i = d.meta.meses.indexOf(m.mes);
      if (i >= 0 && i <= actual && actual - i < DURACION_MOMENTO) elegido = m;
    }
    return elegido;
  });

  /** Indicadores del mes elegido, con la variación contra el mismo mes del año anterior. */
  protected readonly indicadores = computed(() => {
    const d = this.datos();
    if (!d) return null;
    const t = d.totales;
    const m = this.mes();
    const anterior = m - 12;
    const variacion = (serie: ArrayLike<number>) =>
      anterior >= 0 && serie[anterior] > 0 ? ((serie[m] - serie[anterior]) / serie[anterior]) * 100 : null;
    return {
      medidas: MEDIDAS.map((medida) => ({
        medida,
        nombre: MEDIDA_INFO[medida].nombre,
        valor: MEDIDA_INFO[medida].total(t.total[medida][m]),
        unidad: MEDIDA_INFO[medida].unidadTotal,
        variacion: variacion(t.total[medida]),
      })),
      activos: t.activos[m],
      conectados: t.conectados[m],
      conectados12: Array.from(t.conectados.slice(Math.max(0, m - 11), m + 1)).reduce((a, b) => a + b, 0),
    };
  });

  /** De qué provincia sale la medida elegida en el mes. Solo si hay más de una. */
  protected readonly provincias = computed(() => {
    const d = this.datos();
    const nombres = d?.meta.provincias;
    if (!d || !nombres || nombres.length < 2) return null;
    const m = this.mes();
    const series = d.totales.porProvincia[this.medida()];
    const total = series.reduce((s, serie) => s + serie[m], 0);
    if (total <= 0) return null;
    return nombres
      .map((nombre, i) => ({ nombre, porcentaje: (series[i][m] / total) * 100 }))
      .filter((p) => p.porcentaje > 0)
      .sort((a, b) => b.porcentaje - a.porcentaje)
      .map((p) => ({ ...p, texto: p.porcentaje < 0.1 ? 'menos de 0,1%' : `${formato.decimal(p.porcentaje)}%` }));
  });

  /** Ranking de empresas del mes para la medida elegida. */
  protected readonly ranking = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const m = this.mes();
    const series = d.totales.porEmpresa[this.medida()];
    const total = series.reduce((s, serie) => s + serie[m], 0) || 1;
    const filas = d.meta.empresas.map((e, i) => ({
      indice: i,
      nombre: e.nombre,
      color: e.color,
      valor: series[i][m],
      participacion: (series[i][m] / total) * 100,
      esOtras: e.nombre === 'Otras',
    }));
    const ordenadas = filas
      .filter((f) => !f.esOtras && f.valor > 0)
      .sort((a, b) => b.valor - a.valor)
      .concat(filas.filter((f) => f.esOtras && f.valor > 0));
    const max = Math.max(...ordenadas.map((f) => f.valor), 1);
    return ordenadas.map((f) => ({ ...f, ancho: (f.valor / max) * 100 }));
  });

  protected readonly trayectoriaSeleccionada = computed(() => {
    const s = this.seleccionado();
    return s === null ? null : (this.trayectorias.datos()?.porPozo.get(s) ?? null);
  });

  protected readonly descripcionMapa = computed(() => {
    const d = this.datos();
    const i = this.indicadores();
    if (!d || !i) return 'Mapa 3D de pozos';
    if (this.vista() === 'subsuelo') return 'Vista 3D bajo tierra con el recorrido de los pozos de Vaca Muerta.';
    const t = d.totales.total;
    return (
      `Mapa 3D de pozos de Vaca Muerta en ${this.textoMes()}: ${formato.entero(i.activos)} pozos produciendo, ` +
      `${formato.entero(t.petroleo[this.mes()])} barriles de petróleo por día y ` +
      `${formato.gasMillones(t.gas[this.mes()])} millones de metros cúbicos de gas por día.`
    );
  });

  protected valorRanking(v: number): string {
    return MEDIDA_INFO[this.medida()].corto(v);
  }

  protected elegirPozo(i: number | null): void {
    this.seleccionado.set(i);
  }

  protected irAResultado(r: Resultado): void {
    if (r.tipo === 'pozo') {
      this.seleccionado.set(r.indice);
      this.empresaResaltada.set(null);
      this.mapa()?.volarA(r.lon, r.lat, 12);
    } else {
      this.mapa()?.volarA(r.lon, r.lat, 10.5);
    }
  }

  protected irAMes(m: number): void {
    this.mes.set(m);
    if (this.reproduciendo() && m >= this.ultimoMes()) this.detener();
  }

  protected alternarReproduccion(): void {
    if (this.reproduciendo()) {
      this.detener();
      return;
    }
    if (this.mes() >= this.ultimoMes()) this.mes.set(0);
    this.reproduciendo.set(true);
    this.programar();
  }

  protected cambiarVelocidad(): void {
    this.velocidad.set((this.velocidad() + 1) % VELOCIDADES.length);
    if (this.reproduciendo()) this.programar();
  }

  private programar(): void {
    clearInterval(this.temporizador);
    this.temporizador = setInterval(() => {
      const siguiente = this.mes() + 1;
      if (siguiente > this.ultimoMes()) {
        this.detener();
      } else {
        this.mes.set(siguiente);
      }
    }, VELOCIDADES[this.velocidad()].ms);
  }

  private detener(): void {
    clearInterval(this.temporizador);
    this.reproduciendo.set(false);
  }

  protected resaltar(i: number): void {
    this.empresaResaltada.set(this.empresaResaltada() === i ? null : i);
  }

  protected recentrar(): void {
    this.mapa()?.recentrar();
  }
}
