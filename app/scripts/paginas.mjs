/**
 * Después de `ng build`, genera una página HTML por sección (que-es, produccion, subsuelo,
 * rendimiento) con su título, descripción y un resumen en texto con las cifras actuales.
 *
 * Es para Google y para quien no tiene JavaScript: el contenido ya viene escrito en el HTML.
 * La app de Angular es la misma en todas: al cargar, reemplaza ese texto por la versión
 * interactiva. No cambia nada del funcionamiento de la página.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITIO = 'https://vaca-muerta-3d.vercel.app';
const SALIDA = 'dist/app/browser';
const DATOS = join(SALIDA, 'data');

const plantilla = readFileSync(join(SALIDA, 'index.html'), 'utf8');
const leerJson = (n) => JSON.parse(readFileSync(join(DATOS, n), 'utf8'));
const leerSerie = (n) => {
  const b = readFileSync(join(DATOS, n));
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};

// ---------- Cifras del último mes ----------
const meta = leerJson('meta.json');
const wells = leerJson('wells.json');
const tray = leerJson('trayectorias.json');
const n = meta.meses.length;
const u = n - 1;
const pet = leerSerie('oil.bin');
const gas = leerSerie('gas.bin');
const iEmpresa = wells.columnas.indexOf('empresa');

let petroleo = 0, gasTotal = 0, activos = 0;
const porEmpresa = new Map();
wells.filas.forEach((f, i) => {
  const o = pet[i * n + u], g = gas[i * n + u];
  petroleo += o;
  gasTotal += g;
  if (o > 0 || g > 0) activos++;
  const e = meta.empresas[f[iEmpresa]]?.nombre ?? 'Otras';
  porEmpresa.set(e, (porEmpresa.get(e) ?? 0) + o);
});
const ranking = [...porEmpresa].filter(([e]) => e !== 'Otras').sort((a, b) => b[1] - a[1]).slice(0, 5);

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const [anio, mes] = meta.meses[u].split('-').map(Number);
const mesTexto = `${MESES[mes - 1]} de ${anio}`;
const c = {
  mes: mesTexto,
  petroleo: nf.format(petroleo),
  gas: nf1.format(gasTotal / 1000),
  activos: nf.format(activos),
  pozos: nf.format(meta.cantidadPozos),
  trayectorias: nf.format(tray.cantidad),
  profundidad: nf.format(tray.profundidadPromedio),
  rama: nf.format(tray.ramaPromedio),
  ramaMax: nf.format(tray.ramaMaxima),
  desde: meta.meses[0].slice(0, 4),
};

// ---------- Contenido de cada sección ----------
const enlaces = `
      <nav aria-label="Secciones">
        <ul>
          <li><a href="/que-es">Qué es Vaca Muerta, en 6 pasos</a></li>
          <li><a href="/produccion">Producción pozo por pozo</a></li>
          <li><a href="/subsuelo">Los pozos bajo tierra</a></li>
          <li><a href="/rendimiento">Rendimiento de los pozos</a></li>
        </ul>
      </nav>`;

const paginas = [
  {
    ruta: 'que-es',
    titulo: '¿Qué es Vaca Muerta? Explicada en 6 pasos con datos reales',
    descripcion:
      'Qué es Vaca Muerta, por qué se llama así, cómo se extrae el petróleo con fractura hidráulica y por qué la producción no deja de crecer. Paso a paso y con datos oficiales.',
    cuerpo: `
      <h1>¿Qué es Vaca Muerta?</h1>
      <h2>Una roca a 3 kilómetros de profundidad</h2>
      <p>Vaca Muerta es una capa de roca que se formó en el fondo de un mar hace unos 150 millones de años. Ocupa unos 30.000 km², sobre todo en Neuquén, y está a unos ${c.profundidad} metros de profundidad. El petróleo y el gas están atrapados en poros diminutos de esa roca: por eso se la llama "no convencional".</p>
      <p>¿Por qué se llama Vaca Muerta? El nombre viene de la sierra de la Vaca Muerta, cerca de Zapala, donde el geólogo Charles Weaver describió la formación en 1931. En geología, cada formación lleva el nombre del lugar donde se la encontró.</p>
      <h2>Pozos que bajan y doblan</h2>
      <p>Cada pozo baja en vertical hasta la formación y ahí dobla para correr en horizontal dentro de la roca. La rama horizontal típica mide ${c.rama} metros, y la más larga publicada, ${c.ramaMax} metros.</p>
      <h2>Fracturar la roca</h2>
      <p>Con la rama terminada, se bombea agua con arena a muy alta presión, tramo por tramo. Cada tramo es una etapa de fractura: la roca se fisura y la arena mantiene abiertas las grietas para que el petróleo y el gas fluyan hacia el pozo.</p>
      <h2>Mucho al principio, menos después</h2>
      <p>Un pozo de shale da lo mejor apenas arranca y su producción cae rápido durante el primer año.</p>
      <h2>Por eso nunca se deja de perforar</h2>
      <p>Para que la producción total crezca hay que conectar pozos nuevos todo el tiempo. En ${c.mes}, Vaca Muerta produjo ${c.petroleo} barriles de petróleo por día.</p>
      <h2>Ahora, explorá</h2>
      <p>Recorré la producción de cada pozo mes a mes desde ${c.desde}, los pozos bajo tierra en 3D y cuánto rinde cada pozo nuevo.</p>`,
  },
  {
    ruta: 'produccion',
    titulo: 'Producción de Vaca Muerta pozo por pozo · Mapa 3D',
    descripcion:
      'Cuánto produce Vaca Muerta, mes a mes y pozo por pozo: petróleo, gas y agua de todos los pozos desde 2011 en un mapa 3D, con datos oficiales de la Secretaría de Energía.',
    cuerpo: `
      <h1>Producción de Vaca Muerta, pozo por pozo</h1>
      <p>En ${c.mes}, Vaca Muerta produjo <strong>${c.petroleo} barriles de petróleo por día</strong> y <strong>${c.gas} millones de m³ de gas por día</strong>, con ${c.activos} pozos en producción.</p>
      <p>El mapa 3D muestra los ${c.pozos} pozos de la formación con su producción mensual de petróleo, gas y agua desde ${c.desde}. Cada columna es un pozo y su altura es lo que produjo en el mes.</p>
      <h2>Quién produce más</h2>
      <ol>${ranking.map(([e, v]) => `<li>${e}: ${nf.format(v)} barriles por día</li>`).join('')}</ol>`,
  },
  {
    ruta: 'subsuelo',
    titulo: 'Vaca Muerta bajo tierra: el recorrido 3D de cada pozo',
    descripcion:
      'Cómo son los pozos de Vaca Muerta: bajan casi 3.000 metros y doblan en horizontal dentro de la roca. El recorrido en 3D de más de 2.000 pozos, con datos públicos.',
    cuerpo: `
      <h1>Vaca Muerta, bajo tierra</h1>
      <p>El recorrido en 3D de ${c.trayectorias} pozos de Vaca Muerta. Cada pozo baja en vertical hasta la formación, a unos ${c.profundidad} metros de profundidad en promedio, y la atraviesa en horizontal.</p>
      <p>La rama horizontal promedio mide ${c.rama} metros y la más larga, ${c.ramaMax} metros.</p>`,
  },
  {
    ruta: 'rendimiento',
    titulo: 'Rendimiento de los pozos de Vaca Muerta: cuánto produce cada pozo',
    descripcion:
      'Cuánto petróleo y gas produce un pozo de Vaca Muerta en su primer año, cómo cae su producción, cuánto se tarda en perforarlo y qué empresas tienen los pozos más productivos.',
    cuerpo: `
      <h1>¿Los pozos nuevos de Vaca Muerta rinden más?</h1>
      <p>La producción del primer año de cada pozo, según el año en que arrancó; cómo cae la producción desde el arranque; el largo de la rama horizontal y los días de perforación; qué empresas tienen los pozos más productivos, y los diez pozos que más produjeron en su primer año.</p>`,
  },
];

// ---------- Armado de cada página ----------
const reemplazarMeta = (html, atributo, nombre, valor) =>
  html.replace(new RegExp(`(<meta ${atributo}="${nombre}" content=")[^"]*(")`), `$1${valor}$2`);

for (const p of paginas) {
  const url = `${SITIO}/${p.ruta}`;
  let html = plantilla.replace(/<title>[^<]*<\/title>/, `<title>${p.titulo}</title>`);
  html = reemplazarMeta(html, 'name', 'description', p.descripcion);
  html = reemplazarMeta(html, 'property', 'og:title', p.titulo);
  html = reemplazarMeta(html, 'property', 'og:description', p.descripcion);
  html = reemplazarMeta(html, 'property', 'og:url', url);
  html = html.replace('</head>', `  <link rel="canonical" href="${url}">\n</head>`);
  html = html.replace(
    /<app-root>[\s\S]*<\/app-root>/,
    `<app-root>
    <main style="max-width:680px;margin:12vh auto;padding:0 16px;font-family:system-ui,sans-serif;line-height:1.55;color:#9aa1b9">${p.cuerpo}
      <p>Datos públicos: ${meta.fuente}. Proyecto independiente, hecho por Nicolás Chandía.</p>${enlaces}
    </main>
  </app-root>`,
  );
  mkdirSync(join(SALIDA, p.ruta), { recursive: true });
  writeFileSync(join(SALIDA, p.ruta, 'index.html'), html);
  console.log(`  ${p.ruta}/index.html`);
}
console.log(`Páginas generadas con datos de ${mesTexto}.`);
