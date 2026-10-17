"""Convierte los CSV oficiales del Capítulo IV en los datos que usa la app.

Uso típico (desde la carpeta vaca-muerta-3d):

    python pipeline/procesar_capitulo_iv.py datos/no-convencional.csv --padron datos/pozos.csv --desde 2011-01

O, para bajar los archivos de la Secretaría de Energía antes de procesar:

    python pipeline/procesar_capitulo_iv.py --descargar --desde 2011-01

Opciones:
    --padron      CSV "Capítulo IV - Pozos": suma estado, profundidad, fechas de
                  perforación y los pozos que nunca produjeron
    --desde       primer mes a incluir, formato AAAA-MM
    --alcance     vaca-muerta (por defecto) | no-convencional | todo
    --salida      carpeta de salida (por defecto app/public/data)
    --descargar   baja los archivos listados en pipeline/fuentes.json a datos/

Fuente: Secretaría de Energía, "Producción de Petróleo y Gas por Pozo (Capítulo IV)",
https://datos.gob.ar/dataset/energia-produccion-petroleo-gas-por-pozo-capitulo-iv

Unidades de origen: prod_pet y prod_agua en m3 por mes, prod_gas en miles de m3 por mes.
Se convierten a barriles por día, miles de m3 por día y m3 por día.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import unicodedata
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from formato import MAX_EMPRESAS_CON_NOMBRE, dias_del_mes, escribir_salida  # noqa: E402

M3_A_BARRILES = 6.28981
GAS_A_BOE = 6.29  # miles de m3 de gas -> barriles equivalentes (aprox.)
CARPETA = Path(__file__).resolve().parent

# Nombre canónico -> nombres posibles en los distintos archivos publicados.
ALIAS = {
    "idpozo": ["idpozo", "id_pozo"],
    "pozo": ["sigla", "pozo", "nombre_pozo"],
    "anio": ["anio", "ano", "year"],
    "mes": ["mes", "month"],
    "prod_pet": ["prod_pet", "produccion_petroleo"],
    "prod_gas": ["prod_gas", "produccion_gas"],
    "prod_agua": ["prod_agua", "produccion_agua"],
    "empresa": ["empresa", "empresa_informante", "operador"],
    "area": ["areayacimiento", "area_yacimiento", "yacimiento", "areapermisoconcesion", "area"],
    "formacion": ["formacion", "formprod", "formacion_productiva"],
    "recurso": ["tipo_de_recurso", "tipo_recurso", "tiporecurso"],
    "tipopozo": ["tipopozo", "tipo_pozo"],
    "tipoestado": ["tipoestado", "estado"],
    "profundidad": ["profundidad"],
    "inicio_perf": ["adjiv_fecha_inicio_perf", "fecha_inicio_perf"],
    "fin_term": ["adjiv_fecha_fin_term", "fecha_fin_term"],
    "fin_perf": ["adjiv_fecha_fin_perf", "fecha_fin_perf"],
    "x": ["coordenadax", "coordenada_x", "longitud", "lon"],
    "y": ["coordenaday", "coordenada_y", "latitud", "lat"],
    "geojson": ["geojson"],
    "provincia": ["provincia"],
}
OBLIGATORIAS = ["idpozo", "anio", "mes", "prod_pet", "prod_gas", "empresa"]

# La misma empresa aparece con distintos nombres según el año (cambios de razón social).
EMPRESAS_UNIFICADAS = {
    "VISTA OIL & GAS ARGENTINA SAU": "VISTA ENERGY ARGENTINA SAU",
    "VISTA OIL & GAS ARGENTINA SA": "VISTA ENERGY ARGENTINA SAU",
    "PLUSPETROL CUENCA NEUQUINA S.R.L.": "PLUSPETROL S.A.",
    "PAN AMERICAN ENERGY (SUCURSAL ARGENTINA) LLC": "PAN AMERICAN ENERGY SL",
    "GEOPARK ARGENTINA LTD. (SUCURSAL ARGENTINA)": "GEOPARK ARGENTINA S.A.",
    "WINTERSHALL ENERGIA S.A.": "WINTERSHALL DEA ARGENTINA S.A",
}
# Nombres cortos para mostrar.
NOMBRES_CORTOS = {
    "YPF S.A.": "YPF",
    "VISTA ENERGY ARGENTINA SAU": "Vista",
    "SHELL ARGENTINA S.A.": "Shell",
    "PAN AMERICAN ENERGY SL": "Pan American Energy",
    "PLUSPETROL S.A.": "Pluspetrol",
    "TECPETROL S.A.": "Tecpetrol",
    "PAMPA ENERGIA S.A.": "Pampa Energía",
    "TOTAL AUSTRAL S.A.": "TotalEnergies",
    "EXXONMOBIL EXPLORATION ARGENTINA S.R.L.": "ExxonMobil",
    "CHEVRON ARGENTINA S.R.L.": "Chevron",
    "CAPEX S.A.": "Capex",
    "KILWER S.A.": "Kilwer",
    "O&G DEVELOPMENTS LTD S.A.": "O&G Developments",
    "GAS Y PETROLEO DEL NEUQUEN S.A.": "GyP Neuquén",
    "PHOENIX GLOBAL RESOURCES S.A.": "Phoenix",
    "YSUR ENERGÍA ARGENTINA S.R.L.": "YSUR",
    "PETROLERA ENTRE LOMAS S.A.": "Petrolera Entre Lomas",
    "WINTERSHALL DEA ARGENTINA S.A": "Wintershall Dea",
    "GEOPARK ARGENTINA S.A.": "GeoPark",
}

# El archivo escribe algunas provincias sin tilde.
PROVINCIAS_CON_TILDE = {"neuquen": "Neuquén", "rio_negro": "Río Negro", "mendoza": "Mendoza", "la_pampa": "La Pampa"}

ESTADO_ACTIVO = {"extraccion efectiva", "otras situacion activo", "en estudio", "en inyeccion efectiva"}
ESTADO_ABANDONADO = {"abandonado", "a abandonar"}


def normalizar(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode()
    return texto.strip().lower().replace(" ", "_")


def leer_csv(ruta: Path, obligatorias: list[str]) -> pd.DataFrame:
    """Lee un CSV detectando separador y codificación, y renombra columnas al nombre canónico."""
    with open(ruta, "rb") as f:
        cabecera = f.readline()
    separador = ";" if cabecera.count(b";") > cabecera.count(b",") else ","

    conocidas = {p for posibles in ALIAS.values() for p in posibles}
    for codificacion in ("utf-8-sig", "latin-1"):
        try:
            df = pd.read_csv(
                ruta, sep=separador, encoding=codificacion,
                usecols=lambda c: normalizar(c) in conocidas, low_memory=False,
            )
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover
        raise SystemExit(f"No pude leer {ruta} ni en UTF-8 ni en Latin-1")

    # Si hay varias columnas candidatas para el mismo dato, gana la primera de ALIAS.
    por_normal = {normalizar(c): c for c in df.columns}
    renombres = {}
    for canonico, posibles in ALIAS.items():
        for p in posibles:
            if p in por_normal and por_normal[p] not in renombres:
                renombres[por_normal[p]] = canonico
                break
    df = df[list(renombres)].rename(columns=renombres)

    faltan = [c for c in obligatorias if c not in df.columns]
    if faltan:
        raise SystemExit(
            f"{ruta.name}: faltan columnas obligatorias {faltan}. Columnas encontradas: {list(df.columns)}"
        )
    print(f"  {ruta.name}: {len(df):,} filas")
    return df


def es_vaca_muerta(serie: pd.Series) -> pd.Series:
    f = serie.astype(str).map(normalizar)
    return f.str.contains("vaca_muerta", na=False) | f.eq("vmut")


def filtrar_alcance(df: pd.DataFrame, alcance: str) -> pd.DataFrame:
    if alcance == "todo":
        return df
    if alcance == "vaca-muerta":
        if "formacion" not in df.columns:
            raise SystemExit("Para --alcance vaca-muerta hace falta la columna de formación. Probá con --alcance todo.")
        return df[es_vaca_muerta(df["formacion"])]
    if alcance == "no-convencional":
        if "recurso" not in df.columns:
            raise SystemExit("Para --alcance no-convencional hace falta la columna tipo_de_recurso.")
        return df[df["recurso"].astype(str).map(normalizar).str.contains("no_convencional", na=False)]
    raise SystemExit(f"Alcance desconocido: {alcance}")


def coordenadas_validas(x: pd.Series, y: pd.Series) -> pd.Series:
    """Argentina en grados decimales. Valores proyectados (p. ej. Gauss-Krüger) quedan afuera."""
    return x.between(-75, -53) & y.between(-56, -21)


def coordenadas_de_geojson(serie: pd.Series) -> tuple[pd.Series, pd.Series]:
    def punto(texto):
        try:
            c = json.loads(texto)["coordinates"]
            return float(c[0]), float(c[1])
        except (TypeError, ValueError, KeyError, IndexError):
            return np.nan, np.nan
    pares = serie.map(punto)
    return pares.map(lambda p: p[0]), pares.map(lambda p: p[1])


def empresa_canonica(nombre: str) -> str:
    n = " ".join(str(nombre).split()).upper()
    return EMPRESAS_UNIFICADAS.get(n, n)


def estado_grupo(texto: str) -> str:
    t = normalizar(texto).replace("_", " ")
    if not t or t in {"nan", "no informado"}:
        return "sin-dato"
    if t in ESTADO_ACTIVO:
        return "activo"
    if t in ESTADO_ABANDONADO or t.startswith("abandon"):
        return "abandonado"
    return "parado"


def descargar(destino: Path) -> list[Path]:
    """Baja los archivos de pipeline/fuentes.json. Devuelve las rutas descargadas."""
    config = CARPETA / "fuentes.json"
    if not config.exists():
        raise SystemExit(f"Falta {config}. Copiá fuentes.ejemplo.json como fuentes.json y completá los enlaces.")
    fuentes = json.loads(config.read_text(encoding="utf-8"))
    destino.mkdir(parents=True, exist_ok=True)
    rutas = {}
    for clave, url in fuentes.items():
        if not url or url.startswith("PEGAR"):
            print(f"  {clave}: sin enlace, lo salteo")
            continue
        ruta = destino / f"{clave}.csv"
        print(f"  Bajando {clave}...")
        with urllib.request.urlopen(url, timeout=120) as r, open(ruta, "wb") as f:
            shutil.copyfileobj(r, f)
        print(f"  {clave}: {ruta.stat().st_size / 1e6:,.0f} MB")
        rutas[clave] = ruta
    return rutas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("archivos", nargs="*", type=Path, help="CSV de producción por pozo")
    parser.add_argument("--salida", type=Path, default=Path("app/public/data"))
    parser.add_argument("--alcance", default="vaca-muerta", choices=["vaca-muerta", "no-convencional", "todo"])
    parser.add_argument("--padron", type=Path, help="CSV 'Capítulo IV - Pozos'")
    parser.add_argument("--desde", help="Primer mes a incluir, AAAA-MM")
    parser.add_argument("--descargar", action="store_true", help="Bajar los CSV de pipeline/fuentes.json")
    args = parser.parse_args()

    if args.descargar:
        print("Descargando...")
        bajados = descargar(Path("datos"))
        if "produccion" in bajados:
            args.archivos = [bajados["produccion"]]
        if "padron" in bajados and not args.padron:
            args.padron = bajados["padron"]
        if "trayectorias" in bajados:
            print("  Trayectorias bajadas: después corré pipeline/procesar_trayectorias.py datos/trayectorias.csv")

    # En Windows (PowerShell, cmd) los comodines como datos/*.csv no se expanden solos.
    archivos: list[Path] = []
    for a in args.archivos:
        if any(c in str(a) for c in "*?["):
            archivos.extend(sorted(Path().glob(str(a).replace("\\", "/"))))
        else:
            archivos.append(a)
    if not archivos:
        raise SystemExit("No encontré ningún CSV de producción. Revisá que estén en la carpeta datos/.")

    print("Leyendo producción...")
    df = pd.concat([leer_csv(r, OBLIGATORIAS) for r in archivos], ignore_index=True)
    df = filtrar_alcance(df, args.alcance)
    print(f"Filas dentro del alcance '{args.alcance}': {len(df):,}")
    if df.empty:
        raise SystemExit("No quedó ninguna fila. Revisá el alcance o los archivos.")

    for col in ("anio", "mes", "prod_pet", "prod_gas", "prod_agua"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    if "prod_agua" not in df.columns:
        df["prod_agua"] = 0.0
    df = df.dropna(subset=["anio", "mes"])
    df[["prod_pet", "prod_gas", "prod_agua"]] = df[["prod_pet", "prod_gas", "prod_agua"]].fillna(0).clip(lower=0)
    df["mes_txt"] = df["anio"].astype(int).astype(str) + "-" + df["mes"].astype(int).astype(str).str.zfill(2)
    df["empresa"] = df["empresa"].map(empresa_canonica)
    for col in ("x", "y"):
        df[col] = pd.to_numeric(df[col], errors="coerce") if col in df.columns else np.nan

    # Padrón: estado, profundidad, fechas y pozos que nunca produjeron.
    padron = None
    if args.padron:
        print("Leyendo padrón...")
        padron = leer_csv(args.padron, ["idpozo"])
        padron = padron.drop_duplicates("idpozo", keep="last").set_index("idpozo")
        if "geojson" in padron.columns:
            padron["x"], padron["y"] = coordenadas_de_geojson(padron["geojson"])
        if "empresa" in padron.columns:
            padron["empresa"] = padron["empresa"].map(empresa_canonica)

    # Una fila por pozo y mes (un pozo puede declarar varias formaciones).
    mensual = df.groupby(["idpozo", "mes_txt"], as_index=False)[["prod_pet", "prod_gas", "prod_agua"]].sum()

    # Atributos del pozo: los del registro más reciente.
    df = df.sort_values("mes_txt")
    atributos = df.groupby("idpozo").last()
    # Coordenadas: las últimas válidas de la producción; si no hay, las del padrón.
    validas = df[coordenadas_validas(df["x"], df["y"])].groupby("idpozo")[["x", "y"]].last()
    atributos[["x", "y"]] = validas.reindex(atributos.index)
    if padron is not None:
        faltan = atributos["x"].isna() & atributos.index.isin(padron.index)
        atributos.loc[faltan, ["x", "y"]] = padron.loc[atributos.index[faltan], ["x", "y"]].to_numpy()

    # Pozos del padrón en el alcance que nunca declararon producción.
    sin_produccion = pd.DataFrame()
    if padron is not None and args.alcance == "vaca-muerta" and "formacion" in padron.columns:
        sin_produccion = padron[es_vaca_muerta(padron["formacion"]) & ~padron.index.isin(atributos.index)].copy()
        sin_produccion = sin_produccion[coordenadas_validas(sin_produccion["x"], sin_produccion["y"])]
        print(f"Pozos del padrón sin producción declarada: {len(sin_produccion):,}")

    con_coord = coordenadas_validas(atributos["x"], atributos["y"])
    if (~con_coord).any():
        print(f"Aviso: {(~con_coord).sum():,} pozos sin coordenadas en grados quedan afuera del mapa.")
    atributos = atributos[con_coord]
    mensual = mensual[mensual["idpozo"].isin(atributos.index)]

    desde = args.desde or mensual["mes_txt"].min()
    meses = [p.strftime("%Y-%m") for p in pd.period_range(desde, mensual["mes_txt"].max(), freq="M")]
    indice_mes = {m: i for i, m in enumerate(meses)}
    dias = np.array([dias_del_mes(m) for m in meses], dtype=np.float64)

    ids = list(atributos.index) + list(sin_produccion.index)
    indice_pozo = {p: i for i, p in enumerate(ids)}
    forma = (len(ids), len(meses))
    petroleo, gas, agua = np.zeros(forma), np.zeros(forma), np.zeros(forma)
    # Meses anteriores a --desde: solo cuentan para saber cuándo arrancó cada pozo.
    primer_mes_real = mensual[(mensual["prod_pet"] + mensual["prod_gas"]) > 0].groupby("idpozo")["mes_txt"].min()
    dentro = mensual[mensual["mes_txt"].isin(indice_mes)]
    filas = dentro["idpozo"].map(indice_pozo).to_numpy()
    cols = dentro["mes_txt"].map(indice_mes).to_numpy()
    np.add.at(petroleo, (filas, cols), dentro["prod_pet"].to_numpy() * M3_A_BARRILES)
    np.add.at(gas, (filas, cols), dentro["prod_gas"].to_numpy())
    np.add.at(agua, (filas, cols), dentro["prod_agua"].to_numpy())
    petroleo /= dias
    gas /= dias
    agua /= dias

    # Empresas ordenadas por producción equivalente; las chicas van a "Otras".
    boe = (petroleo * dias).sum(axis=1) + (gas * dias).sum(axis=1) * GAS_A_BOE
    empresa_por_pozo = pd.concat([
        atributos["empresa"],
        sin_produccion["empresa"] if "empresa" in sin_produccion else pd.Series(dtype=str),
    ]).reindex(ids).fillna("SIN DATO")
    ranking = pd.Series(boe, index=ids).groupby(empresa_por_pozo.to_numpy()).sum().sort_values(ascending=False)
    con_nombre = list(ranking.index[:MAX_EMPRESAS_CON_NOMBRE])
    empresas = [NOMBRES_CORTOS.get(e, _titulo(e)) for e in con_nombre]
    empresas.append("Otras")
    idx_empresa = {e: i for i, e in enumerate(con_nombre)}

    def nombre_area(fila) -> str:
        valor = fila.get("area") if hasattr(fila, "get") else None
        return _titulo(valor) if isinstance(valor, str) and valor.strip() else "Sin área"

    filas_attr = [atributos.loc[p] for p in atributos.index] + [sin_produccion.loc[p] for p in sin_produccion.index]
    areas = sorted({nombre_area(f) for f in filas_attr})
    idx_area = {a: i for i, a in enumerate(areas)}

    def nombre_provincia(fila) -> str:
        valor = fila.get("provincia")
        if not isinstance(valor, str) or not valor.strip():
            return "Sin dato"
        return PROVINCIAS_CON_TILDE.get(normalizar(valor), _titulo(valor))

    provincias = sorted({nombre_provincia(f) for f in filas_attr})
    idx_provincia = {p: i for i, p in enumerate(provincias)}

    pozos = []
    for i, (pid, fila) in enumerate(zip(ids, filas_attr)):
        produce = np.nonzero((petroleo[i] > 0) | (gas[i] > 0))[0]
        tipo_txt = normalizar(fila.get("tipopozo", ""))
        if "gas" in tipo_txt:
            tipo = "gas"
        elif "petrol" in tipo_txt:
            tipo = "petroleo"
        else:
            tipo = "gas" if (gas[i] * dias).sum() * GAS_A_BOE > (petroleo[i] * dias).sum() else "petroleo"
        if len(produce):
            inicio = int(produce[0])
        elif pid in primer_mes_real.index:
            inicio = 0  # arrancó antes de --desde
        else:
            fin = str(_de_padron(padron, pid, "fin_term") or "")[:7]
            inicio = indice_mes.get(fin, len(meses) - 1 if fin > meses[-1] else 0)
        estado_txt = fila.get("tipoestado")
        if not isinstance(estado_txt, str) or not estado_txt.strip():
            estado_txt = _de_padron(padron, pid, "tipoestado")
        empresa = str(fila.get("empresa", "")).strip().upper()
        pozos.append({
            "id": str(pid),
            "nombre": str(fila.get("pozo", pid)),
            "lon": fila["x"],
            "lat": fila["y"],
            "empresa": idx_empresa.get(empresa, len(empresas) - 1),
            "area": idx_area[nombre_area(fila)],
            "provincia": idx_provincia[nombre_provincia(fila)],
            "tipo": tipo,
            "inicio": inicio,
            "estado": estado_grupo(estado_txt or ""),
            "estado_texto": str(estado_txt) if isinstance(estado_txt, str) else "",
            "profundidad": fila.get("profundidad") if pd.notna(fila.get("profundidad")) else _de_padron(padron, pid, "profundidad"),
            "inicio_perforacion": _fecha(_de_padron(padron, pid, "inicio_perf")),
            "fin_terminacion": _fecha(_de_padron(padron, pid, "fin_term")),
            "fin_perforacion": _fecha(_de_padron(padron, pid, "fin_perf")),
        })

    escribir_salida(
        args.salida,
        meses=meses, empresas=empresas, areas=areas, provincias=provincias, pozos=pozos,
        petroleo=petroleo, gas=gas, agua=agua,
        es_ejemplo=False,
        fuente="Secretaría de Energía de la Nación, Capítulo IV (datos.gob.ar)",
        alcance=args.alcance,
    )
    u = len(meses) - 1
    print(
        f"Listo: {len(pozos):,} pozos, {len(meses)} meses ({meses[0]} a {meses[-1]}).\n"
        f"Último mes: {petroleo[:, u].sum():,.0f} bbl/d de petróleo, "
        f"{gas[:, u].sum() / 1000:,.1f} millones de m3/d de gas y {agua[:, u].sum():,.0f} m3/d de agua.\n"
        f"Archivos en {args.salida.resolve()}"
    )


def _de_padron(padron: pd.DataFrame | None, pid, columna: str):
    if padron is None or columna not in padron.columns or pid not in padron.index:
        return None
    v = padron.at[pid, columna]
    return None if pd.isna(v) else v


def _fecha(v) -> str:
    t = str(v or "")[:10]
    return t if len(t) == 10 and t[4] == "-" else ""


def _titulo(texto: str) -> str:
    texto = " ".join(str(texto).split())
    siglas = {"YPF", "PAE", "SA", "S.A.", "SAU", "S.A.U.", "SL", "SRL", "S.R.L.", "CGC", "GYP", "TPN", "LLC", "LLL", "II", "III"}
    palabras = [p.upper() if p.upper() in siglas else p.capitalize() for p in texto.split()]
    return " ".join(palabras) if palabras else "Sin dato"


if __name__ == "__main__":
    main()
