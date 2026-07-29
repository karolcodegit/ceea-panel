// sync-datocms-books.js
// Synchronizacja: DatoCMS allBooks → Airtable tabela "Products"

try {
    process.loadEnvFile();
  } catch {}
  
  const DATOCMS_TOKEN = process.env.DATOCMS_API_TOKEN;
  const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
  const TABLE = "Products";
  
  if (!DATOCMS_TOKEN || !AIRTABLE_KEY || !AIRTABLE_BASE) {
    console.error(
      "❌ Brak zmiennych środowiskowych: DATOCMS_API_TOKEN / AIRTABLE_API_KEY / AIRTABLE_BASE_ID"
    );
    process.exit(1);
  }
  
  /* ================= DatoCMS ================= */
  
  async function getDatoBooks() {
    const query = `
      query {
        allBooks(first: 100) {
          id
          title
          year
          price
          editor
        }
      }
    `;
  
    const res = await fetch("https://graphql.datocms.com/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DATOCMS_TOKEN}`,
      },
      body: JSON.stringify({ query }),
    });
  
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data.allBooks;
  }
  
  /* ================= pomocnicze ================= */
  
  // "150 zł" / "150,00" / 150 → 150
  function parsePrice(price) {
    if (price === null || price === undefined || price === "") return null;
    const n = parseFloat(String(price).replace(",", ".").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  
  // "Anna Kluzik, Krzysztof Kusza" albo "Anna Kluzik i Krzysztof Kusza"
  // → ["Anna Kluzik", "Krzysztof Kusza"]
  function parseAuthors(editor) {
    if (!editor) return [];
    return String(editor)
      .split(/[,;]|\s+i\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  
  /* ================= Airtable ================= */
  
  // Mapa: DatoCMS ID → Airtable record ID
  async function listExisting() {
    const map = new Map();
    let offset;
  
    do {
      const params = new URLSearchParams({ "fields[]": "DatoCMS ID" });
      if (offset) params.set("offset", offset);
  
      const res = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE)}?${params}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } }
      );
      const json = await res.json();
      if (json.error) throw new Error(JSON.stringify(json));
  
      for (const rec of json.records) {
        const datoId = rec.fields["DatoCMS ID"];
        if (datoId) map.set(datoId, rec.id);
      }
      offset = json.offset;
    } while (offset);
  
    return map;
  }
  
  async function batch(method, records) {
    for (let i = 0; i < records.length; i += 10) {
      const chunk = records.slice(i, i + 10);
      const res = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE)}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${AIRTABLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ records: chunk, typecast: true }),
        }
      );
      const json = await res.json();
      if (json.error) throw new Error(JSON.stringify(json));
    }
  }
  
  /* ================= sync ================= */
  
  async function syncToAirtable(records) {
    const existing = await listExisting();
  
    const toCreate = [];
    const toUpdate = [];
  
    for (const rec of records) {
      const datoId = rec.fields["DatoCMS ID"];
      const existingId = existing.get(datoId);
      if (existingId) {
        toUpdate.push({ id: existingId, fields: rec.fields });
      } else {
        toCreate.push(rec);
      }
    }
  
    if (toCreate.length) await batch("POST", toCreate);
    if (toUpdate.length) await batch("PATCH", toUpdate);
  
    console.log(`✅ Utworzone: ${toCreate.length}, zaktualizowane: ${toUpdate.length}`);
  }
  
  /* ================= main ================= */
  
  (async () => {
    try {
      const books = await getDatoBooks();
      console.log(`Pobrano z DatoCMS: ${books.length} książek`);
  
      const records = books.map((b) => {
        const year = parseInt(b.year, 10);
        const price = parsePrice(b.price);
        const authors = parseAuthors(b.editor);
  
        return {
          fields: {
            "DatoCMS ID": b.id,
            Name: b.title.trim(),
            ...(Number.isFinite(year) ? { Year: year } : {}),
            ...(price !== null ? { Coast: price } : {}),
            ...(authors.length ? { Author: authors } : {}),
          },
        };
      });
  
      await syncToAirtable(records);
    } catch (err) {
      console.error("❌ Sync error:", err.message);
      process.exit(1);
    }
  })();