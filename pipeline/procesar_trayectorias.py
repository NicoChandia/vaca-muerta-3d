"""Convierte las trayectorias de pozo de Vaca Muerta en datos para la vista Subsuelo.

    python pipeline/procesar_trayectorias.py extras/trayectorias.csv --padron datos/pozos.csv

Fuente: Secretaría de Energía, "Trayectorias de Pozo Vaca Muerta" (datos.gob.ar).

El archivo publica el recorrido de cada pozo visto desde arriba (sin profundidad por punto),
más la profundidad vertical y el largo de la rama horizontal. La profundidad de cada punto
se reconstruye así:
  1. desde la boca, el pozo baja vertical hasta el punto donde empieza a curvarse;
  2. a lo largo del tramo de curva desciende hasta la profundidad de aterrizaje;
  3. la rama horizontal (los últimos "largo_rama_horizontal" metros del recorrido) sigue a
     esa profundidad.
Es una aproximación: sirve para ver la forma y la escala, no para mediciones.

Se ejecuta después de procesar_capitulo_iv.py, porque usa sus empresas para los colores.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from procesar_capitulo_iv import NOMBRES_CORTOS, empresa_canonica, leer_csv  # noqa: E402

PROFUNDIDAD_VALIDA = (800, 5000)  # metros; descarta valores mal cargados
RAMA_VALIDA = (0, 8000)
RADIO_CURVA = 350  # metros de descenso dentro del tramo curvo
PASO_MINIMO = 20  # metros entre puntos guardados (simplifica el dibujo)
METROS_POR_GRADO_LAT = 111_320


def metros_entre(a, b) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    dx = (b[0] - a[0]) * METROS_POR_GRADO_LAT * math.cos(lat)
    dy = (b[1] - a[1]) * METROS_POR_GRADO_LAT
    return math.hypot(dx, dy)


def numero_valido(v, rango) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if rango[0] < f < rango[1] else None


def reconstruir(xy: list[list[float]], profundidad: float, rama: float) -> list[tuple[float, float, float]]:
    """Agrega profundidad a un recorrido 2D. Devuelve puntos (lon, lat, z) con z negativa."""
    # Distancia horizontal acumulada.
    acum = [0.0]
    for a, b in zip(xy, xy[1:]):
        acum.append(acum[-1] + metros_entre(a, b))
    total = acum[-1]
    aterrizaje = max(0.0, total - rama)  # donde empieza la rama horizontal
    inicio_curva = max(0.0, profundidad - RADIO_CURVA)

    puntos = [(xy[0][0], xy[0][1], 0.0), (xy[0][0], xy[0][1], -inicio_curva)]
    ultimo = 0.0
    for (x, y), s in zip(xy, acum):
        if s - ultimo < PASO_MINIMO and s < total:
            continue
        ultimo = s
        if aterrizaje > 0 and s < aterrizaje:
            # Curva suave: desciende rápido al principio y se aplana al aterrizar.
            f = math.sin((s / aterrizaje) * math.pi / 2)
            z = -(inicio_curva + (profundidad - inicio_curva) * f)
        else:
            z = -profundidad
        puntos.append((x, y, z))
    return puntos


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("archivo", type=Path, help="CSV 'Trayectorias de Pozo Vaca Muerta'")
    parser.add_argument("--padron", type=Path, help="CSV 'Capítulo IV - Pozos', para la empresa de pozos sin producción")
    parser.add_argument("--datos", type=Path, default=Path("app/public/data"), help="Carpeta con wells.json y meta.json")
    args = parser.parse_args()

    meta = json.loads((args.datos / "meta.json").read_text(encoding="utf-8"))
    wells = json.loads((args.datos / "wells.json").read_text(encoding="utf-8"))
    col = {c: i for i, c in enumerate(wells["columnas"])}
    empresas = [e["nombre"] for e in meta["empresas"]]
    empresa_de_pozo = {str(f[col["id"]]): empresas[f[col["empresa"]]] for f in wells["filas"]}

    empresa_padron: dict[str, str] = {}
    if args.padron:
        padron = leer_csv(args.padron, ["idpozo"])
        if "empresa" in padron.columns:
            for pid, emp in zip(padron["idpozo"].astype(str), padron["empresa"]):
                canon = empresa_canonica(emp)
                empresa_padron[pid] = NOMBRES_CORTOS.get(canon, canon.title())

    print("Leyendo trayectorias...")
    t = pd.read_csv(args.archivo, encoding="utf-8-sig", low_memory=False)
    print(f"  {args.archivo.name}: {len(t):,} pozos")

    filas = []
    todos: list[tuple[float, float, float]] = []
    descartados = 0
    for _, r in t.iterrows():
        prof = numero_valido(r.get("pnl_tvd"), PROFUNDIDAD_VALIDA) or numero_valido(
            r.get("profundidad_vertical_mt"), PROFUNDIDAD_VALIDA
        )
        rama = numero_valido(r.get("largo_rama_horizontal_mt"), RAMA_VALIDA) or 0.0
        try:
            geo = json.loads(r["geojson"])
            lineas = geo["coordinates"] if geo["type"] == "MultiLineString" else [geo["coordinates"]]
            xy = max(lineas, key=len)
        except (TypeError, ValueError, KeyError):
            xy = []
        if prof is None or len(xy) < 2:
            descartados += 1
            continue
        puntos = reconstruir(xy, prof, rama)
        pid = str(int(r["idpo"])) if pd.notna(r["idpo"]) else ""
        empresa = empresa_de_pozo.get(pid) or empresa_padron.get(pid) or "Otras"
        if empresa not in empresas:
            empresa = "Otras"
        filas.append([pid, str(r["sigla"]), empresa, round(rama), round(prof), len(todos), len(puntos)])
        todos.extend(puntos)

    if not filas:
        raise SystemExit("No quedó ninguna trayectoria válida. Revisá el archivo.")

    ramas = np.array([f[3] for f in filas if f[3] > 0], dtype=float)
    profs = np.array([f[4] for f in filas], dtype=float)
    salida = {
        "cantidad": len(filas),
        "ramaPromedio": round(float(ramas.mean())) if len(ramas) else 0,
        "profundidadPromedio": round(float(profs.mean())),
        "ramaMaxima": round(float(ramas.max())) if len(ramas) else 0,
        "empresas": empresas,
        "columnas": ["id", "nombre", "empresa", "rama", "profundidad", "desde", "cantidad"],
        "pozos": filas,
        "nota": "Profundidad por punto reconstruida a partir de la profundidad vertical y el largo de rama declarados.",
    }
    (args.datos / "trayectorias.json").write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    np.array(todos, dtype="<f4").tofile(args.datos / "trayectorias.bin")
    print(
        f"Listo: {len(filas):,} trayectorias ({descartados:,} descartadas por datos incompletos), {len(todos):,} puntos.\n"
        f"Rama horizontal promedio: {salida['ramaPromedio']:,} m; profundidad promedio: {salida['profundidadPromedio']:,} m."
    )


if __name__ == "__main__":
    main()
