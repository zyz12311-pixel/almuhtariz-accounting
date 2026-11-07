export function mountPosCatalog({ root, api, esc, money, addItem, pricing }) {
  const find = selector => root.querySelector(selector);
  const search = find('#pos-search'), grid = find('.product-grid');
  const previous = find('#pos-previous'), next = find('#pos-next'), summary = find('#pos-results');
  const scanner = find('#barcode-input'), form = find('#barcode-form'), message = find('#barcode-message');
  let page = 1, timer, controller;

  async function load(requestedPage) {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    previous.disabled = next.disabled = true;
    grid.replaceChildren();
    summary.textContent = 'جارٍ البحث…';
    try {
      const query = new URLSearchParams({ q: search.value.trim(), page: requestedPage });
      const result = await api('pos/catalog?' + query, { signal: request.signal });
      if (request.signal.aborted || !root.isConnected) return;
      page = result.page;
      previous.disabled = page <= 1;
      next.disabled = page >= result.pages;
      summary.textContent = result.total ? `${result.total} صنف · صفحة ${page} من ${result.pages}` : 'لا توجد أصناف مطابقة';
      grid.innerHTML = result.rows.map((item, index) => `<button type="button" data-product="${index}"><span>◇</span><b>${esc(item.name_ar)}</b><small>${money(item.unit_price)} ر.س / ${esc(item.base_unit)}</small>${pricing.wholesale&&item.wholesale_price!=null?`<small>جملة ${money(item.wholesale_price)} ر.س</small>`:''}<small dir="ltr">${esc(item.barcode || '')}</small></button>`).join('');
      for (const button of grid.querySelectorAll('[data-product]')) {
        button.onclick = () => {
          try {
            addItem(result.rows[Number(button.dataset.product)]);
            scanner.focus();
          } catch (error) {
            message.textContent = error.message;
          }
        };
      }
    } catch (error) {
      if (request.signal.aborted || !root.isConnected) return;
      summary.textContent = error.message + ' ';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'إعادة البحث';
      retry.onclick = () => load(requestedPage);
      summary.append(retry);
    }
  }

  search.oninput = () => {
    clearTimeout(timer);
    controller?.abort();
    previous.disabled = next.disabled = true;
    grid.replaceChildren();
    summary.textContent = 'جارٍ البحث…';
    timer = setTimeout(() => { if (root.isConnected) load(1); }, 200);
  };
  previous.onclick = () => load(page - 1);
  next.onclick = () => load(page + 1);

  // Keep scan order even when a reader sends the next code before SQLite replies.
  let scans = Promise.resolve(), pending = 0;
  form.onsubmit = event => {
    event.preventDefault();
    const code = scanner.value.trim();
    if (!code) return;
    scanner.value = '';
    scanner.focus();
    form.dataset.pending = String(++pending);
    scans = scans.then(async () => {
      if (!root.isConnected) return;
      const { item } = await api('pos/catalog/barcode?' + new URLSearchParams({ code }));
      if (!root.isConnected) return;
      if (item) addItem(item);
      message.textContent = item ? 'أضيف: ' + item.name_ar + (item.scale_code?' · '+item.scale_qty+' كجم':'') : 'لم نجد صنفًا بهذا الباركود: ' + code;
    }).catch(error => {
      if (root.isConnected) message.textContent = error.message;
    }).finally(() => { form.dataset.pending = String(--pending); });
  };
  return load(1);
}
