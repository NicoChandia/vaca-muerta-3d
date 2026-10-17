# Vaca Muerta, pozo por pozo

Sitio abierto con los datos públicos de producción de Vaca Muerta, en tres vistas:

- **Producción** (`/produccion`): mapa 3D donde cada columna es un pozo y su altura lo que produjo
  en el mes. Petróleo, gas o agua; vista por pozo o por zonas; línea de tiempo animada con momentos
  clave; buscador de pozos y áreas; pozos sin producción; ficha de cada pozo.
- **Subsuelo** (`/subsuelo`): el recorrido de cada pozo bajo tierra, con la rama horizontal dentro
  de la formación. La profundidad está exagerada 4 veces para que se lea a la escala de la cuenca.
- **Rendimiento** (`/rendimiento`): ¿los pozos nuevos rinden más? Producción del primer año según el
  año de arranque, curvas de caída, comparación por empresa y los pozos que más produjeron.

## Estructura

```
vaca-muerta-3d/
├── datos/        CSV oficiales (no se publican)
├── extras/       CSV de trayectorias
├── pipeline/
│   ├── procesar_capitulo_iv.py    producción + padrón -> app/public/data
│   ├── procesar_trayectorias.py   trayectorias -> app/public/data
│   ├── generar_ejemplo.py         datos sintéticos para probar sin descargar nada
│   ├── formato.py                 formato de salida compartido
│   └── fuentes.ejemplo.json       enlaces para la descarga automática
└── app/          Angular 21 + deck.gl + MapLibre
    ├── public/data/     archivos que genera el pipeline
    └── public/momentos.json   momentos clave de la línea de tiempo (editable)
```

## Poner en marcha

Requisitos: Node 20.19+ o 22.12+, Python 3.10+ con `pandas` y `numpy`.

```bash
cd app
npm install
npm start          # http://localhost:4200
```

## Actualizar los datos

Desde la carpeta `vaca-muerta-3d`:

```bash
pip install pandas numpy
python pipeline/procesar_capitulo_iv.py datos/no-convencional.csv --padron datos/pozos.csv --desde 2011-01
python pipeline/procesar_trayectorias.py extras/trayectorias.csv --padron datos/pozos.csv
```

El segundo comando va después del primero, porque usa las empresas que genera.

Archivos de datos.gob.ar (Secretaría de Energía):

| Archivo | Dataset | Para qué |
|---|---|---|
| Producción de Pozos de Gas y Petróleo No Convencional | Producción de petróleo y gas por pozo (Capítulo IV) | Producción mensual por pozo |
| Capítulo IV - Pozos (CSV) | el mismo | Estado, profundidad, fechas de perforación y pozos sin producción |
| Trayectorias de Pozo Vaca Muerta (CSV) | Trayectorias de Pozo Vaca Muerta | Vista Subsuelo |

Los enlaces son `http://`, y algunos navegadores bloquean la descarga. Con `curl` funciona:

```bash
curl -L -o datos/no-convencional.csv "ENLACE"
```

### Descarga automática

Copiá `pipeline/fuentes.ejemplo.json` como `pipeline/fuentes.json`, pegá los tres enlaces y corré:

```bash
python pipeline/procesar_capitulo_iv.py --descargar --desde 2011-01
python pipeline/procesar_trayectorias.py datos/trayectorias.csv --padron datos/padron.csv
```

Con eso se puede programar una actualización mensual (por ejemplo con GitHub Actions) que vuelva a
generar los datos y publique el sitio.

### Qué hace el pipeline

- Filtra la formación Vaca Muerta y suma la producción por pozo y mes.
- Petróleo de m³ a barriles por día (1 m³ = 6,28981 bbl), gas en miles de m³ por día, agua en m³ por día.
- Unifica nombres de empresas que cambiaron de razón social (por ejemplo Vista Oil & Gas y Vista Energy).
- Agrupa en "Otras" a las empresas fuera de las 8 más grandes.
- Las trayectorias se publican vistas desde arriba, sin profundidad por punto. La profundidad se
  reconstruye con la profundidad vertical y el largo de rama declarados: sirve para ver la forma y la
  escala, no para medir.

## Datos de ejemplo

Sin descargar nada: `python pipeline/generar_ejemplo.py`. La app muestra un aviso mientras sean de ejemplo.

## Mapa base

El mapa oscuro es de CARTO. Pedí una clave gratuita en https://carto.com/basemaps/apikey/ y pegala en
`app/src/app/config.ts`. El crédito "© CARTO, © OpenStreetMap contributors" es obligatorio.

## Publicar

En Vercel: Root Directory `app`, preset Angular, carpeta de salida `dist/app/browser`.
`app/vercel.json` hace que `/subsuelo` y `/rendimiento` funcionen al entrar directo.

## Créditos

- Datos: Secretaría de Energía de la Nación, vía datos.gob.ar.
- Mapa base: CARTO y OpenStreetMap.
- Visualización: deck.gl y MapLibre GL.
