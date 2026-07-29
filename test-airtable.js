try { process.loadEnvFile(); } catch {}

(async () => {
  const res = await fetch(
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Courses`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        typecast: true,
        records: [
          { fields: { "DatoCMS ID": "TEST-1", CourseName: "Test", Year: 2026, Active: true } },
        ],
      }),
    }
  );
  console.log(res.status, JSON.stringify(await res.json(), null, 2));
})();