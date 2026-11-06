// ═══════════════════════════════════════════════════════════════
// services/email/index.js — API modułu mailowego panelu
//
// listTemplates()                          → lista szablonów do widoku
// getTemplateDefaults(key, courseId)       → { subject, preheader, fields[], course }
//                                             (dane domyślne z Supabase)
// renderTemplate(key, { subject, preheader, values, course, recipient })
//                                          → { subject, preheader, html, text }
// fetchCourseForTemplates(courseId)        → kurs z Supabase (albo aktywny)
// ═══════════════════════════════════════════════════════════════

const supabase = require("../../config/supabase");
const { TEMPLATES } = require("./templates");

const ALIASES = {
  invite: "invite",
  invitation: "invite",
  zaproszenie: "invite",
  logistics: "logistics",
  logistic: "logistics",
  logistyka: "logistics",
  info: "logistics",
  materials: "materials",
  materialy: "materials",
  "materiały": "materials",
  custom: "custom",
  own: "custom",
  free: "custom",
  wlasne: "custom",
  "własne": "custom",
};

function getTemplate(key) {
  const tpl = TEMPLATES[ALIASES[String(key || "").toLowerCase()]];
  if (!tpl) {
    throw new Error(
      `Nieznany szablon maila: "${key}". Dostępne: ${Object.keys(TEMPLATES).join(
        ", "
      )}`
    );
  }
  return tpl;
}

function listTemplates() {
  return Object.values(TEMPLATES).map(({ key, name, description, icon }) => ({
    key,
    name,
    description,
    icon,
  }));
}

// ── Daty po polsku ──
const MONTHS_PL = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

const fmtDay = (d) => `${d.getDate()} ${MONTHS_PL[d.getMonth()]} ${d.getFullYear()}`;

function formatDateRangePL(start, end) {
  if (!start) return "";
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return "";
  if (!end) return fmtDay(s);
  const e = new Date(end);
  if (Number.isNaN(e.getTime())) return fmtDay(s);
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${s.getDate()}–${e.getDate()} ${MONTHS_PL[s.getMonth()]} ${s.getFullYear()}`;
  }
  return `${fmtDay(s)} – ${fmtDay(e)}`;
}

// ── Kurs z Supabase ──
// Konkretny courseId → ten kurs; "all" / "test" / brak → aktywny kurs
// (jako źródło danych dynamicznych: tytuł, termin, miejsce).
async function fetchCourseForTemplates(courseId) {
  try {
    let q = supabase.from("courses").select("*");
    if (courseId && courseId !== "all" && courseId !== "test") {
      const n = parseInt(courseId, 10);
      q = q.eq("course_id", Number.isNaN(n) ? courseId : n);
    } else {
      q = q.eq("is_active", true);
    }
    const { data, error } = await q
      .order("start_date", { ascending: false })
      .limit(1);
    if (error) {
      console.error("email/kurs:", error.message);
      return null;
    }
    const c = (data || [])[0];
    if (!c) return null;
    return {
      id: c.course_id,
      title: c.title || "Kurs CEEA",
      location: c.location || "",
      dateLabel: formatDateRangePL(c.start_date, c.end_date),
      raw: c,
    };
  } catch (err) {
    console.error("email/kurs:", err.message);
    return null;
  }
}

// ── Domyślne wartości pól dla szablonu + kursu ──
async function getTemplateDefaults(templateKey, courseId) {
  const tpl = getTemplate(templateKey);
  const course = await fetchCourseForTemplates(courseId);
  const d = tpl.defaults({ course });
  return {
    key: tpl.key,
    name: tpl.name,
    subject: d.subject,
    preheader: d.preheader,
    fields: tpl.fields.map((f) => ({ ...f, value: d.values[f.key] ?? "" })),
    course: course
      ? {
          id: course.id,
          title: course.title,
          dateLabel: course.dateLabel,
          location: course.location,
        }
      : null,
  };
}

// ── Renderowanie maila ──
// Puste subject/preheader → wartości domyślne szablonu.
function renderTemplate(
  templateKey,
  { subject, preheader, values = {}, course = null, recipient = {} } = {}
) {
  const tpl = getTemplate(templateKey);
  const d = tpl.defaults({ course });
  return tpl.render({
    subject: (subject || "").trim() || d.subject,
    preheader: (preheader || "").trim() || d.preheader,
    values,
    course,
    recipient: {
      firstName: recipient.firstName || "",
      lastName: recipient.lastName || "",
      email: recipient.email || "",
    },
  });
}

module.exports = {
  listTemplates,
  getTemplate,
  getTemplateDefaults,
  renderTemplate,
  fetchCourseForTemplates,
};