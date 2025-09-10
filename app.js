// ==== Storage helpers (LocalStorage) ====
const KEY = 'expenses_v5'; // bump schema

function loadExpenses(){
  try { return JSON.parse(localStorage.getItem(KEY)) || []; }
  catch { return []; }
}
function saveExpenses(list){
  localStorage.setItem(KEY, JSON.stringify(list));
}

// ==== State ====
let expenses = loadExpenses();
let deferredPrompt = null;
let chart;
let currentReceiptExpenseId = null;

// ==== Category colors ====
const CATEGORY_COLORS = {
  "Luce": "#facc15",     // giallo
  "Gas": "#f97316",      // arancio
  "Acqua": "#3b82f6",    // blu
  "Internet": "#a855f7", // viola
  "Affitto": "#ef4444",  // rosso
  "Spesa": "#22c55e",    // verde
  "Altro": "#64748b"     // grigio
};

// ==== Elements ====
const form = document.getElementById('expenseForm');
const dateEl = document.getElementById('date');
const categoryEl = document.getElementById('category');
const amountEl = document.getElementById('amount');
const noteEl = document.getElementById('note');
const dueDateEl = document.getElementById('dueDate');
const remindDaysEl = document.getElementById('remindDays');
const paidEl = document.getElementById('paid');
const paidDateEl = document.getElementById('paidDate');
const receiptFileEl = document.getElementById('receiptFile');

const filterMonthEl = document.getElementById('filterMonth');
const filterCategoryEl = document.getElementById('filterCategory');
const filterPaidOnlyEl = document.getElementById('filterPaidOnly');
const filterUnpaidOnlyEl = document.getElementById('filterUnpaidOnly');
const filterWithReceiptOnlyEl = document.getElementById('filterWithReceiptOnly');
const clearFiltersBtn = document.getElementById('clearFilters');
const searchEl = document.getElementById('search');

const tbody = document.querySelector('#table tbody');
const visibleTotalEl = document.getElementById('visibleTotal');
const sumMonthEl = document.getElementById('sumMonth');
const avgDayEl = document.getElementById('avgDay');
const topCategoryEl = document.getElementById('topCategory');

const exportCSVBtn = document.getElementById('exportCSV');
const exportJSONBtn = document.getElementById('exportJSON');
const importJSONEl = document.getElementById('importJSON');

const installBtn = document.getElementById('installBtn');

const exportICSMonthBtn = document.getElementById('exportICSMonth');
const exportICSUpcomingBtn = document.getElementById('exportICSUpcoming');

const hiddenReceiptInput = document.getElementById('hiddenReceiptInput');
const countPaidEl = document.getElementById('countPaid');
const countUnpaidEl = document.getElementById('countUnpaid');
const countWithReceiptEl = document.getElementById('countWithReceipt');

// ==== PWA install prompt ====
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn?.addEventListener('click', async () => {
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

// ==== Utils ====
const fmtEUR = (n) => n.toLocaleString('it-IT', { style:'currency', currency:'EUR' });
const toISODate = (d) => new Date(d).toISOString().slice(0,10);
function todayISO(){ return toISODate(new Date()); }
function monthKey(dISO){ return dISO.slice(0,7); } // yyyy-mm
function pad(n){ return String(n).padStart(2,'0'); }
function isoToICSDate(isoYmd){ return isoYmd.replaceAll('-',''); } // all-day

function escapeHtml(s){
  return s.replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function uuid(){ return (crypto?.randomUUID && crypto.randomUUID()) || (Date.now()+'-'+Math.random()); }

dateEl.value = todayISO();

// Pagata: abilita/disabilita data
paidEl?.addEventListener('change', () => {
  paidDateEl.disabled = !paidEl.checked;
  if(paidEl.checked && !paidDateEl.value){
    paidDateEl.value = todayISO();
  }
});

// ==== IndexedDB per RICEVUTE (blob) ====
let db;
function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('speseDB', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains('receipts')){
        db.createObjectStore('receipts', { keyPath: 'expenseId' });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}
async function setReceipt(expenseId, file){
  await openDB();
  const tx = db.transaction('receipts', 'readwrite');
  const store = tx.objectStore('receipts');
  const data = file ? {
    expenseId,
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    blob: file
  } : { expenseId, name: null, type: null, size: 0, blob: null };
  store.put(data);
  return tx.complete;
}
async function getReceipt(expenseId){
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('receipts', 'readonly');
    const store = tx.objectStore('receipts');
    const req = store.get(expenseId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function deleteReceipt(expenseId){
  await openDB();
  const tx = db.transaction('receipts', 'readwrite');
  tx.objectStore('receipts').delete(expenseId);
  return tx.complete;
}

// Helper: torna un Set con id che hanno ricevuta
async function receiptsPresence(ids){
  await openDB();
  const set = new Set();
  // query in sequenza (DB locale, costo ridotto)
  for(const id of ids){
    const r = await getReceipt(id);
    if(r && r.blob) set.add(id);
  }
  return set;
}

// ==== Add expense ====
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const remind = remindDaysEl.value === '' ? 0 : Math.max(0, Math.floor(Number(remindDaysEl.value)));

  const item = {
    id: uuid(),
    date: dateEl.value,
    category: categoryEl.value,
    amount: Number(amountEl.value),
    note: noteEl.value.trim(),
    dueDate: dueDateEl.value || null,
    remindDays: remind,
    paid: !!paidEl.checked,
    paidDate: paidEl.checked ? (paidDateEl.value || todayISO()) : null
  };

  expenses.push(item);
  saveExpenses(expenses);

  const file = receiptFileEl.files?.[0];
  if(file){ await setReceipt(item.id, file); }

  form.reset();
  dateEl.value = todayISO();
  remindDaysEl.value = 2;
  paidDateEl.disabled = true;
  render();
});

// ==== Azioni di riga ====
async function markPaidToday(id){
  const ix = expenses.findIndex(x => x.id === id);
  if(ix < 0) return;
  expenses[ix].paid = true;
  expenses[ix].paidDate = todayISO();
  saveExpenses(expenses);
  render();
}

async function attachReceiptViaPickerFor(id){
  currentReceiptExpenseId = id;
  hiddenReceiptInput.value = '';
  hiddenReceiptInput.click();
}
hiddenReceiptInput.addEventListener('change', async () => {
  const f = hiddenReceiptInput.files?.[0];
  if(!f || !currentReceiptExpenseId) return;
  await setReceipt(currentReceiptExpenseId, f);
  currentReceiptExpenseId = null;
  alert('Ricevuta salvata ✅');
  render();
});

async function viewReceipt(id){
  const r = await getReceipt(id);
  if(!r || !r.blob){ alert('Nessuna ricevuta allegata.'); return; }
  const url = URL.createObjectURL(r.blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function removeReceipt(id){
  await deleteReceipt(id);
  alert('Ricevuta rimossa.');
  render();
}

// ==== Filtri & Search ====
[filterMonthEl, filterCategoryEl, filterPaidOnlyEl, filterUnpaidOnlyEl, filterWithReceiptOnlyEl, searchEl].forEach(el => {
  el.addEventListener('input', render);
});
clearFiltersBtn.addEventListener('click', ()=>{
  filterMonthEl.value = '';
  filterCategoryEl.value = '';
  filterPaidOnlyEl.checked = false;
  filterUnpaidOnlyEl.checked = false;
  filterWithReceiptOnlyEl.checked = false;
  searchEl.value = '';
  render();
});

// ==== Export / Import (CSV/JSON) ====
exportCSVBtn.addEventListener('click', () => {
  const rows = [['Data','Categoria','Importo','Scadenza','Promemoria(giorni)','Pagata','Data pagamento','Note']];
  getFilteredSync().forEach(e => rows.push([
    e.date, e.category, e.amount.toFixed(2),
    e.dueDate || '', String(e.remindDays ?? ''),
    e.paid ? 'Sì' : 'No', e.paidDate || '',
    (e.note||'').replaceAll('"','""')
  ]));
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  downloadFile(`spese_${Date.now()}.csv`, 'text/csv;charset=utf-8', csv);
});
exportJSONBtn.addEventListener('click', () => {
  const data = JSON.stringify(expenses, null, 2); // no ricevute
  downloadFile(`spese_backup_${Date.now()}.json`, 'application/json;charset=utf-8', data);
});
importJSONEl.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if(!file) return;
  const text = await file.text();
  try{
    const parsed = JSON.parse(text);
    if(Array.isArray(parsed)){
      const map = new Map(expenses.map(x => [x.id, x]));
      for(const item of parsed){
        if(item?.id && item?.date && item?.category && typeof item?.amount === 'number'){
          if(item.remindDays == null) item.remindDays = 0;
          if(item.dueDate == null) item.dueDate = null;
          if(item.paid == null) item.paid = false;
          if(item.paid && !item.paidDate) item.paidDate = todayISO();
          map.set(item.id, item);
        }
      }
      expenses = Array.from(map.values());
      saveExpenses(expenses);
      render();
      alert('Import completato ✅ (le ricevute non sono incluse nel JSON)');
    } else {
      alert('File JSON non valido.');
    }
  } catch {
    alert('Errore nel leggere il file JSON.');
  } finally {
    importJSONEl.value = '';
  }
});

// ==== Download helper ====
function downloadFile(name, type, content){
  try{
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  } catch (err){
    console.error('Download fallback', err);
    const encoded = encodeURIComponent(content);
    window.open(`data:${type},${encoded}`, '_blank', 'noopener');
  }
}

// ==== ICS (Calendar) export ====
function makeICS(events){
  const dtstamp = new Date();
  const DTSTAMP = dtstamp.getUTCFullYear()
    + pad(dtstamp.getUTCMonth()+1)
    + pad(dtstamp.getUTCDate()) + 'T'
    + pad(dtstamp.getUTCHours())
    + pad(dtstamp.getUTCMinutes())
    + pad(dtstamp.getUTCSeconds()) + 'Z';

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Spese Familiari//IT',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  for(const ev of events){
    const uid = ev.uid || (uuid()+'@spese-familiari');
    const DTSTART = isoToICSDate(ev.date); // all-day
    const SUMMARY = (ev.summary || '').replace(/\n/g,' ');
    const DESC = (ev.description || '').replace(/\n/g,' ');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${DTSTAMP}`);
    lines.push(`DTSTART;VALUE=DATE:${DTSTART}`);
    lines.push(`SUMMARY:${escapeICS(SUMMARY)}`);
    if(DESC) lines.push(`DESCRIPTION:${escapeICS(DESC)}`);
    if(ev.category) lines.push(`CATEGORIES:${escapeICS(ev.category)}`);
    const d = Number(ev.remindDays ?? 0);
    if(d > 0){
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`TRIGGER:-P${d}D`);
      lines.push('DESCRIPTION:Promemoria bolletta');
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function escapeICS(s){
  return String(s)
    .replace(/\\/g,'\\\\')
    .replace(/\n/g,'\\n')
    .replace(/,/g,'\\,')
    .replace(/;/g,'\\;');
}
function buildCalendarEventFromExpense(e){
  if(!e.dueDate) return null;
  const summary = `Scadenza ${e.category}${e.amount? ' – '+fmtEUR(e.amount): ''}`;
  const description = (e.note ? e.note+' | ' : '') + `Registrata: ${e.date}`;
  return {
    uid: e.id+'@spese-familiari',
    date: e.dueDate,
    summary,
    description,
    category: e.category,
    remindDays: Math.max(0, Number(e.remindDays||0))
  };
}

exportICSMonthBtn?.addEventListener('click', () => {
  const month = filterMonthEl.value || monthKey(todayISO());
  const evs = expenses
    .filter(e => e.dueDate && monthKey(e.dueDate) === month)
    .map(buildCalendarEventFromExpense)
    .filter(Boolean);
  if(evs.length === 0){ alert('Nessuna scadenza nel mese selezionato.'); return; }
  const ics = makeICS(evs);
  downloadFile(`scadenze_${month}.ics`, 'text/calendar;charset=utf-8', ics);
});
exportICSUpcomingBtn?.addEventListener('click', () => {
  const today = todayISO();
  const evs = expenses
    .filter(e => e.dueDate && e.dueDate >= today)
    .sort((a,b)=> a.dueDate.localeCompare(b.dueDate))
    .map(buildCalendarEventFromExpense)
    .filter(Boolean);
  if(evs.length === 0){ alert('Nessuna scadenza futura.'); return; }
  const ics = makeICS(evs);
  downloadFile(`scadenze_future.ics`, 'text/calendar;charset=utf-8', ics);
});

// ==== Rendering ====
// N.B. getFilteredSync non filtra per ricevuta (serve IDB). Il filtro ricevuta si applica in render().
function getFilteredSync(){
  const month = filterMonthEl.value; // yyyy-mm
  const cat = filterCategoryEl.value;
  const q = searchEl.value.trim().toLowerCase();
  const paidOnly = !!filterPaidOnlyEl.checked;
  const unpaidOnly = !!filterUnpaidOnlyEl.checked;

  return expenses.filter(e => {
    const mOk = !month || monthKey(e.date) === month;
    const cOk = !cat || e.category === cat;
    const sOk = !q || (e.note?.toLowerCase().includes(q));
    const pOk = paidOnly ? !!e.paid : (unpaidOnly ? !e.paid : true);
    // filtro "con ricevuta" non qui (richiede IndexedDB)
    return mOk && cOk && sOk && pOk;
  }).sort((a,b) => b.date.localeCompare(a.date));
}

async function renderTable(list){
  // Applica filtro "Solo con ricevuta" usando IndexedDB
  let ids = list.map(e => e.id);
  let withReceipt = new Set();
  if(filterWithReceiptOnlyEl.checked){
    const set = await receiptsPresence(ids);
    withReceipt = set;
    list = list.filter(e => set.has(e.id));
  } else {
    // comunque usa presence per mostrare il badge
    withReceipt = await receiptsPresence(ids);
  }

  tbody.innerHTML = '';
  let visTotal = 0;
  for(const e of list){
    visTotal += e.amount;
    const color = CATEGORY_COLORS[e.category] || '#e2e8f0';
    const hasRec = withReceipt.has(e.id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.date}</td>
      <td>
        <span style="
          background:${color};
          color:#0b1220;
          padding:2px 8px;
          border-radius:999px;
          font-size:0.8rem;
          font-weight:600;
          display:inline-flex;
          align-items:center;
          gap:6px;
        ">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#0b1220;opacity:.5"></span>
          ${e.category}
        </span>
      </td>
      <td class="num">${fmtEUR(e.amount)}</td>
      <td>${e.dueDate || '—'}</td>
      <td>${Number(e.remindDays||0)} gg</td>
      <td>${e.paid ? `Sì (${e.paidDate})` : `<button class="secondary" data-paid="${e.id}">Paga oggi</button>`}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${hasRec ? `<span title="Ricevuta presente" style="font-size:1rem">📎</span>` : `<span title="Nessuna ricevuta" style="color:#94a3b8">—</span>`}
          <button class="secondary" data-recup="${e.id}">Carica</button>
          <button class="secondary" data-recview="${e.id}">Vedi</button>
          <button class="secondary" data-recdel="${e.id}">Rimuovi</button>
        </div>
      </td>
      <td>${e.note ? escapeHtml(e.note) : ''}</td>
      <td class="num">
        ${e.dueDate ? `<button class="secondary" data-ics="${e.id}" title="Scarica .ics">.ics</button>` : `<span style="color:#94a3b8">—</span>`}
        <button class="danger" data-del="${e.id}" title="Elimina">Elimina</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('button[data-del]').forEach(btn => {
    btn.addEventListener('click', () => removeExpense(btn.dataset.del));
  });
  tbody.querySelectorAll('button[data-ics]').forEach(btn => {
    btn.addEventListener('click', () => downloadSingleICS(btn.dataset.ics));
  });
  tbody.querySelectorAll('button[data-paid]').forEach(btn => {
    btn.addEventListener('click', () => markPaidToday(btn.dataset.paid));
  });
  tbody.querySelectorAll('button[data-recup]').forEach(btn => {
    btn.addEventListener('click', () => attachReceiptViaPickerFor(btn.dataset.recup));
  });
  tbody.querySelectorAll('button[data-recview]').forEach(btn => {
    btn.addEventListener('click', () => viewReceipt(btn.dataset.recview));
  });
  tbody.querySelectorAll('button[data-recdel]').forEach(btn => {
    btn.addEventListener('click', () => removeReceipt(btn.dataset.recdel));
  });

  visibleTotalEl.textContent = fmtEUR(visTotal);
}

function downloadSingleICS(id){
  const e = expenses.find(x => x.id === id);
  if(!e){ alert('Elemento non trovato.'); return; }
  if(!e.dueDate){ alert('Aggiungi una data di scadenza prima di esportare il .ics.'); return; }
  const ev = buildCalendarEventFromExpense(e);
  const ics = makeICS([ev]);
  const mm = e.dueDate.slice(0,7);
  downloadFile(`scadenza_${e.category}_${mm}.ics`, 'text/calendar;charset=utf-8', ics);
}

async function renderSummary(list){
  const month = filterMonthEl.value || monthKey(todayISO());

  // Spese registrate nel mese (in base a "Data registrazione")
  const inMonth = expenses.filter(e => monthKey(e.date) === month);

  // Totale & media
  const total = inMonth.reduce((s,e)=>s+e.amount,0);
  sumMonthEl.textContent = fmtEUR(total);

  const days = new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate();
  avgDayEl.textContent = fmtEUR(total / days || 0);

  // Top categoria
  const perCat = {};
  for(const e of inMonth){ perCat[e.category] = (perCat[e.category]||0)+e.amount; }
  const top = Object.entries(perCat).sort((a,b)=>b[1]-a[1])[0];
  topCategoryEl.textContent = top ? `${top[0]} (${fmtEUR(top[1])})` : '—';

  // 👇 Nuovi contatori
  const paidCount = inMonth.filter(e => e.paid).length;
  const unpaidCount = inMonth.length - paidCount;

  // Presenza ricevute (IndexedDB)
  const withRecSet = await receiptsPresence(inMonth.map(e => e.id));
  const withReceiptCount = withRecSet.size;

  countPaidEl.textContent = String(paidCount);
  countUnpaidEl.textContent = String(unpaidCount);
  countWithReceiptEl.textContent = String(withReceiptCount);

  // Grafico multicolore (come prima)
  const labels = Object.keys(CATEGORY_COLORS);
  const data = labels.map(l => perCat[l] || 0);
  const colors = labels.map(l => CATEGORY_COLORS[l]);

  const ctx = document.getElementById('barChart');
  if(chart){ chart.destroy(); }
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: `Spese per categoria (${month})`,
        data,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

async function render(){
  const filtered = getFilteredSync();
  await renderTable(filtered);
  await renderSummary(filtered);
}

// ==== First paint ====
render();


