import { Injectable, computed, signal } from '@angular/core';
import { bajarBinario } from './binario';

/** Lo que genera pipeline/formato.py en public/data/meta.json */
export interface Meta {
  version: number;
  esEjemplo: boolean;
  fuente: string;
  alcance: string;
  generado: string;
  meses: string[];
  empresas: { nombre: string; color: string }[];
  areas: string[];
  /** Desde que el pipeline guarda la provincia de cada pozo. */
  provincias?: string[];
  estados?: string[];
  unidades: Record<string, string>;
  cantidadPozos: number;
}

export type Estado = 'activo' | 'parado' | 'abandonado' | 'sin-dato';

export interface Pozo {
  indice: number;
  id: string;
  nombre: string;
  lon: number;
  lat: number;
  empresa: number;
  area: number;
  esGas: boolean;
  inicio: number;
  acumPetroleoBbl: number;
  acumGasMm3: number;
  acumAguaM3: number;
  estado: Estado;
  estadoTexto: string;
  profundidad: number | null;
  inicioPerforacion: string;
  finTerminacion: string;
  finPerforacion: string;
  conProduccion: boolean;
  /** Índice en meta.provincias. */
  provincia: number;
}

export type Medida = 'petroleo' | 'gas' | 'agua';
export const MEDIDAS: Medida[] = ['petroleo', 'gas', 'agua'];

/** Totales precalculados por mes. */
export interface Totales {
  total: Record<Medida, Float64Array>;
  /** [empresa][mes] por medida */
  porEmpresa: Record<Medida, Float64Array[]>;
  /** [provincia][mes] por medida */
  porProvincia: Record<Medida, Float64Array[]>;
  activos: Uint32Array; // pozos con producción > 0
  conectados: Uint32Array; // pozos que arrancan ese mes
}

export interface Datos {
  meta: Meta;
  pozos: Pozo[];
  series: Record<Medida, Float32Array>; // [pozo * meses + mes]
  totales: Totales;
}

export interface Momento {
  mes: string;
  titulo: string;
  texto: string;
}

const RUTA = 'data/';
const ESTADOS: Estado[] = ['activo', 'parado', 'abandonado', 'sin-dato'];

@Injectable({ providedIn: 'root' })
export class DatosService {
  readonly estado = signal<'cargando' | 'listo' | 'error'>('cargando');
  readonly error = signal<string | null>(null);
  readonly datos = signal<Datos | null>(null);
  readonly momentos = signal<Momento[]>([]);
  readonly meses = computed(() => this.datos()?.meta.meses.length ?? 0);
  private iniciado = false;

  async cargar(): Promise<void> {
    if (this.iniciado) return;
    this.iniciado = true;
    try {
      const [meta, wells, petroleo, gas] = await Promise.all([
        this.json<Meta>('meta.json'),
        this.json<{ columnas: string[]; filas: unknown[][] }>('wells.json'),
        this.binario('oil.bin'),
        this.binario('gas.bin'),
      ]);
      const nMeses = meta.meses.length;
      // El agua llegó en la versión 2 del formato; con datos viejos queda en cero.
      const agua = (await this.binario('water.bin', true)) ?? new Float32Array(petroleo.length);
      if (petroleo.length !== meta.cantidadPozos * nMeses || gas.length !== petroleo.length || agua.length !== petroleo.length) {
        throw new Error('Los archivos de datos no coinciden entre sí. Volvé a correr el pipeline para regenerarlos juntos.');
      }
      const col = Object.fromEntries(wells.columnas.map((c, i) => [c, i]));
      const leer = (f: unknown[], c: string) => (c in col ? f[col[c]] : undefined);
      const pozos: Pozo[] = wells.filas.map((f, indice) => ({
        indice,
        id: String(leer(f, 'id')),
        nombre: String(leer(f, 'nombre')),
        lon: Number(leer(f, 'lon')),
        lat: Number(leer(f, 'lat')),
        empresa: Number(leer(f, 'empresa')),
        area: Number(leer(f, 'area')),
        esGas: leer(f, 'esGas') === 1,
        inicio: Number(leer(f, 'inicio')),
        acumPetroleoBbl: Number(leer(f, 'acumPetroleoBbl') ?? 0),
        acumGasMm3: Number(leer(f, 'acumGasMm3') ?? 0),
        acumAguaM3: Number(leer(f, 'acumAguaM3') ?? 0),
        estado: ESTADOS[Number(leer(f, 'estado') ?? 3)] ?? 'sin-dato',
        estadoTexto: String(leer(f, 'estadoTexto') ?? ''),
        profundidad: (leer(f, 'profundidad') as number | null) ?? null,
        inicioPerforacion: String(leer(f, 'inicioPerforacion') ?? ''),
        finTerminacion: String(leer(f, 'finTerminacion') ?? ''),
        finPerforacion: String(leer(f, 'finPerforacion') ?? ''),
        conProduccion: leer(f, 'conProduccion') === undefined ? true : leer(f, 'conProduccion') === 1,
        provincia: Number(leer(f, 'provincia') ?? 0),
      }));
      const series = { petroleo, gas, agua };
      const totales = calcularTotales(meta, pozos, series);
      this.datos.set({ meta, pozos, series, totales });
      this.estado.set('listo');
      this.cargarMomentos();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      this.estado.set('error');
    }
  }

  private async cargarMomentos(): Promise<void> {
    try {
      const r = await fetch('momentos.json');
      if (r.ok) this.momentos.set(await r.json());
    } catch {
      // Sin momentos la línea de tiempo funciona igual.
    }
  }

  private async json<T>(nombre: string): Promise<T> {
    const r = await fetch(RUTA + nombre);
    if (!r.ok) throw new Error(`No encontré ${RUTA}${nombre}. Corré el pipeline para generar los datos.`);
    return r.json();
  }

  private async binario(nombre: string, opcional = false): Promise<Float32Array> {
    const datos = await bajarBinario(RUTA + nombre);
    if (!datos) {
      if (opcional) return null as unknown as Float32Array;
      throw new Error(`No encontré ${RUTA}${nombre}. Corré el pipeline para generar los datos.`);
    }
    return new Float32Array(datos);
  }
}

function calcularTotales(meta: Meta, pozos: Pozo[], series: Record<Medida, Float32Array>): Totales {
  const n = meta.meses.length;
  const e = meta.empresas.length;
  const nueva = () => new Float64Array(n);
  const porEmp = () => Array.from({ length: e }, nueva);
  const porProv = () => Array.from({ length: meta.provincias?.length ?? 1 }, nueva);
  const t: Totales = {
    total: { petroleo: nueva(), gas: nueva(), agua: nueva() },
    porEmpresa: { petroleo: porEmp(), gas: porEmp(), agua: porEmp() },
    porProvincia: { petroleo: porProv(), gas: porProv(), agua: porProv() },
    activos: new Uint32Array(n),
    conectados: new Uint32Array(n),
  };
  const { petroleo: pet, gas, agua } = series;
  for (const p of pozos) {
    const base = p.indice * n;
    if (p.conProduccion && p.inicio > 0) t.conectados[p.inicio]++;
    const pe = t.porEmpresa.petroleo[p.empresa];
    const ge = t.porEmpresa.gas[p.empresa];
    const ae = t.porEmpresa.agua[p.empresa];
    const pp = t.porProvincia.petroleo[p.provincia] ?? t.porProvincia.petroleo[0];
    const gp = t.porProvincia.gas[p.provincia] ?? t.porProvincia.gas[0];
    const ap = t.porProvincia.agua[p.provincia] ?? t.porProvincia.agua[0];
    for (let m = 0; m < n; m++) {
      const o = pet[base + m];
      const g = gas[base + m];
      const w = agua[base + m];
      if (o > 0 || g > 0) t.activos[m]++;
      t.total.petroleo[m] += o;
      t.total.gas[m] += g;
      t.total.agua[m] += w;
      pe[m] += o;
      ge[m] += g;
      ae[m] += w;
      pp[m] += o;
      gp[m] += g;
      ap[m] += w;
    }
  }
  return t;
}

export function valorPozo(d: Datos, medida: Medida, pozo: number, mes: number): number {
  return d.series[medida][pozo * d.meta.meses.length + mes];
}

export function produce(d: Datos, pozo: number, mes: number): boolean {
  const i = pozo * d.meta.meses.length + mes;
  return d.series.petroleo[i] + d.series.gas[i] > 0;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function nombreMes(aaaamm: string, corto = false): string {
  const [a, m] = aaaamm.split('-').map(Number);
  const nombre = MESES[m - 1];
  return corto ? `${nombre.slice(0, 3)} ${a}` : `${nombre} ${a}`;
}

export function fechaLarga(aaaammdd: string): string {
  if (!aaaammdd) return 'Sin dato';
  const [a, m, d] = aaaammdd.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

const fmt0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formato = {
  entero: (v: number) => fmt0.format(v),
  decimal: (v: number) => fmt1.format(v),
  /** Gas: miles de m3/d -> millones de m3/d */
  gasMillones: (milesM3: number) => fmt1.format(milesM3 / 1000),
  variacion: (v: number) => `${v >= 0 ? '+' : '−'}${fmt1.format(Math.abs(v))}%`,
};

/** Textos y formatos por medida, para no repetir condicionales en las vistas. */
export const MEDIDA_INFO: Record<
  Medida,
  { nombre: string; total: (v: number) => string; unidadTotal: string; corto: (v: number) => string; pozo: (v: number) => string }
> = {
  petroleo: {
    nombre: 'Petróleo',
    total: (v) => formato.entero(v),
    unidadTotal: 'barriles por día',
    corto: (v) => `${formato.entero(v)} bbl/d`,
    pozo: (v) => `${formato.entero(v)} bbl/d`,
  },
  gas: {
    nombre: 'Gas',
    total: (v) => formato.gasMillones(v),
    unidadTotal: 'millones de m³ por día',
    corto: (v) => `${formato.gasMillones(v)} MMm³/d`,
    pozo: (v) => `${formato.decimal(v)} mil m³/d`,
  },
  agua: {
    nombre: 'Agua',
    total: (v) => formato.entero(v),
    unidadTotal: 'm³ por día',
    corto: (v) => `${formato.entero(v)} m³/d`,
    pozo: (v) => `${formato.entero(v)} m³/d`,
  },
};

export const ESTADO_TEXTO: Record<Estado, string> = {
  activo: 'En producción',
  parado: 'Parado',
  abandonado: 'Abandonado',
  'sin-dato': 'Sin dato',
};

export function hexARgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Quita acentos y pasa a minúsculas, para buscar. */
export function simplificar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Días del mes AAAA-MM. */
export function dias(aaaamm: string): number {
  const [a, m] = aaaamm.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}
