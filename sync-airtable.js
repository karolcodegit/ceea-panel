require('dotenv').config();
const Airtable = require('airtable');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });
const base = airtable.base(process.env.AIRTABLE_BASE_ID);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
        realtime: { transport: WebSocket }
    }
);

const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE || 'Course';

/**
 * Pobierz wszystkie rekordy z Airtable (działająca paginacja)
 */
async function fetchAllRecords() {
    const records = [];
    let offset = undefined;

    do {
        const query = { pageSize: 100 };
        if (offset) query.offset = offset;

        const result = await base(AIRTABLE_TABLE).select(query).firstPage();
        records.push(...result);

        // Pobierz offset z ostatniego rekordu
        offset = result.length > 0 ? result[result.length - 1]._rawJson?.offset : undefined;

        console.log(`  Pobrano ${records.length} rekordów...`);
    } while (offset);

    return records;
}

/**
 * Znajdź lub utwórz kurs
 */
async function getOrCreateCourse(name) {
    if (!name) return null;

    const { data: existing } = await supabase
        .from('courses')
        .select('id')
        .eq('name', name)
        .single();

    if (existing) return existing.id;

    const { data, error } = await supabase
        .from('courses')
        .insert({ name, description: name, active: true })
        .select('id')
        .single();

    if (error) { console.error('Błąd kursu:', error); return null; }
    console.log(`  📚 Nowy kurs: ${name}`);
    return data.id;
}

/**
 * Znajdź lub utwórz użytkownika
 */
async function getOrCreateUser(fields) {
    const email = fields.Mail?.trim().toLowerCase();
    if (!email) { console.warn('  ⚠️ Brak emaila'); return null; }

    const { data, error } = await supabase
        .from('users')
        .upsert({
            email: email,
            name: fields.Name || null,
            surname: fields.Surname || null,
            phone: fields.Phone || null
        }, { onConflict: 'email' })
        .select('id, email')
        .single();

    if (error) { console.error('  ❌ Błąd użytkownika:', error); return null; }
    return data;
}

/**
 * Utwórz zapis na kurs
 */
async function createEnrollment(userId, courseId, fields) {
    const { error } = await supabase
        .from('enrollments')
        .insert({
            user_id: userId,
            course_id: courseId,
            email: fields.Mail?.trim().toLowerCase(),
            order_number: fields['Order Number'] || null,
            status: 'active'
        });

    if (error) {
        if (error.code === '23505') { console.log('  ℹ️ Już zapisany'); return 'exists'; }
        console.error('  ❌ Błąd zapisu:', error); return 'error';
    }
    return 'created';
}

/**
 * GŁÓWNA FUNKCJA
 */
async function sync() {
    console.log('🚀 Synchronizacja Airtable → Supabase\n');

    const stats = { total: 0, users: 0, courses: 0, enrollments: 0, exists: 0, skipped: 0, errors: 0 };

    const records = await fetchAllRecords();
    stats.total = records.length;
    console.log(`✅ Łącznie pobrano: ${records.length} rekordów\n`);

    if (records.length === 0) {
        console.log('Brak rekordów do synchronizacji.');
        return;
    }

    // Cache kursów
    const { data: existingCourses } = await supabase.from('courses').select('id, name');
    const courseMap = new Map(existingCourses?.map(c => [c.name, c.id]) || []);

    for (let i = 0; i < records.length; i++) {
        const f = records[i].fields;
        const name = `${f.Name || ''} ${f.Surname || ''}`.trim() || f.Mail || 'Bez nazwy';
        console.log(`[${i+1}/${records.length}] ${name}`);

        if (!f.Mail || !f.CourseTitle) {
            console.log('  ⚠️ Pominięto (brak email lub kurs)');
            stats.skipped++;
            continue;
        }

        // Kurs
        let courseId = courseMap.get(f.CourseTitle);
        if (!courseId) {
            courseId = await getOrCreateCourse(f.CourseTitle);
            if (courseId) courseMap.set(f.CourseTitle, courseId);
        }
        if (!courseId) { stats.errors++; continue; }
        stats.courses++;

        // Użytkownik
        const user = await getOrCreateUser(f);
        if (!user) { stats.errors++; continue; }
        stats.users++;

        // Zapis
        const result = await createEnrollment(user.id, courseId, f);
        if (result === 'created') { console.log('  ✅ Zapisano'); stats.enrollments++; }
        else if (result === 'exists') stats.exists++;
        else stats.errors++;
    }

    console.log('\n═══════════════════════════════════════');
    console.log('📊 PODSUMOWANIE');
    console.log('═══════════════════════════════════════');
    console.log(`Rekordów:       ${stats.total}`);
    console.log(`Użytkowników:   ${stats.users}`);
    console.log(`Kursów:         ${stats.courses}`);
    console.log(`Nowych zapisów: ${stats.enrollments}`);
    console.log(`Już istniały:   ${stats.exists}`);
    console.log(`Pominięto:      ${stats.skipped}`);
    console.log(`Błędy:          ${stats.errors}`);
    console.log('═══════════════════════════════════════');
}

sync().catch(e => { console.error('💥', e); process.exit(1); });