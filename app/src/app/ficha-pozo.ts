import { Component, computed, input, output } from '@angular/core';
import { Trayectoria } from './trayectorias';
import { Datos, ESTADO_TEXTO, MEDIDA_INFO, Medida, fechaLarga, formato, nombreArea, nombreEmpresa, nombreMes, valorPozo } from './datos';
import { enIngles, idioma, tr } from './idioma';

const ANCHO = 280;
const ALTO = 86;

/** Detalle de un pozo: datos básicos y su curva de producción. */
@Component({
  selector: 'vm-ficha-pozo',
  template: `
    <header class="cabecera">
      <div>
        <h2>{{ pozo().nombre }}</h2>
        <p class="empresa">
          <span class="muestra" [style.background]="empresa().color" aria-hidden="true"></span>
          {{ nombreEmpresa(empresa().nombre) }}
        </p>
      </div>
      <button type="button" class="cerrar" (click)="cerrar.emit()" [attr.aria-label]="en() ? 'Close well details' : 'Cerrar la ficha del pozo'">✕</button>
    </header>

    <dl class="datos">
      <div><dt>{{ en() ? 'Area' : 'Área' }}</dt><dd>{{ area() }}</dd></div>
      @if (provincia(); as prov) {
        <div><dt>{{ en() ? 'Province' : 'Provincia' }}</dt><dd>{{ prov }}</dd></div>
      }
      <div><dt>{{ en() ? 'Type' : 'Tipo' }}</dt><dd>{{ pozo().esGas ? (en() ? 'Gas well' : 'Gasífero') : (en() ? 'Oil well' : 'Petrolífero') }}</dd></div>
      <div><dt>{{ en() ? 'Status' : 'Estado' }}</dt><dd>{{ estado() }}</dd></div>
      <div><dt>{{ en() ? 'Total well length' : 'Largo total del pozo' }}</dt><dd>{{ profundidad() }}</dd></div>
      @if (trayectoria(); as t) {
        <div><dt>{{ en() ? 'Horizontal lateral' : 'Rama horizontal' }}</dt><dd>{{ f.entero(t.rama) }} m</dd></div>
        <div><dt>{{ en() ? 'Vertical depth' : 'Profundidad vertical' }}</dt><dd>{{ f.entero(t.profundidad) }} m</dd></div>
      }
      <div><dt>{{ en() ? 'Drilling' : 'Perforación' }}</dt><dd>{{ perforacion() }}</dd></div>
      <div><dt>{{ en() ? 'First production' : 'Primera producción' }}</dt><dd>{{ inicio() }}</dd></div>
      <div><dt>{{ en() ? 'In' : 'En' }} {{ mesTexto() }}</dt><dd>{{ valorActual() }}</dd></div>
      <div><dt>{{ en() ? 'Cumulative oil' : 'Petróleo acumulado' }}</dt><dd>{{ acumPetroleo() }}</dd></div>
      <div><dt>{{ en() ? 'Cumulative gas' : 'Gas acumulado' }}</dt><dd>{{ acumGas() }}</dd></div>
      <div><dt>{{ en() ? 'Cumulative water' : 'Agua acumulada' }}</dt><dd>{{ acumAgua() }}</dd></div>
    </dl>

    <figure class="curva">
      <figcaption>{{ titulo() }}</figcaption>
      <svg [attr.viewBox]="'0 0 ' + ancho + ' ' + alto" role="img" [attr.aria-label]="(en() ? 'Production curve of ' : 'Curva de producción de ') + pozo().nombre">
        <line x1="0" [attr.x2]="ancho" [attr.y1]="alto - 1" [attr.y2]="alto - 1" class="base" />
        <path [attr.d]="curva().area" class="relleno" [style.fill]="empresa().color" />
        <path [attr.d]="curva().linea" class="linea" [style.stroke]="empresa().color" />
        @if (curva().marcador; as m) {
          <circle [attr.cx]="m.x" [attr.cy]="m.y" r="4" class="marcador" />
        }
      </svg>
      <p class="pico">{{ en() ? 'Peak' : 'Pico' }}: {{ curva().picoTexto }}</p>
    </figure>
  `,
  styles: `
    :host { display: grid; gap: 14px; }
    .cabecera { display: flex; justify-content: space-between; align-items: start; gap: 12px; }
    h2 { font: 600 17px/1.2 var(--fuente-titulo); margin: 0 0 6px; letter-spacing: -0.01em; overflow-wrap: anywhere; }
    .empresa { margin: 0; color: var(--tinta-suave); display: flex; align-items: center; gap: 8px; }
    .muestra { width: 10px; height: 10px; border-radius: 3px; flex: none; }
    .cerrar {
      background: none; border: 1px solid var(--linea); color: var(--tinta); border-radius: 8px;
      width: 32px; height: 32px; cursor: pointer; flex: none;
    }
    .cerrar:hover { border-color: var(--barda-clara); }
    .datos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin: 0; }
    .datos div { display: grid; gap: 2px; }
    dt { color: var(--tinta-suave); font-size: 12px; }
    dd { margin: 0; font-variant-numeric: tabular-nums; }
    .curva { margin: 0; display: grid; gap: 6px; }
    figcaption, .pico { color: var(--tinta-suave); font-size: 12px; margin: 0; }
    svg { width: 100%; height: auto; overflow: visible; }
    .base { stroke: var(--linea); }
    .relleno { fill-opacity: 0.16; }
    .linea { fill: none; stroke-width: 2; stroke-linejoin: round; }
    .marcador { fill: var(--tinta); stroke: var(--panel-solido); stroke-width: 2; }
  `,
})
export class FichaPozo {
  readonly datos = input.required<Datos>();
  readonly indice = input.required<number>();
  readonly mes = input.required<number>();
  readonly medida = input<Medida>('petroleo');
  readonly trayectoria = input<Trayectoria | null>(null);
  readonly cerrar = output<void>();

  protected readonly f = formato;
  protected readonly en = enIngles;
  protected readonly nombreEmpresa = nombreEmpresa;
  protected readonly ancho = ANCHO;
  protected readonly alto = ALTO;

  protected readonly pozo = computed(() => this.datos().pozos[this.indice()]);
  protected readonly empresa = computed(() => this.datos().meta.empresas[this.pozo().empresa]);
  protected readonly provincia = computed(() => this.datos().meta.provincias?.[this.pozo().provincia] ?? null);
  protected readonly area = computed(() => nombreArea(this.datos().meta.areas[this.pozo().area]));
  protected readonly inicio = computed(() =>
    this.pozo().conProduccion ? nombreMes(this.datos().meta.meses[this.pozo().inicio]) : tr('Sin producción declarada', 'No production reported'),
  );
  // El estado detallado viene en español en los datos oficiales; en inglés se usa el agrupado.
  protected readonly estado = computed(() =>
    idioma() === 'en' ? ESTADO_TEXTO[this.pozo().estado] : this.pozo().estadoTexto || ESTADO_TEXTO[this.pozo().estado],
  );
  protected readonly profundidad = computed(() => {
    const p = this.pozo().profundidad;
    return p ? `${formato.entero(p)} m` : tr('Sin dato', 'No data');
  });
  protected readonly perforacion = computed(() => {
    const p = this.pozo();
    if (!p.inicioPerforacion || p.inicioPerforacion.slice(0, 4) === '1900') return tr('Sin dato', 'No data');
    return fechaLarga(p.inicioPerforacion);
  });
  protected readonly acumAgua = computed(() => `${formato.entero(this.pozo().acumAguaM3)} m³`);
  protected readonly titulo = computed(
    () =>
      (idioma() === 'en'
        ? { petroleo: 'Oil, bbl/d', gas: 'Gas, thousand m³/d', agua: 'Water, m³/d' }
        : { petroleo: 'Petróleo, bbl/d', gas: 'Gas, miles de m³/d', agua: 'Agua, m³/d' })[this.medida()],
  );
  protected readonly mesTexto = computed(() => nombreMes(this.datos().meta.meses[this.mes()], true));
  protected readonly acumPetroleo = computed(() => `${formato.entero(this.pozo().acumPetroleoBbl)} bbl`);
  protected readonly acumGas = computed(() => `${formato.decimal(this.pozo().acumGasMm3 / 1000)} ${tr('millones de m³', 'million m³')}`);
  protected readonly valorActual = computed(() => {
    const v = valorPozo(this.datos(), this.medida(), this.indice(), this.mes());
    if (!this.pozo().conProduccion) return tr('Sin producción', 'No production');
    if (this.mes() < this.pozo().inicio) return tr('Todavía no producía', 'Not producing yet');
    return MEDIDA_INFO[this.medida()].pozo(v);
  });

  protected readonly curva = computed(() => {
    const d = this.datos();
    const p = this.pozo();
    const n = d.meta.meses.length;
    const desde = p.inicio;
    const valores: number[] = [];
    for (let m = desde; m < n; m++) valores.push(valorPozo(d, this.medida(), p.indice, m));
    const max = Math.max(...valores, 1);
    const tramo = Math.max(1, valores.length - 1);
    const x = (i: number) => (i / tramo) * ANCHO;
    const y = (v: number) => ALTO - 2 - (v / max) * (ALTO - 8);
    const puntos = valores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const linea = `M${puntos.join('L')}`;
    const area = `${linea}L${x(valores.length - 1).toFixed(1)},${ALTO - 1}L0,${ALTO - 1}Z`;
    const i = this.mes() - desde;
    const marcador = i >= 0 && i < valores.length ? { x: x(i), y: y(valores[i]) } : null;
    const picoTexto = valores.some((v) => v > 0) ? MEDIDA_INFO[this.medida()].pozo(max) : tr('sin producción', 'no production');
    return { linea, area, marcador, picoTexto };
  });
}
