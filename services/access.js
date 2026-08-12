const supabase = require("../config/supabase");

/**
 * Znajdź użytkownika po emailu; jeśli nie istnieje — utwórz.
 * Istniejącemu aktualizuje TYLKO przekazane (niepuste) dane profilowe.
 * created_at ustawiane tylko przy tworzeniu (data pierwszej rejestracji).
 */
async function findOrCreateUser({ email, name, surname, phone, createdAt }) {
  const cleanEmail = (email || "").toLowerCase().trim();
  if (!cleanEmail) throw new Error("findOrCreateUser: brak email");

  const { data: existing, error: findError } = await supabase
    .from("users").select("id").eq("email", cleanEmail).maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const updates = {};
    if (name) updates.name = name;
    if (surname) updates.surname = surname;
    if (phone) updates.phone = phone;
    if (Object.keys(updates).length) {
      await supabase.from("users").update(updates).eq("id", existing.id);
    }
    return existing.id;
  }

  const { data: created, error: insertError } = await supabase
    .from("users")
    .insert({
      email: cleanEmail,
      name,
      surname,
      phone,
      created_at: createdAt || new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return created.id;
}

/**
 * Przyznaje dostęp do kursu: user → płatność (opcjonalnie) → enrollment.
 * createdAt = data utworzenia rekordu w Airtable (przy ręcznym grantAccess/Tpay = teraz).
 */
async function grantAccess({ email, name, surname, phone, courseId, orderNumber, amountPln, method, createdAt }) {
  const when = createdAt || new Date().toISOString();
  const userId = await findOrCreateUser({ email, name, surname, phone, createdAt });

  if (orderNumber) {
    const { error } = await supabase.from("payments").upsert({
      order_number: orderNumber,
      user_id: userId,
      course_id: courseId,
      amount: Math.round((amountPln || 0) * 100), // zł → grosze
      method: method || "transfer",
      status: "paid",
      paid_at: when,
      created_at: when,
    }, { onConflict: "order_number", ignoreDuplicates: true });
    if (error) throw error;
  }

  // enrollment: created_at tylko przy pierwszym zapisie;
  // przy konflikcie (user_id, course_id) tylko reaktywujemy status
  const { error: enrErr } = await supabase.from("enrollments").insert({
    user_id: userId,
    course_id: courseId,
    status: "active",
    created_at: when,
  });

  if (enrErr) {
    if (enrErr.code === "23505") {
      const { error: updErr } = await supabase
        .from("enrollments")
        .update({ status: "active" })
        .eq("user_id", userId)
        .eq("course_id", courseId);
      if (updErr) throw updErr;
    } else {
      throw enrErr;
    }
  }

  return userId;
}

module.exports = { findOrCreateUser, grantAccess };