/* ═══════════════════════════════════════════════════════════════
   USER ICONS — wspólne ikony SVG dla panelu.

   UWAGA — dwa formaty wpisów w ICONS:
   • login, settings  → pełny string <svg>…</svg>
   • book, invoice, user, cog, help, logout → same dane ścieżki (atrybut d)

   Dlatego są DWIE funkcje:

   • getIcon(name)
       Zwraca wpis JAK JEST (pełny svg albo samą ścieżkę).
       Używaj tam, gdzie kod sam opakowuje ścieżkę w <svg>
       (np. partial user-nav.ejs).

   • getIconSvg(name, cls)
       Zwraca ZAWSZE kompletny <svg>…</svg> dla NAZWY ikony z ICONS
       (np. getIconSvg('book')). Pełny svg przepuszcza bez zmian,
       ścieżkę opakowuje.

   • wrapIcon(raw, cls)
       Zwraca ZAWSZE kompletny <svg>…</svg> dla DOWOLNEGO stringa
       będącego pełnym svg albo gołą ścieżką (np. wartości kolumny
       icon z bazy help_categories). Pełny svg przepuszcza, gołą
       ścieżkę opakowuje. Pusty string → pusty string.

   • resolveIcon(raw, cls)  ← NAJBARDZIEJ ODPORNY — używaj przy
       danych z bazy. Obsługuje TRZY formaty naraz:
         – nazwę ikony z ICONS (np. "book")
         – pełny <svg>…</svg>
         – gołą ścieżkę "M12 6.253…"
       i zawsze zwraca kompletny <svg>…</svg>.

       cls — klasy Tailwind dla opakowywanej ścieżki
       (domyślnie "w-6 h-6 text-red-600").
   ═══════════════════════════════════════════════════════════════ */

   const ICONS = {
    login: `<svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg>`,
    settings: `<svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
    book:    'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    invoice: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    user:    'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    cog:     'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
    help:    'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    logout:  'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  };
  
  // Wpis jak jest — pełny svg ALBO sama ścieżka (dla kodu, który sam opakowuje).
  function getIcon(name) {
    return ICONS[name] || ICONS.login; // fallback
  }
  
  // Dowolny string (svg lub ścieżka, np. z bazy) → ZAWSZE kompletny <svg>.
  function wrapIcon(raw, cls = "w-6 h-6 text-red-600") {
    const v = String(raw || "").trim();
    if (!v) return "";
    if (v.startsWith("<svg")) return v; // już kompletny — bez zmian
    return `<svg class="${cls}" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${v}"/></svg>`;
  }
  
  // Nazwa ikony z ICONS → ZAWSZE kompletny <svg>.
  function getIconSvg(name, cls = "w-6 h-6 text-red-600") {
    return wrapIcon(getIcon(name), cls);
  }
  
  // Najbardziej odporny — do danych z bazy. Przyjmuje nazwę ikony,
  // pełny svg ALBO gołą ścieżkę i zawsze zwraca kompletny <svg>.
  function resolveIcon(raw, cls = "w-6 h-6 text-red-600") {
    const v = String(raw || "").trim();
    if (!v) return "";
    if (Object.prototype.hasOwnProperty.call(ICONS, v)) {
      return getIconSvg(v, cls); // nazwa z modułu, np. "book"
    }
    return wrapIcon(v, cls); // pełny svg albo goła ścieżka
  }
  
  module.exports = { getIcon, getIconSvg, wrapIcon, resolveIcon, ICONS };