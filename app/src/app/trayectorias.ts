import { bajarBinario } from './binario';
import { Injectable, signal } from '@angular/core';
import { Datos } from './datos';

/** Recorrido de un pozo bajo tierra. */
export interface Trayectoria {
  id: string;
  /** Índice del pozo en Datos.pozos, o -1 si no tiene producción cargada. */
  pozo: number;
  nombre: string;
  empresa: number;
  /** Largo de la rama horizontal, en metros. */
  rama: number;
  /** Profundidad vertical máxima, en metros. */
  profundidad: number;
  /** Puntos [lon, lat, z]; z en metros, negativa hacia abajo. */
  camino: [number, number, number][];
}

export interface DatosTrayectorias {
  cantidad: number;
  ramaPromedio: number;
  profundidadPromedio: number;
  ramaMaxima: number;
  lista: Trayectoria[];
  /** Por índice de pozo, para buscar la trayectoria de un pozo elegido. */
  porPozo: Map<number, Trayectoria>;
}

interface Archivo {
  cantidad: number;
  ramaPromedio: number;
  profundidadPromedio: number;
  ramaMaxima: number;
  empresas: string[];
  columnas: string[];
  pozos: [string, string, string, number, number, number, number][];
}

/** Carga perezosa de public/data/trayectorias.json y .bin, generados por pipeline/procesar_trayectorias.py. */
@Injectable({ providedIn: 'root' })
export class TrayectoriasService {
  readonly estado = signal<'sin-pedir' | 'cargando' | 'falta' | 'listo'>('sin-pedir');
  readonly datos = signal<DatosTrayectorias | null>(null);

  async cargar(base: Datos): Promise<void> {
    if (this.estado() !== 'sin-pedir') return;
    this.estado.set('cargando');
    try {
      const r = await fetch('data/trayectorias.json');
      const tipo = r.headers.get('content-type') ?? '';
      if (!r.ok || tipo.includes('text/html')) {
        this.estado.set('falta');
        return;
      }
      const archivo = (await r.json()) as Archivo;
      const binario = await bajarBinario('data/trayectorias.bin');
      if (!binario) {
        this.estado.set('falta');
        return;
      }
      const puntos = new Float32Array(binario);

      const porId = new Map(base.pozos.map((p) => [p.id, p.indice]));
      const nombreAIndice = new Map(base.meta.empresas.map((e, i) => [e.nombre, i]));
      const otras = base.meta.empresas.length - 1;
      const lista: Trayectoria[] = archivo.pozos.map(([id, nombre, empresa, rama, profundidad, desde, cantidad]) => {
        const camino: [number, number, number][] = [];
        for (let k = 0; k < cantidad; k++) {
          const o = (desde + k) * 3;
          camino.push([puntos[o], puntos[o + 1], puntos[o + 2]]);
        }
        const pozo = porId.get(id) ?? -1;
        return {
          id,
          pozo,
          nombre,
          empresa: pozo >= 0 ? base.pozos[pozo].empresa : (nombreAIndice.get(empresa) ?? otras),
          rama,
          profundidad,
          camino,
        };
      });
      this.datos.set({
        cantidad: archivo.cantidad,
        ramaPromedio: archivo.ramaPromedio,
        profundidadPromedio: archivo.profundidadPromedio,
        ramaMaxima: archivo.ramaMaxima,
        lista,
        porPozo: new Map(lista.filter((t) => t.pozo >= 0).map((t) => [t.pozo, t])),
      });
      this.estado.set('listo');
    } catch {
      this.estado.set('falta');
    }
  }
}
