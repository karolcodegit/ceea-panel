// ═══════════════════════════════════════════════════════════════
// services/inpost.js — klient InPost ShipX (paczkomaty + kurier)
//
// ENV: INPOST_ENV = "sandbox" | "production"   (domyślnie sandbox)
// Wymagane zmienne:
//   INPOST_API_TOKEN   — token ShipX (Manager → API)
//   INPOST_ORG_ID      — ID organizacji ShipX
//
// Zwracany format przesyłki (camelCase!):
//   { id, status, trackingNumber, size }
// ═══════════════════════════════════════════════════════════════

const BASES = {
  sandbox: "https://sandbox-api-shipx-pl.easypack24.net/v1",
  production: "https://api-shipx-pl.easypack24.net/v1",
};

const ENV = process.env.INPOST_ENV || "sandbox";
const BASE = BASES[ENV] || BASES.sandbox;

const cfg = () => ({
  token: process.env.INPOST_API_TOKEN,
  org: process.env.INPOST_ORG_ID,
  sandbox: ENV !== "production",
});

const SIZES = ["mini", "small", "medium", "large"];

// ── Wspólny fetch do ShipX ──
async function api(path, { method = "GET", body, raw = false } = {}) {
  const { token } = cfg();
  if (!token) throw new Error("Brak INPOST_API_TOKEN w zmiennych środowiskowych");

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: raw ? "*/*" : "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (raw) {
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`ShipX ${res.status}: ${t.slice(0, 300)}`);
    }
    return res;
  }

  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json?.message ||
      json?.error ||
      (json?.details ? JSON.stringify(json.details) : "") ||
      `HTTP ${res.status}`;
    throw new Error(`ShipX ${res.status}: ${msg}`);
  }
  return json;
}

// ── Normalizacja telefonu: ShipX chce 9 cyfr (PL) ──
function normPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.slice(-9); // ostatnie 9 cyfr (przytnie prefix 48)
}

// ── Rozbicie "ul. Sokolnicka 56/3" na street + building_number ──
// Kurier ShipX wymaga numeru budynku w osobnym polu.
function splitStreet(streetLine) {
  const s = String(streetLine || "").trim();
  const m = s.match(/^(.*?)[\s,]+(\d+[a-zA-Z]?(?:\s*[/\\]\s*\d+[a-zA-Z]?)?)$/u);
  if (!m || !m[1].trim()) {
    throw new Error(
      `Nie udało się odczytać numeru budynku z adresu „${s}” — popraw adres w zamówieniu (format: „Ulica 12/3”).`
    );
  }
  return {
    street: m[1].trim(),
    building_number: m[2].replace(/\s+/g, ""),
  };
}

// ── Wspólne dane odbiorcy z rekordu book_orders ──
function receiverOf(order) {
  const name = [order.name, order.surname].filter(Boolean).join(" ").trim();
  if (!name) throw new Error("Zamówienie nie ma imienia i nazwiska odbiorcy.");
  return {
    name,
    first_name: order.name || undefined,
    last_name: order.surname || undefined,
    email: order.email,
    phone: normPhone(order.phone),
  };
}

function parcelOf(size) {
  const template = SIZES.includes(size) ? size : "medium";
  return [{ template }];
}

// ═══════════════════════════════════════════════════════════════
// PACZKOMAT — inpost_locker_standard
// ═══════════════════════════════════════════════════════════════
async function createLockerShipment(order, size = "medium") {
  const { org } = cfg();
  if (!org) throw new Error("Brak INPOST_ORG_ID w zmiennych środowiskowych");
  if (!order.parcel_locker_code)
    throw new Error("Zamówienie nie ma kodu paczkomatu (parcel_locker_code).");

  const json = await api(`/organizations/${org}/shipments`, {
    method: "POST",
    body: {
      receiver: receiverOf(order),
      parcels: parcelOf(size),
      service: "inpost_locker_standard",
      custom_attributes: {
        target_point: order.parcel_locker_code,
        sending_method: "any_point", // nadanie w dowolnym punkcie / paczkomacie
      },
      reference: order.order_number || undefined,
      comments: `Zamówienie ${order.order_number || ""} — księgarnia CEEA`.trim(),
    },
  });

  return {
    id: json.id,
    status: json.status,
    trackingNumber: json.tracking_number || null, // ShipX może zwrócić numer później
    size,
  };
}

// ═══════════════════════════════════════════════════════════════
// KURIER — inpost_courier_standard
// ═══════════════════════════════════════════════════════════════
// sendingMethod: "dispatch_order" (kurier odbiera od nadawcy — domyślnie)
//                "any_point"      (nadanie w punkcie, bez zlecania odbioru)
async function createCourierShipment(order, size = "medium", sendingMethod = "dispatch_order") {
  const { org } = cfg();
  if (!org) throw new Error("Brak INPOST_ORG_ID w zmiennych środowiskowych");

  const addr = splitStreet(order.street);
  if (!order.city || !order.postcode)
    throw new Error("Zamówienie kurierskie wymaga miasta i kodu pocztowego.");

  const json = await api(`/organizations/${org}/shipments`, {
    method: "POST",
    body: {
      receiver: {
        ...receiverOf(order),
        address: {
          street: addr.street,
          building_number: addr.building_number,
          city: order.city,
          post_code: order.postcode,
          country_code: "PL",
        },
      },
      parcels: parcelOf(size),
      service: "inpost_courier_standard",
      custom_attributes: {
        sending_method: sendingMethod,
      },
      reference: order.order_number || undefined,
      comments: `Zamówienie ${order.order_number || ""} — księgarnia CEEA`.trim(),
    },
  });

  return {
    id: json.id,
    status: json.status,
    trackingNumber: json.tracking_number || null,
    size,
  };
}

// ═══════════════════════════════════════════════════════════════
// Status, etykieta, anulowanie
// ═══════════════════════════════════════════════════════════════
async function getShipment(shipmentId) {
  return api(`/shipments/${shipmentId}`);
}

// Etykieta PDF → Buffer
async function getLabelPdf(shipmentId) {
  const res = await api(`/shipments/${shipmentId}/label?format=Pdf&type=A6`, { raw: true });
  return Buffer.from(await res.arrayBuffer());
}

// Anulowanie przesyłki (DELETE /v1/shipments/:id).
// 404 = przesyłki już nie ma w InPost → traktujemy jako sukces (sprzątamy lokalnie).
// InPost odmówi (409/422), gdy paczka jest już w drodze — wtedy rzucamy błąd.
async function cancelShipment(shipmentId) {
  const { token } = cfg();
  if (!token) throw new Error("Brak INPOST_API_TOKEN w zmiennych środowiskowych");

  const res = await fetch(`${BASE}/shipments/${shipmentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return { canceled: true, alreadyGone: true };
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(
      `InPost odrzucił anulowanie przesyłki (${res.status}): ${t.slice(0, 200)}`
    );
  }
  return { canceled: true };
}

module.exports = {
  createLockerShipment,
  createCourierShipment,
  getLabelPdf,
  getShipment,
  cancelShipment,
  SIZES,
  isSandbox: () => ENV !== "production",
};