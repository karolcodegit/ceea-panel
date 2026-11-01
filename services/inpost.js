// services/inpost.js — klient InPost ShipX (paczkomaty)
// Konfiguracja przez ENV:
//   INPOST_ENV=sandbox | production   (domyślnie sandbox!)
//   INPOST_API_TOKEN                  (token z panelu ShipX)
//   INPOST_ORG_ID                     (organizacja / id organizacji)
const BASES = {
  sandbox:    'https://sandbox-api-shipx-pl.easypack24.net/v1',
  production: 'https://api-shipx-pl.easypack24.net/v1',
};
const ENV = process.env.INPOST_ENV || 'sandbox';
const BASE = BASES[ENV] || BASES.sandbox;

function cfg() {
  return {
    token: process.env.INPOST_API_TOKEN || '',
    org:   process.env.INPOST_ORG_ID || '',
    sandbox: ENV !== 'production',
  };
}

function assertConfigured() {
  const c = cfg();
  if (!c.token || !c.org) {
    throw new Error('InPost nie skonfigurowany — uzupełnij INPOST_API_TOKEN i INPOST_ORG_ID w env (Northflank).');
  }
  return c;
}

async function api(method, path, body) {
  const c = assertConfigured();
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && (j.error.message || j.error)) || `ShipX HTTP ${r.status}`;
    throw new Error(`InPost: ${Array.isArray(msg) ? msg.join(', ') : msg}`);
  }
  return j;
}

// Gabaryty InPost: mini / small / medium / large
const SIZES = ['mini', 'small', 'medium', 'large'];

// Utwórz przesyłkę paczkomatową na podstawie zamówienia z book_orders
async function createLockerShipment(order, size = 'small') {
  if (!SIZES.includes(size)) size = 'small';
  if (!order.parcel_locker_code) throw new Error('Brak kodu paczkomatu (parcel_locker_code) w zamówieniu.');
  if (!order.phone) throw new Error('Brak telefonu odbiorcy.');

  const shipment = await api('POST', `/organizations/${cfg().org}/shipments`, {
    reference: order.order_number || order.id,
    service: 'inpost_locker_standard',
    receiver: {
      name:    `${order.name || ''} ${order.surname || ''}`.trim(),
      phone:   order.phone,
      email:   order.email || undefined,
    },
    parcels: [{ template: size }],
    custom_attributes: { target_point: order.parcel_locker_code },
  });

  return {
    id: shipment.id,
    status: shipment.status,
    trackingNumber: shipment.tracking_number,
    size,
  };
}

// Pobierz etykietę PDF (Buffer)
async function getLabelPdf(shipmentId) {
  const c = assertConfigured();
  const r = await fetch(`${BASE}/shipments/${shipmentId}/label?format=pdf`, {
    headers: { Authorization: `Bearer ${c.token}` },
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`InPost etykieta: ${(j.error && j.error.message) || `HTTP ${r.status}`}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

// Aktualny status przesyłki
async function getShipment(shipmentId) {
  return api('GET', `/shipments/${shipmentId}`);
}

module.exports = { createLockerShipment, getLabelPdf, getShipment, SIZES, isSandbox: () => ENV !== 'production' };
