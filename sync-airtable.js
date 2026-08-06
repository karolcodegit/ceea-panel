// sync-airtable.js
// Airtable (Registrations, Paid ✓) → Supabase: users + payments + enrollments
// Lokalnie: node sync-airtable.js | CI: GitHub Actions

try { process.loadEnvFile(); } catch {}

const { grantAccess } = require("./services/access");

const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
const TABLE = process.env.AIRTABLE_TABLE || "Registrations";

const FIELDS = ["Order Number", "Name", "Surname", "Mail", "Phone", "CourseID", "Total"];

if (!AIRTABLE_KEY || !AIRTABLE_BASE) {
  console.error("❌ Brak AIRTABLE_API_KEY / AIRTABLE_BASE_ID");
  process.exit(1);
}

async function fetchPaidRegistrations() {
  const records = [];
  let offset;

  do {
    const params = new URLSearchParams();
    params.set("filterByFormula", "{Paid}=1");
    FIELDS.forEach((f) => params.append("fields[]", f));
    if (offset) params.set("offset", offset);

    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE)}?${params}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } }
    );
    const json = await res.json();
    if (json.error) throw new Error(JSON.stringify(json));

    records.push(...(json.records || []));
    offset = json.offset;
  } while (offset);

  return records;
}

(async () => {
  try {
    console.log("🚀 Synchronizacja Airtable → Supabase");
    const regs = await fetchPaidRegistrations();
    console.log(`Opłaconych zapisów (Paid ✓): ${regs.length}\n`);

    const stats = { granted: 0, skipped: 0, errors: 0 };

    for (const [i, r] of regs.entries()) {
      const f = r.fields;
      const email = (f.Mail || f.Email || "").toLowerCase().trim();
      const courseId = (f.CourseID || "").trim();
      const order = f["Order Number"] || r.id;

      if (!email || !courseId) {
        console.warn(`⚠️ [${i + 1}/${regs.length}] ${order}: pomijam — brak ${!email ? "Mail" : "CourseID"}`);
        stats.skipped++;
        continue;
      }

      try {
        await grantAccess({
          email,
          name: f.Name,
          surname: f.Surname,
          phone: f.Phone ? String(f.Phone) : undefined,
          courseId,
          orderNumber: f["Order Number"],
          amountPln: Number(f.Total) || 0,
          method: "transfer",
        });
        console.log(`✅ [${i + 1}/${regs.length}] ${email} → ${courseId}`);
        stats.granted++;
      } catch (err) {
        console.error(`❌ [${i + 1}/${regs.length}] ${order}: ${err.message}`);
        stats.errors++;
      }
    }

    console.log("\n════════════════════════");
    console.log(`✅ Dostęp przyznany: ${stats.granted}`);
    console.log(`⚠️ Pominięto:        ${stats.skipped}`);
    console.log(`❌ Błędy:            ${stats.errors}`);
    console.log("════════════════════════");

    if (stats.errors > 0) process.exit(1);
  } catch (err) {
    console.error("💥 Sync error:", err.message);
    process.exit(1);
  }
})();