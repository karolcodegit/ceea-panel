require("dotenv").config();

const DATOCMS_TOKEN = process.env.DATOCMS_API_TOKEN;
const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
const TABLE = "Courses";

function getYearFromDate(date) {
  if (!date) return null;
  const parts = date.split(".");
  if (parts.length > 1) return parts[2].slice(-4);
  return date.length === 4 ? date : null;
}

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

async function upsertBatch(records) {
  // Airtable: max 10 rekordów na request
  for (let i = 0; i < records.length; i += 10) {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${TABLE}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AIRTABLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          performUpsert: { fieldsToMergeOn: ["DatoCMS ID"] },
          records: records.slice(i, i + 10),
        }),
      }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
  }
}

(async () => {
  const courses = await getDatoCourses();

  const records = courses.map((c) => ({
    fields: {
      "DatoCMS ID": c.id,
      CourseName: c.nameCourse,
      Year: getYearFromDate(c.date),
      Active: c.available,
    },
  }));

  await upsertBatch(records);
  console.log(`✅ Zsynchronizowano ${records.length} kursów DatoCMS → Airtable`);
})().catch((err) => {
  console.error("❌ Sync error:", err.message);
  process.exit(1);
});