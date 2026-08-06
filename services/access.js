const supabase = require("../config/supabase");

/**
 * Znajdź użytkownika po emailu; jeśli nie istnieje — utwórz.
 * Istniejącemu aktualizuje TYLKO przekazane (niepuste) dane profilowe.
 */
async function findOrCreateUser({ email, name, surname, phone }) {
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
    .insert({ email: cleanEmail, name, surname, phone })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return created.id;
}

/**
 * Przyznaje dostęp do kursu: user → płatność (opcjonalnie) → enrollment.
 * Używane przez: panel admina, sync Airtable (przelew), webhook Tpay (przyszłość).
 */
async function grantAccess({ email, name, surname, phone, courseId, orderNumber, amountPln, method }) {
  const userId = await findOrCreateUser({ email, name, surname, phone });

  if (orderNumber) {
    const { error } = await supabase.from("payments").upsert({
      order_number: orderNumber,
      user_id: userId,
      course_id: courseId,
      amount: Math.round((amountPln || 0) * 100), // zł → grosze
      method: method || "transfer",
      status: "paid",
      paid_at: new Date().toISOString(),
    }, { onConflict: "order_number", ignoreDuplicates: true });
    if (error) throw error;
  }

  const { error } = await supabase.from("enrollments").upsert(
    { user_id: userId, course_id: courseId, status: "active" },
    { onConflict: "user_id,course_id" }
  );
  if (error) throw error;

  return userId;
}

module.exports = { findOrCreateUser, grantAccess };