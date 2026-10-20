/**
 * Después de `ng build`, genera una página HTML por sección y por idioma (que-es, produccion,
 * subsuelo, rendimiento y sus versiones en inglés en /en/...) con su título, descripción y un
 * resumen en texto con las cifras actuales. También arma el sitemap con las dos versiones.
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

const MESES = {
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const [anio, mes] = meta.meses[u].split('-').map(Number);
const mesTexto = `${MESES.es[mes - 1]} de ${anio}`;

/** Las cifras con el formato de cada idioma (669.802 / 669,802). */
function cifras(idioma) {
  const loc = idioma === 'en' ? 'en-US' : 'es-AR';
  const nf = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 });
  return {
    nf,
    mes: idioma === 'en' ? `${MESES.en[mes - 1]} ${anio}` : mesTexto,
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
}
const c = cifras('es');
const nf = c.nf;

// ---------- Contenido de cada sección ----------
const RUTAS = {
  'que-es': { es: 'que-es', en: 'en/what-is' },
  produccion: { es: 'produccion', en: 'en/production' },
  subsuelo: { es: 'subsuelo', en: 'en/underground' },
  rendimiento: { es: 'rendimiento', en: 'en/performance' },
};

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
    seccion: 'que-es',
    idioma: 'es',
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
    seccion: 'produccion',
    idioma: 'es',
    ruta: 'produccion',
    titulo: 'Producción de Vaca Muerta pozo por pozo · Mapa 3D',
    descripcion:
      'Cuánto produce Vaca Muerta, mes a mes y pozo por pozo: petróleo, gas y agua de todos los pozos desde 2011 en un mapa 3D, con datos oficiales de la Secretaría de Energía.',
    cuerpo: `
      <h1>Producción de Vaca Muerta, pozo por pozo</h1>
      <p>En ${c.mes}, Vaca Muerta produjo <strong>${c.petroleo} barriles de petróleo por día</strong> y <strong>${c.gas} millones de m³ de gas por día</strong>, con ${c.activos} pozos en producción.</p>
      <p>El mapa 3D muestra los ${c.pozos} pozos de la formación con su producción mensual de petróleo, gas y agua desde ${c.desde}. Cada columna es un pozo y su altura es lo que produjo en el mes.</p>
      <h2>Quién produce más</h2>
      <ol>${ranking.map(([n, v]) => `<li>${n}: ${nf.format(v)} barriles por día</li>`).join('')}</ol>`,
  },
  {
    seccion: 'subsuelo',
    idioma: 'es',
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
    seccion: 'rendimiento',
    idioma: 'es',
    ruta: 'rendimiento',
    titulo: 'Rendimiento de los pozos de Vaca Muerta: cuánto produce cada pozo',
    descripcion:
      'Cuánto petróleo y gas produce un pozo de Vaca Muerta en su primer año, cómo cae su producción, cuánto se tarda en perforarlo y qué empresas tienen los pozos más productivos.',
    cuerpo: `
      <h1>¿Los pozos nuevos de Vaca Muerta rinden más?</h1>
      <p>La producción del primer año de cada pozo, según el año en que arrancó; cómo cae la producción desde el arranque; el largo de la rama horizontal y los días de perforación; qué empresas tienen los pozos más productivos, y los diez pozos que más produjeron en su primer año.</p>`,
  },
];

const e = cifras('en');
const enlacesEn = `
      <nav aria-label="Sections">
        <ul>
          <li><a href="/en/what-is">What is Vaca Muerta, in 6 steps</a></li>
          <li><a href="/en/production">Production, well by well</a></li>
          <li><a href="/en/underground">The wells underground</a></li>
          <li><a href="/en/performance">Well performance</a></li>
        </ul>
      </nav>`;

paginas.push(
  {
    seccion: 'que-es',
    idioma: 'en',
    ruta: 'en/what-is',
    titulo: 'What is Vaca Muerta? Explained in 6 steps with real data',
    descripcion:
      'What Vaca Muerta is, where the name comes from, how oil is extracted with hydraulic fracturing and why production keeps growing. Step by step, with official data.',
    cuerpo: `
      <h1>What is Vaca Muerta?</h1>
      <h2>A rock 3 kilometers down</h2>
      <p>Vaca Muerta is a layer of rock that formed at the bottom of a sea some 150 million years ago. It covers about 30,000 km², mostly in Neuquén, Argentina, and lies about ${e.profundidad} meters deep. The oil and gas are trapped in tiny pores in that rock: that is why it is called "unconventional".</p>
      <p>Where does the name come from? From the Vaca Muerta ("dead cow") range near Zapala, where geologist Charles Weaver described the formation in 1931. In geology, each formation is named after the place where it was found.</p>
      <h2>Wells that drop and turn</h2>
      <p>Each well drops vertically down to the formation and then turns to run horizontally inside the rock. The typical horizontal lateral is ${e.rama} meters long, and the longest on record, ${e.ramaMax} meters.</p>
      <h2>Fracturing the rock</h2>
      <p>Once the lateral is finished, water and sand are pumped in at very high pressure, section by section. Each section is a fracture stage: the rock cracks and the sand props the cracks open so oil and gas can flow into the well.</p>
      <h2>A lot at first, less later</h2>
      <p>A shale well gives its best right after it starts, and its production declines fast during the first year.</p>
      <h2>That is why drilling never stops</h2>
      <p>For total production to grow, new wells must be connected all the time. In ${e.mes}, Vaca Muerta produced ${e.petroleo} barrels of oil per day.</p>
      <h2>Now, explore</h2>
      <p>Explore the production of every well month by month since ${e.desde}, the wells underground in 3D and how much each new well produces.</p>`,
  },
  {
    seccion: 'produccion',
    idioma: 'en',
    ruta: 'en/production',
    titulo: 'Vaca Muerta production, well by well · 3D map',
    descripcion:
      'How much Vaca Muerta produces, month by month and well by well: oil, gas and water from every well since 2011 on a 3D map, with official data from Argentina’s Energy Secretariat.',
    cuerpo: `
      <h1>Vaca Muerta production, well by well</h1>
      <p>In ${e.mes}, Vaca Muerta produced <strong>${e.petroleo} barrels of oil per day</strong> and <strong>${e.gas} million m³ of gas per day</strong>, with ${e.activos} producing wells.</p>
      <p>The 3D map shows the ${e.pozos} wells in the formation with their monthly oil, gas and water production since ${e.desde}. Each column is a well and its height is what it produced that month.</p>
      <h2>Top producers</h2>
      <ol>${ranking.map(([n, v]) => `<li>${n}: ${e.nf.format(v)} barrels per day</li>`).join('')}</ol>`,
  },
  {
    seccion: 'subsuelo',
    idioma: 'en',
    ruta: 'en/underground',
    titulo: 'Vaca Muerta underground: the 3D path of every well',
    descripcion:
      'What Vaca Muerta wells look like: they drop almost 3,000 meters and turn horizontal inside the rock. The 3D path of more than 2,000 wells, from public data.',
    cuerpo: `
      <h1>Vaca Muerta, underground</h1>
      <p>The 3D path of ${e.trayectorias} Vaca Muerta wells. Each well drops vertically down to the formation, about ${e.profundidad} meters deep on average, and runs through it horizontally.</p>
      <p>The average horizontal lateral is ${e.rama} meters long and the longest, ${e.ramaMax} meters.</p>`,
  },
  {
    seccion: 'rendimiento',
    idioma: 'en',
    ruta: 'en/performance',
    titulo: 'Vaca Muerta well performance: how much each well produces',
    descripcion:
      'How much oil and gas a Vaca Muerta well produces in its first year, how fast production declines, how long drilling takes and which companies have the most productive wells.',
    cuerpo: `
      <h1>Do new Vaca Muerta wells produce more?</h1>
      <p>First-year production of each well by the year it started; how production declines after start-up; horizontal lateral length and drilling days; which companies have the most productive wells, and the ten wells that produced the most in their first year.</p>`,
  },
);

// ---------- Armado de cada página ----------
const reemplazarMeta = (html, atributo, nombre, valor) =>
  html.replace(new RegExp(`(<meta ${atributo}="${nombre}" content=")[^"]*(")`), `$1${valor}$2`);

for (const p of paginas) {
  const url = `${SITIO}/${p.ruta}`;
  const en = p.idioma === 'en';
  let html = plantilla.replace(/<title>[^<]*<\/title>/, `<title>${p.titulo}</title>`);
  if (en) html = html.replace('<html lang="es-AR"', '<html lang="en"');
  html = reemplazarMeta(html, 'name', 'description', p.descripcion);
  html = reemplazarMeta(html, 'property', 'og:title', p.titulo);
  html = reemplazarMeta(html, 'property', 'og:description', p.descripcion);
  html = reemplazarMeta(html, 'property', 'og:url', url);
  if (en) html = reemplazarMeta(html, 'property', 'og:locale', 'en_US');
  // Canónica y la misma página en el otro idioma, para que Google relacione las dos versiones.
  const r = RUTAS[p.seccion];
  html = html.replace(
    '</head>',
    `  <link rel="canonical" href="${url}">
  <link rel="alternate" hreflang="es" href="${SITIO}/${r.es}">
  <link rel="alternate" hreflang="en" href="${SITIO}/${r.en}">
  <link rel="alternate" hreflang="x-default" href="${SITIO}/${r.es}">
</head>`,
  );
  const pie = en
    ? `<p>Public data: Argentina’s Energy Secretariat, Capítulo IV dataset (datos.gob.ar). Independent project by Nicolás Chandía.</p>${enlacesEn}`
    : `<p>Datos públicos: ${meta.fuente}. Proyecto independiente, hecho por Nicolás Chandía.</p>${enlaces}`;
  html = html.replace(
    /<app-root>[\s\S]*<\/app-root>/,
    `<app-root>
    <main style="max-width:680px;margin:12vh auto;padding:0 16px;font-family:system-ui,sans-serif;line-height:1.55;color:#9aa1b9">${p.cuerpo}
      ${pie}
    </main>
  </app-root>`,
  );
  mkdirSync(join(SALIDA, p.ruta), { recursive: true });
  writeFileSync(join(SALIDA, p.ruta, 'index.html'), html);
  console.log(`  ${p.ruta}/index.html`);
}

// Sitemap con las dos versiones de cada sección.
const hoy = new Date().toISOString().slice(0, 10);
const urls = paginas
  .map((p) => {
    const r = RUTAS[p.seccion];
    return `  <url>
    <loc>${SITIO}/${p.ruta}</loc>
    <lastmod>${hoy}</lastmod>
    <changefreq>monthly</changefreq>
    <xhtml:link rel="alternate" hreflang="es" href="${SITIO}/${r.es}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${SITIO}/${r.en}"/>
  </url>`;
  })
  .join('\n');
writeFileSync(
  join(SALIDA, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`,
);
console.log(`  sitemap.xml (${paginas.length} direcciones)`);
console.log(`Páginas generadas con datos de ${mesTexto}.`);
