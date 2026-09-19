const cfg = window.APP_CONFIG || {};
const configured =
  typeof cfg.SUPABASE_URL === 'string' &&
  cfg.SUPABASE_URL.startsWith('https://') &&
  typeof cfg.SUPABASE_ANON_KEY === 'string' &&
  cfg.SUPABASE_ANON_KEY.length > 20;
const $ = id => document.getElementById(id);
const rub = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
const fmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
let items = [], shown = [], editId = null;

const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return dateKey(d); };
const sum = a => a.reduce((s, x) => s + Number(x.amount), 0);
const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fingerprint = x => [x.due_date, x.supplier, Number(x.amount), x.purpose || '', x.method || '', x.document || '', x.note || ''].join('\u001f');

function message(text, bad = false) {
  $('message').innerHTML = text ? `<div class="${bad ? 'error' : 'notice'}">${bad ? '' : '✓ '}${safe(text)}</div>` : '';
  if (text && !bad) setTimeout(() => message(''), 4500);
}
function connection(text, state) {
  $('connectionText').textContent = text;
  $('connectionText').parentElement.className = `connection ${state || ''}`;
}
async function requestPayments(query = 'select=*', options = {}) {
  if (!configured) throw new Error('Не заполнены настройки Supabase');
  const response = await fetch(`${cfg.SUPABASE_URL}/rest/v1/payments?${query}`, {
    ...options,
    headers: {
      apikey: cfg.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).message || ''; } catch (_) {}
    throw new Error(detail || `Ошибка базы данных: ${response.status}`);
  }
  return response;
}
async function fetchAllPayments() {
  const all = [];
  for (let start = 0; ; start += 1000) {
    const response = await requestPayments('select=*&order=due_date.asc&order=id.asc', {
      headers: { Range: `${start}-${start + 999}` }
    });
    const page = await response.json();
    all.push(...page);
    if (page.length < 1000) return all;
  }
}
async function load() {
  connection('Загружаем общую базу…');
  try {
    items = await fetchAllPayments();
    connection(`Общая база подключена · ${items.length} записей`, 'ok');
    fillSuppliers();
    render();
  } catch (error) {
    items = [];
    render();
    connection('Ошибка подключения', 'bad');
    message(`Не удалось открыть общую базу: ${error.message}`, true);
  }
}
function fillSuppliers() {
  const current = $('supplier').value;
  const names = [...new Set(items.map(x => x.supplier))].sort((a, b) => a.localeCompare(b, 'ru'));
  $('supplier').innerHTML = '<option value="">Все поставщики</option>' +
    names.map(x => `<option ${x === current ? 'selected' : ''}>${safe(x)}</option>`).join('');
}
function render() {
  const q = $('search').value.trim().toLowerCase();
  const s = $('supplier').value;
  const m = $('methodFilter').value;
  const from = $('from').value;
  const to = $('to').value;
  shown = items.filter(x =>
    (!q || [x.supplier, x.purpose, x.method, x.document, x.note, x.amount].join(' ').toLowerCase().includes(q)) &&
    (!s || x.supplier === s) && (!m || x.method === m) &&
    (!from || x.due_date >= from) && (!to || x.due_date <= to)
  );
  const today = dateKey(), tomorrow = plus(1), week = plus(7);
  const cards = [
    ['Записи на сегодня', sum(items.filter(x => x.due_date === today)), 1],
    ['Записи на завтра', sum(items.filter(x => x.due_date === tomorrow))],
    ['Ближайшие 7 дней', sum(items.filter(x => x.due_date >= today && x.due_date <= week))],
    ['Всего в журнале', sum(items)]
  ];
  $('cards').innerHTML = cards.map(([t, v, a]) =>
    `<article class="card ${a ? 'accent' : ''}"><span>${t}</span><b>${rub.format(v)}</b></article>`
  ).join('');
  $('counter').textContent = `Показано ${shown.length} из ${items.length}`;
  $('filteredSum').textContent = rub.format(sum(shown));
  $('rows').innerHTML = shown.length ? shown.map(x => `<tr>
    <td><b>${fmt.format(new Date(x.due_date + 'T12:00'))}</b></td>
    <td><b>${safe(x.supplier)}</b><span>${safe(x.purpose || x.note || 'Без назначения')}</span></td>
    <td class="money">${rub.format(x.amount)}</td><td>${safe(x.method)}</td>
    <td><div class="rowActions"><button onclick="editEntry(${x.id})">✎</button><button onclick="deleteEntry(${x.id})">×</button></div></td>
  </tr>`).join('') : '<tr><td colspan="5" class="empty">Записей не найдено</td></tr>';
}
function openForm(x = null) {
  editId = x?.id || null;
  $('formTitle').textContent = x ? 'Изменить запись' : 'Новая запись';
  $('date').value = x?.due_date || dateKey();
  $('amount').value = x?.amount || '';
  $('name').value = x?.supplier || '';
  $('purpose').value = x?.purpose || '';
  $('method').value = x?.method || 'Наличные';
  $('document').value = x?.document || '';
  $('note').value = x?.note || '';
  $('modal').classList.remove('hidden');
  setTimeout(() => $('name').focus(), 50);
}
function closeForm() { $('modal').classList.add('hidden'); editId = null; }
window.editEntry = id => openForm(items.find(x => x.id === id));
window.deleteEntry = async id => {
  if (!confirm('Удалить эту запись?')) return;
  try {
    await requestPayments(`id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
    message('Запись удалена');
  } catch (error) { message(error.message, true); }
};

$('entryForm').onsubmit = async e => {
  e.preventDefault();
  const record = {
    due_date: $('date').value, supplier: $('name').value.trim(), amount: Number($('amount').value),
    purpose: $('purpose').value.trim(), method: $('method').value,
    document: $('document').value.trim(), note: $('note').value.trim(),
    updated_at: new Date().toISOString()
  };
  try {
    if (editId) {
      await requestPayments(`id=eq.${encodeURIComponent(editId)}`, { method: 'PATCH', body: JSON.stringify(record) });
    } else {
      await requestPayments('', { method: 'POST', body: JSON.stringify(record) });
    }
    closeForm();
    await load();
    message('Запись сохранена');
  } catch (error) { message(error.message, true); }
};

$('addBtn').onclick = () => openForm();
$('closeBtn').onclick = $('cancelBtn').onclick = closeForm;
$('modal').onclick = e => { if (e.target === $('modal')) closeForm(); };
['search', 'supplier', 'methodFilter', 'from', 'to'].forEach(id =>
  $(id).addEventListener(id === 'search' ? 'input' : 'change', render)
);
$('resetBtn').onclick = () => {
  $('search').value = ''; $('supplier').value = ''; $('methodFilter').value = '';
  $('from').value = ''; $('to').value = ''; render();
};
document.querySelectorAll('[data-range]').forEach(b => b.onclick = () => {
  const t = b.dataset.range, today = dateKey(), tomorrow = plus(1);
  $('from').value = ''; $('to').value = '';
  if (t === 'today') $('from').value = $('to').value = today;
  if (t === 'tomorrow') $('from').value = $('to').value = tomorrow;
  if (t === 'week') { $('from').value = today; $('to').value = plus(7); }
  if (t === 'future') $('from').value = today;
  if (t === 'month') {
    const d = new Date(); $('from').value = `${today.slice(0, 8)}01`;
    $('to').value = dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }
  render();
});

$('importBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (!window.XLSX) throw new Error('Не загрузился модуль Excel. Обновите страницу');
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const ws = wb.Sheets['Выплаты'] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const hi = rows.findIndex(r => r.some(v => ['Дата', 'Дата выплаты'].includes(String(v).trim())));
    if (hi < 0) throw new Error('Не найдена строка заголовков');
    const h = rows[hi].map(v => String(v).trim());
    const col = (...names) => names.map(x => h.indexOf(x)).find(i => i >= 0) ?? -1;
    const dc = col('Дата', 'Дата выплаты'), sc = col('Поставщик'), ac = col('Сумма');
    const parse = v => {
      if (v instanceof Date) return dateKey(v);
      const match = String(v).match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
      return match ? `${match[3].length === 2 ? '20' + match[3] : match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : '';
    };
    const records = rows.slice(hi + 1).flatMap(r => {
      const due_date = parse(r[dc]), supplier = String(r[sc] || '').trim(), amount = Number(r[ac] || 0);
      return due_date && supplier && amount > 0 ? [{
        due_date, supplier, amount,
        purpose: String(r[col('Назначение / товар')] || ''),
        method: String(r[col('Способ оплаты')] || 'Наличные') || 'Наличные',
        document: String(r[col('Документ / чек')] || ''),
        note: String(r[col('Примечание')] || '')
      }] : [];
    });
    const known = new Set(items.map(fingerprint));
    const fresh = records.filter(x => !known.has(fingerprint(x)) && known.add(fingerprint(x)));
    if (fresh.length) await requestPayments('', { method: 'POST', body: JSON.stringify(fresh) });
    await load();
    message(`Добавлено: ${fresh.length}. Пропущено дублей: ${records.length - fresh.length}`);
  } catch (error) { message(`Ошибка импорта: ${error.message}`, true); }
  e.target.value = '';
};

$('exportBtn').onclick = () => {
  if (!window.XLSX) return message('Не загрузился модуль Excel. Обновите страницу', true);
  const data = [['Дата', 'Поставщик', 'Сумма', 'Назначение / товар', 'Способ оплаты', 'Документ / чек', 'Примечание'],
    ...shown.map(x => [x.due_date, x.supplier, x.amount, x.purpose, x.method, x.document, x.note])];
  const ws = XLSX.utils.aoa_to_sheet(data), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Выплаты');
  XLSX.writeFile(wb, `журнал-${dateKey()}.xlsx`);
};

load();
