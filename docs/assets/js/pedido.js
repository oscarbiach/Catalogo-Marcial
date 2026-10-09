/* ===========================================================================
   Reglas del pedido
   ---------------------------------------------------------------------------
   Logica pura de unidades, venta por caja y precios de cada linea. Es la que
   tiene que coincidir con registrar_pedido en la base: si cambia una, cambia
   la otra (las pruebas lo comparan con los mismos casos).
   =========================================================================== */

import { redondear2 } from './contrato.js';

/**
 * Por que unidad es el precio y en que se cuenta el pedido. Lo elige quien
 * carga el producto (columna unidad_precio): kg, unidad o caja. El precio
 * siempre es por esa unidad, y las cantidades del pedido se cuentan en ella:
 * un pan con precio por unidad se pide de a unidades, aunque venga en caja.
 *
 * Sin elegir ("automatico") queda el comportamiento de antes: con unidades
 * por caja se cuenta por caja; si la presentacion dice "Por kg" se cuenta
 * por kilo; si no, por unidad.
 */
export const UNIDADES_PRECIO = { kg: ['kg', 'kg'], unidad: ['unidad', 'unidades'], caja: ['caja', 'cajas'] };

export function unidadDe(p, cantidad) {
  if (soloPorCaja(p)) return cantidad === 1 ? 'caja' : 'cajas';
  var u = UNIDADES_PRECIO[p.unidadPrecio];
  if (u) return cantidad === 1 ? u[0] : u[1];
  if (p.unidadesCaja > 1) return cantidad === 1 ? 'caja' : 'cajas';
  var porAlgo = /^por\s+(.+)$/i.exec(String(p.presentacion || '').trim());
  if (porAlgo) return porAlgo[1].toLowerCase();
  return cantidad === 1 ? 'unidad' : 'unidades';
}

/**
 * Precio por unidad pero venta solo por caja cerrada. Lo decide la lista
 * caja_cerrada de la base (solo_caja): no todo producto con caja se vende
 * asi. El precio que se muestra sigue siendo el de la unidad; el subtotal es
 * precio x unidades de la caja x cajas.
 */
export function soloPorCaja(p) {
  if (!p.soloCaja) return false;
  return (p.unidadPrecio === 'unidad' && p.unidadesCaja > 1) ||
         (p.unidadPrecio === 'kg' && p.kgCaja > 0);
}

/** Cuanto vale una caja en veces el precio: sus unidades, o sus kilos. */
export function factorCaja(p) {
  return p.unidadPrecio === 'kg' ? p.kgCaja : p.unidadesCaja;
}

/** "12" o "3,6 kg": lo que trae la caja, para mostrarlo al cliente. */
export function contenidoCaja(p) {
  return p.unidadPrecio === 'kg'
    ? p.kgCaja.toLocaleString('es-AR') + ' kg'
    : String(p.unidadesCaja);
}

/**
 * [AUDITORIA H09] Precio de UNA unidad de pedido (una caja si se vende por
 * caja cerrada), redondeado a centavos igual que registrar_pedido. El
 * subtotal es este precio por la cantidad, nunca al reves: asi WhatsApp y
 * la base dan el mismo total.
 * @param {Producto} p
 * @returns {?number}
 */
export function precioDeLinea(p) {
  if (p.precio === null || p.precio === undefined) return null;
  return soloPorCaja(p) ? redondear2(p.precio * factorCaja(p)) : p.precio;
}

/** True si la cantidad del pedido de este producto se cuenta en cajas. */
export function seCuentaPorCaja(p) {
  if (soloPorCaja(p)) return true;
  return p.unidadPrecio ? p.unidadPrecio === 'caja' : p.unidadesCaja > 1;
}

/**
 * [AUDITORIA H10] Total y moneda del pedido. Si hubiera productos en
 * monedas distintas no se suman (el resultado no tendria sentido): el
 * total queda "a confirmar". Hoy todo el catalogo es ARS.
 * @returns {{total: ?number, moneda: string}}
 */
export function totalPedido(lineas) {
  var moneda = lineas.length ? lineas[0].producto.moneda : 'ARS';
  var mezcla = lineas.some(function (l) { return l.producto.moneda !== moneda; });
  if (mezcla) return { total: null, moneda: moneda };
  return {
    total: redondear2(lineas.reduce(function (suma, l) { return suma + (l.subtotal || 0); }, 0)),
    moneda: moneda,
  };
}
