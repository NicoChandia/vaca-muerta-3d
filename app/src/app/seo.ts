import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Idioma, RUTAS, idioma } from './idioma';

const SITIO = 'https://vaca-muerta-3d.vercel.app';

export type Pagina = 'produccion' | 'subsuelo' | 'que-es' | 'rendimiento';

/**
 * Título y descripción de cada sección en cada idioma, pensados para lo que la gente busca
 * en Google ("cuánto produce Vaca Muerta", "Vaca Muerta production", "mapa de pozos").
 */
export const PAGINAS: Record<Idioma, Record<Pagina, { titulo: string; descripcion: string }>> = {
  es: {
    produccion: {
      titulo: 'Producción de Vaca Muerta pozo por pozo · Mapa 3D',
      descripcion:
        'Cuánto produce Vaca Muerta, mes a mes y pozo por pozo: petróleo, gas y agua de todos los pozos desde 2011 en un mapa 3D, con datos oficiales de la Secretaría de Energía.',
    },
    subsuelo: {
      titulo: 'Vaca Muerta bajo tierra: el recorrido 3D de cada pozo',
      descripcion:
        'Cómo son los pozos de Vaca Muerta: bajan casi 3.000 metros y doblan en horizontal dentro de la roca. El recorrido en 3D de más de 2.000 pozos, con datos públicos.',
    },
    'que-es': {
      titulo: '¿Qué es Vaca Muerta? Explicada en 6 pasos con datos reales',
      descripcion:
        'Qué es Vaca Muerta, por qué se llama así, cómo se extrae el petróleo con fractura hidráulica y por qué la producción no deja de crecer. Paso a paso y con datos oficiales.',
    },
    rendimiento: {
      titulo: 'Rendimiento de los pozos de Vaca Muerta: cuánto produce cada pozo',
      descripcion:
        'Cuánto petróleo y gas produce un pozo de Vaca Muerta en su primer año, cómo cae su producción, cuánto se tarda en perforarlo y qué empresas tienen los pozos más productivos.',
    },
  },
  en: {
    produccion: {
      titulo: 'Vaca Muerta production, well by well · 3D map',
      descripcion:
        'How much Vaca Muerta produces, month by month and well by well: oil, gas and water from every well since 2011 on a 3D map, with official data from Argentina’s Energy Secretariat.',
    },
    subsuelo: {
      titulo: 'Vaca Muerta underground: the 3D path of every well',
      descripcion:
        'What Vaca Muerta wells look like: they drop almost 3,000 meters and turn horizontal inside the rock. The 3D path of more than 2,000 wells, from public data.',
    },
    'que-es': {
      titulo: 'What is Vaca Muerta? Explained in 6 steps with real data',
      descripcion:
        'What Vaca Muerta is, where the name comes from, how oil is extracted with hydraulic fracturing and why production keeps growing. Step by step, with official data.',
    },
    rendimiento: {
      titulo: 'Vaca Muerta well performance: how much each well produces',
      descripcion:
        'How much oil and gas a Vaca Muerta well produces in its first year, how fast production declines, how long drilling takes and which companies have the most productive wells.',
    },
  },
};

/** Actualiza título, descripción, Open Graph, URL canónica y versiones en otros idiomas. */
@Injectable({ providedIn: 'root' })
export class Seo {
  private readonly titulo = inject(Title);
  private readonly meta = inject(Meta);
  private readonly documento = inject(DOCUMENT);

  aplicar(pagina: Pagina): void {
    const i = idioma();
    const { titulo, descripcion } = PAGINAS[i][pagina];
    const url = SITIO + RUTAS[pagina][i];
    this.titulo.setTitle(titulo);
    this.meta.updateTag({ name: 'description', content: descripcion });
    this.meta.updateTag({ property: 'og:title', content: titulo });
    this.meta.updateTag({ property: 'og:description', content: descripcion });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:locale', content: i === 'en' ? 'en_US' : 'es_AR' });
    this.enlace('canonical', url);
    // Le dice a Google cuál es la misma página en el otro idioma.
    this.enlace('alternate', SITIO + RUTAS[pagina].es, 'es');
    this.enlace('alternate', SITIO + RUTAS[pagina].en, 'en');
    this.enlace('alternate', SITIO + RUTAS[pagina].es, 'x-default');
  }

  private enlace(rel: string, href: string, hreflang?: string): void {
    const selector = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]`;
    let el = this.documento.head.querySelector<HTMLLinkElement>(selector);
    if (!el) {
      el = this.documento.createElement('link');
      el.rel = rel;
      if (hreflang) el.hreflang = hreflang;
      this.documento.head.appendChild(el);
    }
    el.href = href;
  }
}
