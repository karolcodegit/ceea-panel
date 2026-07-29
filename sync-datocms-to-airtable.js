try { process.loadEnvFile(); } catch {} // lokalnie .env, na CI zmienne z workflow

const DATOCMS_TOKEN = process.env.DATOCMS_API_TOKEN;
const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
const TABLE = "Courses";

if (!DATOCMS_TOKEN || !AIRTABLE_KEY || !AIRTABLE_BASE) {
  console.error("❌ Brak zmiennych env (DATOCMS_API_TOKEN / AIRTABLE_API_KEY / AIRTABLE_BASE_ID)");
  process.exit(1);
}

// ===== PARSOWANIE ROKU Z POLA TEKSTOWEGO =====
function getYearFromDate(date) {
  if (!date) return null;
  const parts = date.split(".");
  if (parts.length > 1) return parts[2].slice(-4); // "8-10.05.2025" → "2025"
  return date.length === 4 ? date : null;          // "2027" → "2027"
}

// ===== DATOCMS =====
async function getDatoCourses() {
  const res = await fetch("https://graphql.datocms.com/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DATOCMS_TOKEN}`,
    },
    body: JSON.stringify({
      query: `{ allCourses(first: 100) { id nameCourse date available } }`,
    }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.allCourses;
}

// ===== AIRTABLE: ODCZYT ISTNIEJĄCYCH (klucz: DatoCMS ID → record id) =====
async function listExisting() {
  const map = new Map();
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${TABLE}`);
    url.searchParams.set("fields[]", "DatoCMS ID");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    json.records.forEach((r) => map.set(r.fields["DatoCMS ID"], r.id));
    offset = json.offset;
  } while (offset);
  return map;
}

// ===== AIRTABLE: ZAPIS PACZKAMI (max 10 rekordów / request) =====
async function batch(method, records) {
  if (records.length === 0) return;
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${TABLE}`, {
    method, // "POST" = create, "PATCH" = update
    headers: {
      Authorization: `Bearer ${AIRTABLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ typecast: true, records }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
}

// ===== UPSERT: create dla nowych, update dla istniejących =====
async function syncToAirtable(records) {
  const existing = await listExisting();
  const toCreate = [];
  const toUpdate = [];

  for (const rec of records) {
    const id = existing.get(rec.fields["DatoCMS ID"]);
    if (id) toUpdate.push({ id, fields: rec.fields });
    else toCreate.push(rec);
  }

  for (let i = 0; i < toCreate.length; i += 10) await batch("POST", toCreate.slice(i, i + 10));
  for (let i = 0; i < toUpdate.length; i += 10) await batch("PATCH", toUpdate.slice(i, i + 10));

  console.log(`✅ Utworzone: ${toCreate.length}, zaktualizowane: ${toUpdate.length}`);
}

// ===== MAIN =====
(async () => {
  const courses = await getDatoCourses();
  console.log(`Pobrano z DatoCMS: ${courses.length} kursów`);

  const records = courses.map((c) => {
    const year = getYearFromDate(c.date);
    console.log(`- ${c.nameCourse.trim()} → ${year ?? "brak roku"}`);
    return {
      fields: {
        "DatoCMS ID": c.id,
        CourseName: c.nameCourse.trim(),
        ...(year ? { Year: Number(year) } : {}),
        Active: c.available,
      },
    };
  });

  await syncToAirtable(records);
})().catch((err) => {
  console.error("❌ Sync error:", err.message);
  process.exit(1);
});