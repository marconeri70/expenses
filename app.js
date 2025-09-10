// ==== Storage helpers (LocalStorage) ====
const KEY = 'expenses_v1';

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

// ==== Elements ====
const form = document.getElementById('expenseForm');
const dateEl = document.getElementById('date');
const categoryEl = document.getElementById('category');
const amountEl = document.getElementById('amount');
const noteEl = document.getElementById('note');

const filterMonthEl = document.getElementById('filterMonth');
const filterCategoryEl = document.getElementById('filterCategory');
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

// ==== PWA install prompt ====
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
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

// Set default date = today
dateEl.value = todayISO();

// ==== Add expense ====
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const item = {
    id: crypto.randomUUID(),
    date: dateEl.value,
    category: categoryEl.value,
    amount: Number(amountEl.value),
    note: noteEl.value.trim()
  };
  expenses.push(item);
  saveExpenses(expenses);
  form.reset();
  dateEl.value = todayISO();
  render();
});

// ==== Delete expense ====
function removeExpense(id){
  expenses = expenses.filter(e => e.id !== id);
  saveExpenses(expenses);
  render();
}

// ==== Filters & Search ====
[filterMonthEl, filterCategoryEl, searchEl].forEach(el => {
  el.addEventListener('input', render);
});
clearFiltersBtn.addEventListener('click', ()=>{
  filterMonthEl.value = '';
  filterCategoryEl.value = '';
  searchEl.value = '';
  render();
});

// ==== Export / Import ====
exportCSVBtn.addEventListener('click', () => {
  const rows = [['Data','Categoria','Importo','Note']];
  getFiltered().forEach(e => rows.push([e.date, e.category, e.amount.toFixed(2), e.note.replaceAll('"','""')]));
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  downloadFile(`spese_${Date.now()}.csv`, 'text/csv', csv);
});
exportJSONBtn.addEventListener('click', () => {
  const data = JSON.stringify(expenses, null, 2);
  downloadFile(`spese_backup_${Date.now()}.json`, 'application/json', data);
});
importJSONEl.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if(!file) return;
  const text = await file.text();
  try{
    const parsed = JSON.parse(text);
    if(Array.isArray(parsed)){
      // Merge by id (avoid duplicates)
      const map = new Map(expenses.map(x => [x.id, x]));
      for(const item of parsed){
        if(item?.id && item?.date && item?.category && typeof item?.amount === 'number'){
          map.set(item.id, item);
        }
      }
      expenses = Array.from(map.values());
      saveExpenses(expenses);
      render();
      alert('Import completato ✅');
    } else {
      alert('File JSON non valido.');
    }
  } catch {
    alert('Errore nel leggere il file JSON.');
  } finally {
    importJSONEl.value = '';
  }
});

function downloadFile(name, type, content){
  const blob = new Blob([content], {type});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ==== Rendering ====
function getFiltered(){
  const month = filterMonthEl.value; // yyyy-mm
  const cat = filterCategoryEl.value;
  const q = searchEl.value.trim().toLowerCase();

  return expenses.filter(e => {
    const mOk = !month || monthKey(e.date) === month;
    const cOk = !cat || e.category === cat;
    const sOk = !q || (e.note?.toLowerCase().includes(q));
    return mOk && cOk && sOk;
  }).sort((a,b) => b.date.localeCompare(a.date));
}

function renderTable(list){
  tbody.innerHTML = '';
  let visTotal = 0;
  for(const e of list){
    visTotal += e.amount;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.date}</td>
      <td>${e.category}</td>
      <td class="num">${fmtEUR(e.amount)}</td>
      <td>${e.note ? escapeHtml(e.note) : ''}</td>
      <td class="num">
        <button class="danger" data-del="${e.id}">Elimina</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('button[data-del]').forEach(btn => {
    btn.addEventListener('click', () => removeExpense(btn.dataset.del));
  });
  visibleTotalEl.textContent = fmtEUR(visTotal);
}

function renderSummary(list){
  // se è selezionato un mese, calcolo su quel mese; altrimenti mese corrente
  const month = filterMonthEl.value || monthKey(todayISO());
  const inMonth = expenses.filter(e => monthKey(e.date) === month);
  const total = inMonth.reduce((s,e)=>s+e.amount,0);
  sumMonthEl.textContent = fmtEUR(total);

  const days = new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate();
  avgDayEl.textContent = fmtEUR(total / days || 0);

  const perCat = {};
  for(const e of inMonth){ perCat[e.category] = (perCat[e.category]||0)+e.amount; }
  const top = Object.entries(perCat).sort((a,b)=>b[1]-a[1])[0];
  topCategoryEl.textContent = top ? `${top[0]} (${fmtEUR(top[1])})` : '—';

  // chart
  const labels = ['Luce','Gas','Acqua','Internet','Affitto','Spesa','Altro'];
  const data = labels.map(l => perCat[l] || 0);
  const ctx = document.getElementById('barChart');
  if(chart){ chart.destroy(); }
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: `Spese per categoria (${month})`, data }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function render(){
  const list = getFiltered();
  renderTable(list);
  renderSummary(list);
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

// ==== First paint ====
render();
