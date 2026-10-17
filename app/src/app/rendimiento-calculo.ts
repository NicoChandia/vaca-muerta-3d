import { Datos, dias } from './datos';
import { DatosTrayectorias } from './trayectorias';

export type Fluido = 'petroleo' | 'gas';

export interface Cohorte {
  anio: number;
  n: number;
  /** Producción del primer año por pozo: mediana, cuartil 1 y cuartil 3. */
  mediana: number;
  p25: number;
  p75: number;
  /** Porcentaje de pozos horizontales (la sigla termina en "(h)"). */
  horizontales: number;
}

export interface Curva {
  anio: number;
  /** Caudal mediano (por día) en cada mes desde el arranque; null si hay pocos pozos. */
  valores: (number | null)[];
}

export interface PorEmpresa {
  empresa: number;
  nombre: string;
  color: string;
  n: number;
  mediana: number;
}

export interface Destacado {
  indice: number;
  id: string;
  nombre: string;
  empresa: string;
  area: string;
  anio: number;
  primerAnio: number;
}

export interface Rendimiento {
  fluido: Fluido;
  cohortes: Cohorte[];
  curvas: Curva[];
  empresas: PorEmpresa[];
  aniosEmpresas: [number, number];
  destacados: Destacado[];
  pozosAnalizados: number;
}

const MESES_PRIMER_ANIO = 12;
const MESES_CURVA = 36;
const MINIMO_COHORTE = 8;
const MINIMO_PUNTO_CURVA = 10;
const MINIMO_EMPRESA = 15;

function cuantil(ordenados: number[], q: number): number {
  if (!ordenados.length) return 0;
  const pos = (ordenados.length - 1) * q;
  const base = Math.floor(pos);
  const resto = pos - base;
  const sig = ordenados[base + 1] ?? ordenados[base];
  return ordenados[base] + resto * (sig - ordenados[base]);
}

/**
 * Productividad de los pozos según el año en que arrancaron.
 * Petróleo: pozos petrolíferos, en barriles. Gas: pozos gasíferos, en miles de m³.
 * Se excluyen los pozos que ya producían en el primer mes de los datos (no se conoce su arranque).
 */
export function calcularRendimiento(d: Datos, fluido: Fluido): Rendimiento {
  const n = d.meta.meses.length;
  const serie = fluido === 'petroleo' ? d.series.petroleo : d.series.gas;
  const diasMes = d.meta.meses.map(dias);
  const elegibles = d.pozos.filter(
    (p) => p.conProduccion && p.inicio > 0 && (fluido === 'gas' ? p.esGas : !p.esGas),
  );

  const primerAnio = new Map<number, number>();
  const anioDe = (indiceMes: number) => Number(d.meta.meses[indiceMes].slice(0, 4));
  for (const p of elegibles) {
    if (p.inicio + MESES_PRIMER_ANIO > n) continue;
    let total = 0;
    const base = p.indice * n;
    for (let k = 0; k < MESES_PRIMER_ANIO; k++) total += serie[base + p.inicio + k] * diasMes[p.inicio + k];
    primerAnio.set(p.indice, total);
  }

  // Cohortes por año de arranque.
  const porAnio = new Map<number, number[]>();
  const horizontalesPorAnio = new Map<number, number>();
  for (const [indice, total] of primerAnio) {
    const anio = anioDe(d.pozos[indice].inicio);
    if (!porAnio.has(anio)) porAnio.set(anio, []);
    porAnio.get(anio)!.push(total);
    if (/\(h\)\s*$/i.test(d.pozos[indice].nombre)) horizontalesPorAnio.set(anio, (horizontalesPorAnio.get(anio) ?? 0) + 1);
  }
  const cohortes: Cohorte[] = [...porAnio.entries()]
    .filter(([, v]) => v.length >= MINIMO_COHORTE)
    .map(([anio, v]) => {
      const o = [...v].sort((a, b) => a - b);
      return {
        anio,
        n: o.length,
        mediana: cuantil(o, 0.5),
        p25: cuantil(o, 0.25),
        p75: cuantil(o, 0.75),
        horizontales: ((horizontalesPorAnio.get(anio) ?? 0) / o.length) * 100,
      };
    })
    .sort((a, b) => a.anio - b.anio);

  // Curvas de caudal desde el arranque, para algunos años repartidos.
  const aniosCurva = elegirAnios(
    [...new Set(elegibles.map((p) => anioDe(p.inicio)))].sort((a, b) => a - b),
    elegibles,
    anioDe,
  );
  const curvas: Curva[] = aniosCurva.map((anio) => {
    const pozos = elegibles.filter((p) => anioDe(p.inicio) === anio);
    const valores: (number | null)[] = [];
    for (let k = 0; k < MESES_CURVA; k++) {
      const v = pozos.filter((p) => p.inicio + k < n).map((p) => serie[p.indice * n + p.inicio + k]);
      if (v.length < MINIMO_PUNTO_CURVA) {
        valores.push(null);
        continue;
      }
      valores.push(cuantil(v.sort((a, b) => a - b), 0.5));
    }
    return { anio, valores };
  });

  // Empresas: pozos de los últimos tres años con primer año completo.
  const ultimo = cohortes.length ? cohortes[cohortes.length - 1].anio : 0;
  const rango: [number, number] = [ultimo - 2, ultimo];
  const porEmpresa = new Map<number, number[]>();
  for (const [indice, total] of primerAnio) {
    const p = d.pozos[indice];
    const anio = anioDe(p.inicio);
    if (anio < rango[0] || anio > rango[1]) continue;
    if (!porEmpresa.has(p.empresa)) porEmpresa.set(p.empresa, []);
    porEmpresa.get(p.empresa)!.push(total);
  }
  const empresas: PorEmpresa[] = [...porEmpresa.entries()]
    .filter(([e, v]) => v.length >= MINIMO_EMPRESA && d.meta.empresas[e]?.nombre !== 'Otras')
    .map(([e, v]) => ({
      empresa: e,
      nombre: d.meta.empresas[e].nombre,
      color: d.meta.empresas[e].color,
      n: v.length,
      mediana: cuantil([...v].sort((a, b) => a - b), 0.5),
    }))
    .sort((a, b) => b.mediana - a.mediana);

  const destacados: Destacado[] = [...primerAnio.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([indice, total]) => {
      const p = d.pozos[indice];
      return {
        indice,
        id: p.id,
        nombre: p.nombre,
        empresa: d.meta.empresas[p.empresa]?.nombre ?? '',
        area: d.meta.areas[p.area] ?? '',
        anio: anioDe(p.inicio),
        primerAnio: total,
      };
    });

  return { fluido, cohortes, curvas, empresas, aniosEmpresas: rango, destacados, pozosAnalizados: primerAnio.size };
}

/** Hasta cinco años repartidos, entre los que tienen suficientes pozos. */
function elegirAnios(anios: number[], pozos: { inicio: number }[], anioDe: (m: number) => number): number[] {
  const conPozos = anios.filter((a) => pozos.filter((p) => anioDe(p.inicio) === a).length >= MINIMO_PUNTO_CURVA * 2);
  if (conPozos.length <= 5) return conPozos;
  const salida: number[] = [];
  for (let i = 0; i < 5; i++) salida.push(conPozos[Math.round((i * (conPozos.length - 1)) / 4)]);
  return [...new Set(salida)];
}

export interface AnioPerforacion {
  anio: number;
  /** Pozos horizontales que empezaron a perforarse ese año. */
  n: number;
  /** Días de calendario entre el inicio y el fin de la perforación (mediana). */
  dias: number | null;
  /** Largo de la rama horizontal (mediana, metros); null si no hay trayectorias. */
  rama: number | null;
  nRama: number;
}

const MINIMO_ANIO_PERFORACION = 15;

/** Cómo cambiaron los pozos horizontales según el año en que se empezaron a perforar. */
export function calcularPerforacion(d: Datos, t: DatosTrayectorias | null): AnioPerforacion[] {
  const porAnio = new Map<number, { dias: number[]; ramas: number[]; n: number }>();
  const ultimoAnio = Number(d.meta.meses[d.meta.meses.length - 1].slice(0, 4));
  for (const p of d.pozos) {
    if (!/\(h\)\s*$/i.test(p.nombre) || !p.inicioPerforacion) continue;
    const anio = Number(p.inicioPerforacion.slice(0, 4));
    // El año en curso queda afuera: está incompleto.
    if (anio < 2010 || anio >= ultimoAnio) continue;
    const a = porAnio.get(anio) ?? { dias: [], ramas: [], n: 0 };
    a.n++;
    if (p.finPerforacion) {
      const dd = (Date.parse(p.finPerforacion) - Date.parse(p.inicioPerforacion)) / 86_400_000;
      if (dd > 0 && dd < 400) a.dias.push(dd);
    }
    const rama = t?.porPozo.get(p.indice)?.rama;
    if (rama && rama > 0) a.ramas.push(rama);
    porAnio.set(anio, a);
  }
  const mediana = (v: number[]) => (v.length ? cuantil([...v].sort((x, y) => x - y), 0.5) : null);
  return [...porAnio.entries()]
    .filter(([, a]) => a.n >= MINIMO_ANIO_PERFORACION)
    .map(([anio, a]) => ({
      anio,
      n: a.n,
      dias: a.dias.length >= MINIMO_ANIO_PERFORACION ? mediana(a.dias) : null,
      rama: a.ramas.length >= MINIMO_ANIO_PERFORACION ? mediana(a.ramas) : null,
      nRama: a.ramas.length,
    }))
    .filter((a) => a.dias !== null && (a.rama !== null || !t))
    .sort((x, y) => x.anio - y.anio);
}
