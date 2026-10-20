"""Formato de salida compartido por el pipeline real y el generador de ejemplo.

La app lee estos archivos desde app/public/data/:

  meta.json   -> metadatos: meses, empresas, áreas, unidades, si son datos de ejemplo
  wells.json  -> un registro por pozo (ubicación, empresa, área, tipo, estado, fechas, acumulados)
  oil.bin     -> Float32 little-endian [pozos x meses], petróleo en barriles por día
  gas.bin     -> Float32 little-endian [pozos x meses], gas en miles de m3 por día
  water.bin   -> Float32 little-endian [pozos x meses], agua en m3 por día
  *.bin.gz    -> las mismas matrices comprimidas con gzip (la app baja estas)

Las matrices se guardan "pozo por pozo": el valor del pozo i en el mes j está en
la posición i * cantidad_de_meses + j.
"""

from __future__ import annotations

import gzip
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

# Paleta categórica para las empresas (índice 0 = la de mayor producción).
PALETA_EMPRESAS = [
    "#3987e5",  # azul
    "#d95926",  # naranja
    "#199e70",  # aguamarina
    "#c98500",  # amarillo
    "#d55181",  # magenta
    "#008300",  # verde
    "#9085e9",  # violeta
    "#e66767",  # rojo
]
# Validada para fondo oscuro (#141a33): banda de luminosidad, croma, separación
# para daltonismo entre vecinos y contraste mínimo 3:1.
COLOR_OTRAS = "#7c8296"
MAX_EMPRESAS_CON_NOMBRE = len(PALETA_EMPRESAS)

# Estado del pozo, agrupado para el mapa.
ESTADOS = ["activo", "parado", "abandonado", "sin-dato"]

COLUMNAS_POZO = [
    "id", "nombre", "lon", "lat", "empresa", "area", "esGas", "inicio",
    "acumPetroleoBbl", "acumGasMm3", "acumAguaM3",
    "estado", "estadoTexto", "profundidad", "inicioPerforacion", "finTerminacion", "conProduccion",
    "finPerforacion", "provincia",
]


def escribir_salida(
    carpeta: Path,
    *,
    meses: list[str],
    empresas: list[str],
    areas: list[str],
    pozos: list[dict],
    provincias: list[str] | None = None,
    petroleo: np.ndarray,
    gas: np.ndarray,
    agua: np.ndarray,
    es_ejemplo: bool,
    fuente: str,
    alcance: str,
) -> None:
    """Escribe los archivos que consume la app.

    pozos: lista de dicts con id, nombre, lon, lat, empresa (índice), area (índice),
           tipo ("petroleo" | "gas"), inicio (índice de mes) y, opcionales, estado,
           estado_texto, profundidad (m), inicio_perforacion, fin_terminacion (AAAA-MM-DD)
           y provincia (índice en provincias).
    petroleo, gas, agua: matrices [pozos x meses] en bbl/d, miles de m3/d y m3/d.
    """
    carpeta.mkdir(parents=True, exist_ok=True)
    n_pozos, n_meses = petroleo.shape
    assert gas.shape == petroleo.shape == agua.shape
    assert len(pozos) == n_pozos and len(meses) == n_meses

    dias = np.array([dias_del_mes(m) for m in meses], dtype=np.float64)
    acum_pet = (petroleo * dias).sum(axis=1)
    acum_gas = (gas * dias).sum(axis=1)
    acum_agua = (agua * dias).sum(axis=1)
    produjo = (petroleo + gas).sum(axis=1) > 0

    colores = [
        PALETA_EMPRESAS[i] if i < MAX_EMPRESAS_CON_NOMBRE and nombre != "Otras" else COLOR_OTRAS
        for i, nombre in enumerate(empresas)
    ]

    meta = {
        "version": 2,
        "esEjemplo": es_ejemplo,
        "fuente": fuente,
        "alcance": alcance,
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "meses": meses,
        "empresas": [{"nombre": n, "color": c} for n, c in zip(empresas, colores)],
        "areas": areas,
        "provincias": provincias or ["Neuquén"],
        "estados": ESTADOS,
        "unidades": {"petroleo": "bbl/d", "gas": "miles de m3/d", "agua": "m3/d"},
        "cantidadPozos": n_pozos,
    }
    (carpeta / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    filas = []
    for i, p in enumerate(pozos):
        estado = p.get("estado", "sin-dato")
        filas.append([
            p["id"],
            p["nombre"],
            round(float(p["lon"]), 5),
            round(float(p["lat"]), 5),
            int(p["empresa"]),
            int(p["area"]),
            1 if p["tipo"] == "gas" else 0,
            int(p["inicio"]),
            round(float(acum_pet[i])),
            round(float(acum_gas[i])),
            round(float(acum_agua[i])),
            ESTADOS.index(estado) if estado in ESTADOS else ESTADOS.index("sin-dato"),
            p.get("estado_texto") or "",
            _entero_o_nada(p.get("profundidad")),
            p.get("inicio_perforacion") or "",
            p.get("fin_terminacion") or "",
            1 if produjo[i] else 0,
            p.get("fin_perforacion") or "",
            int(p.get("provincia", 0)),
        ])
    wells = {"columnas": COLUMNAS_POZO, "filas": filas}
    (carpeta / "wells.json").write_text(json.dumps(wells, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    escribir_binario(carpeta / "oil.bin", petroleo)
    escribir_binario(carpeta / "gas.bin", gas)
    escribir_binario(carpeta / "water.bin", agua)


def escribir_binario(ruta: Path, matriz: np.ndarray) -> None:
    """Guarda la matriz como Float32 y, al lado, una copia comprimida (.gz) unas 4 veces más
    liviana, que es la que baja la app. La sin comprimir queda por si el navegador no puede
    descomprimir."""
    datos = np.ascontiguousarray(matriz, dtype="<f4").tobytes()
    ruta.write_bytes(datos)
    # mtime=0 para que el archivo no cambie si los datos son los mismos (git no lo ve modificado).
    Path(str(ruta) + ".gz").write_bytes(gzip.compress(datos, compresslevel=9, mtime=0))


def _entero_o_nada(v) -> int | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if np.isnan(f) or f <= 0 else int(round(f))


def dias_del_mes(mes: str) -> int:
    anio, m = (int(x) for x in mes.split("-"))
    siguiente = datetime(anio + 1, 1, 1) if m == 12 else datetime(anio, m + 1, 1)
    return (siguiente - datetime(anio, m, 1)).days
