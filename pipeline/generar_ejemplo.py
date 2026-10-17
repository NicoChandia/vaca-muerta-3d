"""Genera datos SINTÉTICOS con el mismo formato que el pipeline real.

Sirven solo para desarrollar y mostrar la app mientras no estén los CSV oficiales.
Empresas, áreas, pozos y caudales son inventados; la app muestra un aviso visible.

    python pipeline/generar_ejemplo.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from formato import escribir_salida  # noqa: E402

SEMILLA = 7
M3_A_BARRILES = 6.28981
MES_INICIAL = (2012, 1)
MES_FINAL = (2026, 7)

# Áreas ficticias: centro aproximado (lon, lat), si producen sobre todo gas, y peso de actividad.
AREAS = [
    ("Área Norte 1", -68.95, -38.20, False, 1.6),
    ("Área Norte 2", -68.80, -38.12, False, 1.2),
    ("Área Centro", -68.70, -38.32, False, 2.0),
    ("Área Este", -68.48, -38.30, False, 0.9),
    ("Área Meseta", -69.05, -38.40, False, 1.1),
    ("Área Lago", -68.85, -38.55, True, 1.0),
    ("Área Sur", -69.10, -38.62, True, 0.8),
    ("Área Oeste", -69.30, -38.35, True, 0.7),
    ("Área Pampa", -68.60, -38.05, False, 0.8),
    ("Área Cañadón", -69.22, -38.15, False, 0.6),
    ("Área Bajo", -68.55, -38.50, True, 0.6),
    ("Área Loma", -68.90, -37.95, False, 0.7),
]
EMPRESAS = [f"Operadora {letra}" for letra in "ABCDEFGH"] + ["Otras"]
PESO_EMPRESAS = np.array([30, 14, 11, 9, 8, 7, 6, 5, 10], dtype=float)


def meses() -> list[str]:
    salida = []
    anio, mes = MES_INICIAL
    while (anio, mes) <= MES_FINAL:
        salida.append(f"{anio}-{mes:02d}")
        mes += 1
        if mes == 13:
            anio, mes = anio + 1, 1
    return salida


def main() -> None:
    rng = np.random.default_rng(SEMILLA)
    lista_meses = meses()
    n_meses = len(lista_meses)

    # Cada área tiene empresa dominante, para que el mapa muestre "territorios".
    duenio_area = rng.choice(len(EMPRESAS), size=len(AREAS), p=PESO_EMPRESAS / PESO_EMPRESAS.sum())
    duenio_area[2] = 0  # el área más activa, de la empresa más grande

    pesos_area = np.array([a[4] for a in AREAS])
    pesos_area /= pesos_area.sum()

    pozos = []
    curvas_pet = []
    curvas_gas = []
    for j in range(n_meses):
        anios = j / 12
        # Actividad creciente con una meseta a mitad de período.
        conectados = int(rng.poisson(1.5 + 2.6 * anios + (6 if anios > 9 else 0)))
        j_restantes = n_meses - j
        quedan = conectados
        while quedan > 0:
            a = rng.choice(len(AREAS), p=pesos_area)
            nombre_area, lon, lat, es_gas, _ = AREAS[a]
            tam_pad = int(min(quedan, rng.integers(2, 7)))
            quedan -= tam_pad
            centro_lon = lon + rng.normal(0, 0.06)
            centro_lat = lat + rng.normal(0, 0.045)
            empresa = duenio_area[a] if rng.random() < 0.85 else rng.integers(0, len(EMPRESAS))
            for k in range(tam_pad):
                t = np.arange(j_restantes)
                # Productividad inicial que mejora con los años (ramas más largas, más etapas).
                mejora = 1 + 0.11 * anios
                if es_gas:
                    qi_gas = rng.lognormal(np.log(110), 0.35) * mejora  # miles de m3/d
                    qi_pet = qi_gas * rng.uniform(0.05, 0.25)
                else:
                    qi_pet = rng.lognormal(np.log(420), 0.4) * mejora  # bbl/d
                    qi_gas = qi_pet * rng.uniform(0.08, 0.16)
                d, b = rng.uniform(0.12, 0.2), rng.uniform(0.9, 1.3)
                declino = (1 + b * d * t) ** (-1 / b)
                rampa = np.minimum(1, (t + 1) / 2)
                ruido = rng.normal(1, 0.06, size=j_restantes).clip(0.7, 1.3)
                pet = np.zeros(n_meses)
                g = np.zeros(n_meses)
                pet[j:] = qi_pet * declino * rampa * ruido
                g[j:] = qi_gas * declino * rampa * ruido
                n = len(pozos) + 1
                pozos.append({
                    "id": f"EJ-{n:05d}",
                    "nombre": f"EJ.Nq.{nombre_area.split()[-1][:3].upper()}-{n}(h)",
                    "lon": centro_lon + (k - tam_pad / 2) * 0.004,
                    "lat": centro_lat + rng.normal(0, 0.0015),
                    "empresa": int(empresa),
                    "area": a,
                    "tipo": "gas" if es_gas else "petroleo",
                    "inicio": j,
                    "estado": "activo" if rng.random() < 0.86 else ("parado" if rng.random() < 0.7 else "abandonado"),
                    "estado_texto": "Ejemplo",
                    "profundidad": int(rng.uniform(2600, 3400)),
                })
                curvas_pet.append(pet)
                curvas_gas.append(g)

    petroleo = np.array(curvas_pet)
    gas = np.array(curvas_gas)
    # Agua: crece con la vida del pozo (más agua a medida que madura).
    edad = np.maximum(0, np.arange(len(lista_meses))[None, :] - np.array([p["inicio"] for p in pozos])[:, None])
    agua = (petroleo / M3_A_BARRILES + gas / 10) * (0.15 + 0.012 * edad)
    salida = Path(__file__).resolve().parents[1] / "app" / "public" / "data"
    escribir_salida(
        salida,
        meses=lista_meses,
        empresas=EMPRESAS,
        areas=[a[0] for a in AREAS],
        pozos=pozos,
        petroleo=petroleo,
        gas=gas,
        agua=agua,
        es_ejemplo=True,
        fuente="Datos sintéticos generados por pipeline/generar_ejemplo.py",
        alcance="vaca-muerta",
    )
    print(
        f"Datos de ejemplo: {len(pozos):,} pozos, {len(lista_meses)} meses. "
        f"Último mes: {petroleo[:, -1].sum():,.0f} bbl/d, {gas[:, -1].sum() / 1000:,.1f} MMm3/d."
    )


if __name__ == "__main__":
    main()
