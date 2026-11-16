/* ============================================================
   data-table.js — uniwersalna tabela danych dla panelu CEEA
   Zero zależności. Użycie:
     const table = new DataTable('#myTable', {
       columns: [
         { key: 'created_at', label: 'Data', sortable: true,
           render: p => fmtDate(p.created_at) },
         { key: 'amount', label: 'Kwota', sortable: true, align: 'right',
           summary: 'sum' },                       // ← suma w stopce
         { key: 'status', label: 'Status', render: p => badge(p.status) },
         { key: '_akcje', label: 'Akcje', align: 'right', sortable: false,
           render: p => `<button>…</button>` },
       ],
       pageSize: 10,
       csvFilename: 'platnosci.csv',
       emptyText: 'Brak wyników dla wybranych filtrów.',

       // ── EKSPORT (opcjonalnie) ──
       // Domyślnie eksport powstaje z kolumn (label + csvValue/render).
       // Moduł może zadeklarować TYLKO co ma być eksportowane:
       exportData: rows => ({
         filename: 'platnosci',             // bez rozszerzenia
         headers: ['Kolumna 1', 'Kolumna 2'],
         rows: rows.map(r => [r.id, r.name]) // wiersze = tablice
       })
       // `rows` = aktualnie PRZEFILTROWANE dane (po filtrach modułu).
     });
     table.setRows(data);          // pełne dane
     table.setRows(filteredData);  // po Twoich filtrach (wywołuj w render())

   Przycisk „⬇ Eksport ▾" oferuje formaty: CSV / Excel (.xlsx) / JSON.
   Excel ładuje bibliotekę SheetJS z CDN dopiero przy pierwszym użyciu.

   Zwijane filtry (wspólne dla modułów):
     initCollapsibleFilters('bodyId', document.getElementById('toggleBtn'))
   ============================================================ */
   (function (global) {
    'use strict';

    const fmtPLN = n => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(Number(n) || 0);

    // ── Ikony SVG (heroicons outline) — bez emoji ──
    const svgIcon = (path, size, sw) =>
      `<svg width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw || 1.8}" viewBox="0 0 24 24" aria-hidden="true" style="flex-shrink:0">${path}</svg>`;
    const ICON_DOWNLOAD = svgIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>', 13, 2);
    const ICON_CHEVRON = svgIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/>', 9, 2.6);
    const ICON_CSV = svgIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>', 14);
    const ICON_XLSX = svgIcon('<rect x="3.5" y="4" width="17" height="16" rx="2"/><path stroke-linecap="round" d="M3.5 9.33h17M3.5 14.66h17M9.17 4v16M14.83 4v16"/>', 14);
    const ICON_JSON = svgIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"/>', 14);

    class DataTable {
      constructor(selector, config) {
        this.el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        this.cfg = Object.assign({
          columns: [],
          pageSize: 10,
          pageSizeOptions: [10, 25, 50, 100],
          csvFilename: 'export.csv',
          emptyText: 'Brak wyników.',
          rowClass: 'hover:bg-gray-50 dark:hover:bg-slate-700/30 transition',
        }, config);

        this.rows = [];
        this.filtered = [];
        this.sortKey = null;
        this.sortAsc = true;
        this.page = 1;
        this.pageSize = this.cfg.pageSize;

        this._build();
      }

      // ── Budowa DOM ──
      _build() {
        const c = this.cfg;
        const showExport = c.export !== false && c.csvFilename !== false;
        this.el.className = 'bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden transition-colors';
        this.el.innerHTML = `
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-slate-700/60 no-print">
            <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
              <span data-dt-info>Wczytywanie…</span>
            </div>
            <div class="flex items-center gap-2">
              ${showExport ? `
              <button data-dt-export-toggle class="btn btn-xs btn-success" aria-haspopup="true" aria-expanded="false">${ICON_DOWNLOAD}<span>Eksport</span>${ICON_CHEVRON}</button>` : ''}
              <select data-dt-pagesize class="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-white outline-none cursor-pointer">
                ${c.pageSizeOptions.map(n => `<option value="${n}"${n === this.pageSize ? ' selected' : ''}>${n} / str.</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm text-left min-w-[720px]">
              <thead class="text-xs text-gray-500 dark:text-slate-400 uppercase bg-gray-50 dark:bg-slate-700/50">
                <tr data-dt-head></tr>
              </thead>
              <tbody data-dt-body class="divide-y divide-gray-100 dark:divide-slate-700"></tbody>
              <tfoot data-dt-foot class="border-t border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-700/30"></tfoot>
            </table>
          </div>
          <div data-dt-empty class="hidden text-center py-12 text-gray-400 dark:text-slate-500">${c.emptyText}</div>
          <div class="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-slate-700/60 no-print">
            <div class="flex items-center gap-1" data-dt-pager></div>
          </div>`;

        // Nagłówki
        const head = this.el.querySelector('[data-dt-head]');
        c.columns.forEach(col => {
          const th = document.createElement('th');
          th.className = `px-4 py-3 ${col.align === 'right' ? 'text-right' : ''} ${col.sortable !== false ? 'cursor-pointer select-none hover:text-gray-700 dark:hover:text-white' : ''}`;
          th.innerHTML = `<span data-dt-label>${col.label}</span>`;
          if (col.sortable !== false) {
            th.addEventListener('click', () => this._sort(col.key));
          }
          head.appendChild(th);
        });

        this.el.querySelector('[data-dt-pagesize]').addEventListener('change', e => {
          this.pageSize = Number(e.target.value);
          this.page = 1;
          this._render();
        });

        // ── Eksport: rozwijane menu formatów ──
        const toggle = this.el.querySelector('[data-dt-export-toggle]');
        if (toggle) toggle.addEventListener('click', e => {
          e.stopPropagation();
          this._toggleExportMenu(toggle);
        });
      }

      // ── Publiczne ──
      setRows(rows) {
        this.rows = Array.isArray(rows) ? rows : [];
        this._applyLocalSort();
        const maxPage = Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
        if (this.page > maxPage) this.page = maxPage;
        this._render();
      }

      // ── Sortowanie ──
      _sort(key) {
        if (this.sortKey === key) this.sortAsc = !this.sortAsc;
        else { this.sortKey = key; this.sortAsc = true; }
        this._applyLocalSort();
        this._render();
      }
      _applyLocalSort() {
        this.filtered = this.rows.slice();
        if (!this.sortKey) return;
        const col = this.cfg.columns.find(c => c.key === this.sortKey);
        const raw = col && col.sortValue ? col.sortValue : (r => r[this.sortKey]);
        const av = this.filtered.map(r => raw(r));
        const isNum = av.some(v => typeof v === 'number');
        this.filtered.sort((a, b) => {
          let x = raw(a), y = raw(b);
          if (isNum) { x = Number(x) || 0; y = Number(y) || 0; }
          else { x = (x ?? '').toString().toLowerCase(); y = (y ?? '').toString().toLowerCase(); }
          return this.sortAsc ? (x > y ? 1 : x < y ? -1 : 0) : (x < y ? 1 : x > y ? -1 : 0);
        });
      }

      // ── Render ──
      _render() {
        const c = this.cfg;
        const total = this.rows.length;
        const pages = Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
        if (this.page > pages) this.page = pages;
        const start = (this.page - 1) * this.pageSize;
        const slice = this.filtered.slice(start, start + this.pageSize);

        // Info
        const info = this.el.querySelector('[data-dt-info]');
        info.textContent = total === 0
          ? 'Brak rekordów'
          : `Wyświetlono ${start + 1}–${Math.min(start + this.pageSize, this.filtered.length)} z ${this.filtered.length}` +
            (this.filtered.length !== total ? ` (spośród ${total})` : '');

        // Nagłówki ze strzałkami
        this.el.querySelectorAll('[data-dt-head] th').forEach((th, i) => {
          const col = c.columns[i];
          const label = th.querySelector('[data-dt-label]');
          let arrow = '';
          if (col.sortable !== false && this.sortKey === col.key) arrow = this.sortAsc ? ' ▲' : ' ▼';
          label.textContent = col.label + arrow;
        });

        // Wiersze
        const body = this.el.querySelector('[data-dt-body]');
        body.innerHTML = '';
        slice.forEach(row => {
          const tr = document.createElement('tr');
          tr.className = c.rowClass;
          c.columns.forEach(col => {
            const td = document.createElement('td');
            td.className = `px-4 py-3 ${col.align === 'right' ? 'text-right' : ''} ${col.cellClass || ''}`;
            td.innerHTML = col.render ? col.render(row) : (row[col.key] ?? '—');
            tr.appendChild(td);
          });
          body.appendChild(tr);
        });

        // Podsumowanie
        const foot = this.el.querySelector('[data-dt-foot]');
        const sumCols = c.columns.filter(col => col.summary === 'sum');
        if (sumCols.length > 0) {
          const tr = document.createElement('tr');
          c.columns.forEach(col => {
            const td = document.createElement('td');
            td.className = `px-4 py-2.5 text-xs font-semibold text-gray-700 dark:text-slate-300 ${col.align === 'right' ? 'text-right' : ''}`;
            if (col.summary === 'sum') {
              const sum = this.filtered.reduce((s, r) => s + (Number(r[col.key]) || 0), 0);
              td.textContent = `SUMA: ${fmtPLN(sum)}`;
            } else if (col === c.columns[0]) {
              td.textContent = `Razem: ${this.filtered.length} rekordów`;
            }
            tr.appendChild(td);
          });
          foot.innerHTML = '';
          foot.appendChild(tr);
          foot.style.display = '';
        } else {
          foot.style.display = 'none';
        }

        // Pusty stan
        this.el.querySelector('[data-dt-empty]').classList.toggle('hidden', this.filtered.length > 0);

        // Paginacja
        const pager = this.el.querySelector('[data-dt-pager]');
        pager.innerHTML = '';
        const mkBtn = (label, page, opts = {}) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.disabled = !!opts.disabled;
          b.className = `btn btn-xs min-w-[32px] ${opts.active ? 'btn-active' : 'btn-neutral'}`;
          if (!opts.disabled) b.addEventListener('click', () => { this.page = page; this._render(); });
          return b;
        };
        pager.appendChild(mkBtn('‹', this.page - 1, { disabled: this.page <= 1 }));
        const window_ = 2;
        for (let i = 1; i <= pages; i++) {
          if (i === 1 || i === pages || (i >= this.page - window_ && i <= this.page + window_)) {
            pager.appendChild(mkBtn(String(i), i, { active: i === this.page }));
          } else if (i === this.page - window_ - 1 || i === this.page + window_ + 1) {
            const dots = document.createElement('span');
            dots.textContent = '…';
            dots.className = 'px-1 text-gray-400';
            pager.appendChild(dots);
          }
        }
        pager.appendChild(mkBtn('›', this.page + 1, { disabled: this.page >= pages }));
      }

      /* ============================================================
         EKSPORT — wspólny dla wszystkich tabel.
         Formaty: CSV (średnik + BOM), Excel (.xlsx, SheetJS z CDN),
         JSON (tablica obiektów o kluczach = nagłówki).
         ============================================================ */

      // { filename, headers, rows } — z exportData modułu albo z kolumn
      _exportData() {
        const c = this.cfg;
        if (!this.filtered.length) { alert('Brak danych do eksportu.'); return null; }
        const base = String(c.csvFilename || 'export').replace(/\.(csv|xlsx|json)$/i, '');
        if (typeof c.exportData === 'function') {
          const out = c.exportData(this.filtered) || {};
          return {
            filename: String(out.filename || base).replace(/\.(csv|xlsx|json)$/i, ''),
            headers: out.headers || [],
            rows: out.rows || [],
          };
        }
        const cellText = (row, col) => {
          const raw = col.csvValue ? col.csvValue(row) : (col.render ? col.render(row) : row[col.key]);
          return String(raw ?? '').replace(/<[^>]*>/g, '').trim();
        };
        return {
          filename: base,
          headers: c.columns.map(col => col.label),
          rows: this.filtered.map(row => c.columns.map(col => cellText(row, col))),
        };
      }

      _toggleExportMenu(btn) {
        const old = document.querySelector('.dt-export-panel');
        if (old) { old.remove(); btn.setAttribute('aria-expanded', 'false'); return; }

        const panel = document.createElement('div');
        panel.className = 'row-menu-panel dt-export-panel';
        panel.innerHTML = [
          { fmt: 'csv',  ico: ICON_CSV,  label: 'CSV (.csv)' },
          { fmt: 'xlsx', ico: ICON_XLSX, label: 'Excel (.xlsx)' },
          { fmt: 'json', ico: ICON_JSON, label: 'JSON (.json)' },
        ].map(f => `<button type="button" class="row-menu-item" data-fmt="${f.fmt}"><span style="opacity:.65;display:inline-flex">${f.ico}</span>${f.label}</button>`).join('');
        document.body.appendChild(panel);

        // Pozycja: pod przyciskiem, a gdy brak miejsca — nad
        const r = btn.getBoundingClientRect();
        panel.style.visibility = 'hidden';
        panel.classList.remove('hidden');
        const ph = panel.offsetHeight, pw = panel.offsetWidth;
        let top;
        if (window.innerHeight - r.bottom >= ph + 8) top = r.bottom + 4;
        else if (r.top >= ph + 8) top = r.top - ph - 4;
        else top = Math.max(8, window.innerHeight - ph - 8);
        panel.style.top = top + 'px';
        panel.style.left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8)) + 'px';
        panel.style.visibility = '';
        btn.setAttribute('aria-expanded', 'true');

        panel.addEventListener('click', e => {
          const b = e.target.closest('[data-fmt]');
          if (!b) return;
          close();
          this._export(b.dataset.fmt);
        });
        const onDoc = e => { if (!panel.contains(e.target) && e.target !== btn) close(); };
        const close = () => {
          panel.remove();
          btn.setAttribute('aria-expanded', 'false');
          document.removeEventListener('click', onDoc, true);
          window.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('resize', onScroll);
        };
        const onScroll = () => close();
        document.addEventListener('click', onDoc, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
      }

      _export(fmt) {
        const data = this._exportData();
        if (!data) return;
        if (fmt === 'csv') return this._exportCsv(data);
        if (fmt === 'json') return this._exportJson(data);
        if (fmt === 'xlsx') return this._exportXlsx(data);
      }

      _download(content, filename, mime) {
        const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      }

      _exportCsv({ filename, headers, rows }) {
        const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [headers.map(esc).join(';')].concat(rows.map(r => r.map(esc).join(';')));
        this._download('\ufeff' + lines.join('\n'), filename + '.csv', 'text/csv;charset=utf-8');
      }

      _exportJson({ filename, headers, rows }) {
        const objs = rows.map(r => {
          const o = {};
          headers.forEach((h, i) => { o[h] = r[i] ?? ''; });
          return o;
        });
        this._download(JSON.stringify(objs, null, 2), filename + '.json', 'application/json;charset=utf-8');
      }

      async _exportXlsx({ filename, headers, rows }) {
        try {
          const XLSX = await loadXlsxLib();
          const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
          ws['!cols'] = headers.map((h, i) => ({
            wch: Math.min(60, Math.max(String(h).length, 8, ...rows.slice(0, 300).map(r => String(r[i] ?? '').length)) + 2),
          }));
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Eksport');
          XLSX.writeFile(wb, filename + '.xlsx');
        } catch (e) {
          alert('Nie udało się załadować eksportu do Excela. Sprawdź połączenie i spróbuj ponownie.');
        }
      }
    }

    // SheetJS ładowana leniwie z CDN — dopiero przy pierwszym eksporcie do Excela
    let xlsxLoading = null;
    function loadXlsxLib() {
      if (window.XLSX) return Promise.resolve(window.XLSX);
      if (xlsxLoading) return xlsxLoading;
      xlsxLoading = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload = () => (window.XLSX ? res(window.XLSX) : rej(new Error('XLSX undefined')));
        s.onerror = () => { xlsxLoading = null; rej(new Error('load failed')); };
        document.head.appendChild(s);
      });
      return xlsxLoading;
    }

  /* ============================================================
     ROW ACTIONS — pomocnik do kolumny „Akcje"
     Użycie w definicji kolumny:
       render: p => rowActions([
         { label: 'Edytuj', href: '/link/' + p.id },
         { label: 'Usuń', formAction: '/usun/' + p.id,
           confirm: 'Usunąć?', danger: true },        // → czerwone „Usuń"
         { label: 'Zapłacono', formAction: '/zaplacono/' + p.id,
           confirm: 'Zaksięgować?', confirmOk: 'Tak, zaksięguj' }, // → zielony przycisk
       ])
     1 akcja → sam przycisk (bez kropek) · 2+ → menu ⋮
     ============================================================ */
  function rowActions(items) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return '';

    function escAttr(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }
    function oneBtn(a) {
      const cls = 'btn btn-xs ' + (a.danger ? 'btn-delete' : a.primary ? 'btn-primary' : 'btn-neutral');
      if (a.formAction) {
        return '<form method="POST" action="' + escAttr(a.formAction) + '"' +
          (a.confirm ? ' class="js-confirm" data-confirm="' + escAttr(a.confirm) + '"' +
            (a.confirmOk ? ' data-confirm-ok="' + escAttr(a.confirmOk) + '"' : '') +
            (a.danger ? ' data-confirm-danger="1"' : '') : '') +
          ' style="display:inline">' +
          '<button type="submit" class="' + cls + '"' + (a.disabled ? ' disabled' : '') + '>' + a.label + '</button></form>';
      }
      if (a.onclick) {
        return '<button type="button" class="' + cls + '" onclick="' + escAttr(a.onclick) + '"' +
          (a.disabled ? ' disabled' : '') + '>' + a.label + '</button>';
      }
      return '<a href="' + escAttr(a.href || '#') + '" class="' + cls + '"' +
        (a.disabled ? ' aria-disabled="true" tabindex="-1"' : '') + '>' + a.label + '</a>';
    }
    function menuItem(a) {
      const cls = 'row-menu-item' + (a.danger ? ' is-danger' : '');
      if (a.formAction) {
        return '<form method="POST" action="' + escAttr(a.formAction) + '"' +
          (a.confirm ? ' class="js-confirm" data-confirm="' + escAttr(a.confirm) + '"' +
            (a.confirmOk ? ' data-confirm-ok="' + escAttr(a.confirmOk) + '"' : '') +
            (a.danger ? ' data-confirm-danger="1"' : '') : '') +
          ' style="display:block;margin:0">' +
          '<button type="submit" class="' + cls + '"' + (a.disabled ? ' disabled' : '') + '>' + a.label + '</button></form>';
      }
      if (a.onclick) {
        return '<button type="button" class="' + cls + '" onclick="' + escAttr(a.onclick) + '"' +
          (a.disabled ? ' disabled' : '') + '>' + a.label + '</button>';
      }
      return '<a href="' + escAttr(a.href || '#') + '" class="' + cls + '"' +
        (a.disabled ? ' aria-disabled="true" tabindex="-1"' : '') + '>' + a.label + '</a>';
    }
    if (list.length === 1) return oneBtn(list[0]);

    return '<div class="row-menu">' +
      '<button type="button" class="row-menu-btn" aria-haspopup="true" aria-expanded="false" aria-label="Akcje">' +
        '<svg fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>' +
      '</button>' +
      '<div class="row-menu-panel hidden">' + list.map(menuItem).join('') + '</div>' +
    '</div>';
  }

  /* Delegacja: otwieranie/zamykanie menu ⋮ (działa po każdym renderze tabeli) */
  function closeRowMenus(except) {
    document.querySelectorAll('.row-menu').forEach(function (wrap) {
      if (except && wrap === except) return;
      const panel = wrap.querySelector('.row-menu-panel');
      const btn = wrap.querySelector('.row-menu-btn');
      if (panel && !panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        btn && btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  document.addEventListener('click', function (e) {
    const hit = e.target.closest('.row-menu');
    closeRowMenus(hit);

    if (!hit || !e.target.closest('.row-menu-btn')) return;
    const btn = hit.querySelector('.row-menu-btn');
    const panel = hit.querySelector('.row-menu-panel');
    if (!btn || !panel) return;

    if (!panel.classList.contains('hidden')) {   // drugi klik = zamknij
      panel.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
      return;
    }

    // Otwarcie: panel position:fixed → pozycja z prostokąta przycisku,
    // kierunek dół, a gdy brak miejsca — góra (nie da się „uciec" poza ekran)
    const r = btn.getBoundingClientRect();
    panel.classList.remove('hidden');
    panel.style.visibility = 'hidden';
    const ph = panel.offsetHeight;
    const pw = panel.offsetWidth;

    let top;
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    if (spaceBelow >= ph + 8) top = r.bottom + 4;
    else if (spaceAbove >= ph + 8) top = r.top - ph - 4;
    else top = Math.max(8, window.innerHeight - ph - 8);

    panel.style.top = top + 'px';
    panel.style.left = Math.max(8, Math.min(r.right   - pw, window.innerWidth - pw - 8)) + 'px';
    panel.style.visibility = '';
    btn.setAttribute('aria-expanded', 'true');
  });

  // Scroll / resize → zamknij (menu fixed nie powinno „wisieć" w powietrzu)
  window.addEventListener('scroll', function () { closeRowMenus(null); }, true);
  window.addEventListener('resize', function () { closeRowMenus(null); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.row-menu-panel').forEach(function (p) { p.classList.add('hidden'); });
    document.querySelectorAll('.row-menu-btn').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    document.querySelectorAll('.dt-export-panel').forEach(function (p) { p.remove(); });
  });

  /* ============================================================
     ZWIJANY PASEK FILTRÓW — wspólny dla wszystkich modułów.
     Na ekranach ≤ 860px filtry startują ukryte; przycisk
     przełącza Pokaż/Ukryj (strzałka .chev obraca się przez CSS).
     Użycie:
       initCollapsibleFilters('filtersBody', document.getElementById('filtersToggle'));
     ============================================================ */
  function initCollapsibleFilters(bodyId, toggleBtn) {
    const body = document.getElementById(bodyId);
    if (!body || !toggleBtn) return;
    const label = toggleBtn.querySelector('[data-ft-label]') || toggleBtn;
    const apply = () => {
      const collapse = window.innerWidth <= 860;
      toggleBtn.style.display = collapse ? '' : 'none';
      if (collapse && !toggleBtn.classList.contains('open')) body.classList.add('hidden');
      if (!collapse) body.classList.remove('hidden');
    };
    toggleBtn.addEventListener('click', () => {
      const willOpen = body.classList.contains('hidden');
      body.classList.toggle('hidden');
      toggleBtn.classList.toggle('open', willOpen);
      label.textContent = willOpen ? 'Ukryj' : 'Pokaż';
    });
    window.addEventListener('resize', apply);
    apply();
  }

    global.DataTable = DataTable;
    global.rowActions = rowActions;
    global.initCollapsibleFilters = initCollapsibleFilters;
  })(window);