import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

const SITIO = 'https://vaca-muerta-3d.vercel.app';

export type Pagina = 'produccion' | 'subsuelo' | 'que-es' | 'rendimiento';

/**
 * Título y descripción de cada sección, pensados para lo que la gente busca en Google
 * ("cuánto produce Vaca Muerta", "qué es Vaca Muerta", "mapa de pozos").
 */
const PAGINAS: Record<Pagina, { titulo: string; descripcion: string }> = {
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
};

/** Actualiza título, descripción, Open Graph y URL canónica según la sección. */
@Injectable({ providedIn: 'root' })
export class Seo {
  private readonly titulo = inject(Title);
  private readonly meta = inject(Meta);
  private readonly documento = inject(DOCUMENT);

  aplicar(pagina: Pagina): void {
    const { titulo, descripcion } = PAGINAS[pagina];
    const url = `${SITIO}/${pagina}`;
    this.titulo.setTitle(titulo);
    this.meta.updateTag({ name: 'description', content: descripcion });
    this.meta.updateTag({ property: 'og:title', content: titulo });
    this.meta.updateTag({ property: 'og:description', content: descripcion });
    this.meta.updateTag({ property: 'og:url', content: url });

    let canonica = this.documento.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonica) {
      canonica = this.documento.createElement('link');
      canonica.rel = 'canonical';
      this.documento.head.appendChild(canonica);
    }
    canonica.href = url;
  }
}
