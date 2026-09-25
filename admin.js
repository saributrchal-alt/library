const $ = (selector) => document.querySelector(selector);
let inventory = { books: [], copies: [] };
let member = null;
let assertion = null;
let expiry = 0;
function note(message, error = false) {
  const node = $('#feedback'); node.textContent = message; node.classList.toggle('error', error);
}
async function authenticate() {
  if (assertion && Date.now() < expiry) return assertion;
  const response = await fetch('https://watt.nathoeng.com/api/line-login?route=library-session', { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 401 ? 'กรุณาเข้าสู่ระบบสมาชิกที่เว็บไซต์วัดก่อน แล้วกลับมาหน้านี้' : 'ยังเชื่อมต่อสิทธิ์สมาชิกวัดไม่ได้');
  const data = await response.json(); assertion = data.token; expiry = Date.now() + 120000;
  return assertion;
}
async function api(action, method = 'GET', data = null, params = {}) {
  const token = await authenticate();
  const url = new URL('/api/library', location.origin); url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'บันทึกไม่สำเร็จ');
  return result;
}
function data(form) { return Object.fromEntries(new FormData(form).entries()); }
function option(value, label) { const item = document.createElement('option'); item.value = value; item.textContent = label; return item; }
async function refresh() {
  inventory = await api('inventory');
  const select = $('#book-select'), selected = select.value;
  select.replaceChildren(option('', 'เลือกชื่อเรื่อง'));
  for (const book of inventory.books) select.append(option(book.id, `${book.title}${book.isbn ? ` · ${book.isbn}` : ''}`));
  select.value = selected;
  renderInventory();
}
function renderInventory() {
  const list = $('#inventory-list'), query = $('#inventory-search').value.trim().toLowerCase();
  list.replaceChildren();
  const copies = inventory.copies.filter(copy => {
    const book = inventory.books.find(b => b.id === copy.book_id);
    return `${copy.barcode} ${book?.title || ''} ${book?.isbn || ''}`.toLowerCase().includes(query);
  });
  if (!copies.length) { list.textContent = 'ยังไม่มีตัวเล่มที่ตรงกับการค้นหา'; return; }
  for (const copy of copies) {
    const book = inventory.books.find(b => b.id === copy.book_id);
    const row = document.createElement('div'); row.className = 'inventory-row';
    const label = document.createElement('div'), title = document.createElement('strong'), details = document.createElement('small');
    title.textContent = book?.title || 'ไม่พบชื่อเรื่อง'; details.textContent = `${copy.barcode} · ${copy.shelf || 'ไม่ระบุชั้น'} · ${copy.status}`;
    label.append(title, details); row.append(label);
    const menu = document.createElement('select'); menu.setAttribute('aria-label', `เปลี่ยนสถานะ ${copy.barcode}`);
    menu.append(option('', 'จัดการตัวเล่ม'), option('repair', 'พักซ่อม'), option('retire', 'สละออก'), option('restore', 'นำกลับใช้'));
    menu.addEventListener('change', async () => {
      if (!menu.value) return;
      if (copy.status === 'on_loan') { note('ต้องรับคืนก่อนเปลี่ยนสถานะตัวเล่ม', true); menu.value = ''; return; }
      const action = menu.value;
      if (action === 'retire' && !confirm(`ยืนยันสละออก ${copy.barcode}?`)) { menu.value = ''; return; }
      try { await api(action, 'POST', { barcode: copy.barcode, note: action === 'retire' ? prompt('เหตุผลที่สละออก (ถ้ามี)') || '' : '' }); note(`บันทึก ${copy.barcode} เรียบร้อย`); await refresh(); }
      catch (error) { note(error.message, true); menu.value = ''; }
    }); row.append(menu); list.append(row);
  }
}
async function lookupMember(card, target) {
  member = null;
  const result = await api('member', 'GET', null, { card });
  member = result.member;
  target.replaceChildren();
  if (!member) { target.textContent = 'ไม่พบบัตรสมาชิกนี้ในทะเบียนวัด'; return; }
  const box = document.createElement('div');
  box.textContent = `${member.name} · ${member.cardNumber} · ${member.status === 'active' ? 'สมาชิกใช้งานได้' : 'สมาชิกไม่มีสิทธิ์ใช้งาน'}`;
  target.append(box);
}
async function lookupIsbn() {
  const code = $('#isbn').value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^\d{9}[\dX]$|^\d{13}$/.test(code)) throw Error('กรุณาสแกน ISBN 10 หรือ 13 หลัก');
  const url = new URL('https://openlibrary.org/api/books');
  url.search = new URLSearchParams({ bibkeys: `ISBN:${code}`, jscmd: 'data', format: 'json' });
  const response = await fetch(url);
  if (!response.ok) throw Error('แหล่งข้อมูลหนังสือยังไม่พร้อม');
  const found = (await response.json())[`ISBN:${code}`];
  if (!found) throw Error('ไม่พบข้อมูล ISBN นี้ กรุณากรอกชื่อและลิงก์หน้าปกเอง');
  const form = $('#book-form');
  form.elements.title.value = found.title || '';
  form.elements.author.value = (found.authors || []).map(a => a.name).join(', ');
  form.elements.category.value = (found.subjects || [])[0]?.name || '';
  form.elements.description.value = typeof found.notes === 'string' ? found.notes : (found.notes?.value || '');
  form.elements.coverUrl.value = found.cover?.medium || '';
  form.elements.sourceUrl.value = found.url || `https://openlibrary.org/isbn/${code}`;
  previewCover(); note('ดึงข้อมูลมาให้ตรวจและแก้ไขก่อนบันทึกแล้ว');
}
function previewCover() {
  const box = $('#cover-preview'), url = $('#book-form').elements.coverUrl.value.trim();
  box.replaceChildren();
  if (!/^https:\/\//.test(url)) { box.textContent = 'ตัวอย่างหน้าปก'; return; }
  const image = document.createElement('img'); image.src = url; image.alt = 'ตัวอย่างหน้าปก';
  image.onerror = () => { box.textContent = 'แสดงภาพจากลิงก์นี้ไม่ได้'; };
  box.append(image);
}
async function save(form, action, success) {
  try { const result = await api(action, 'POST', data(form)); note(success(result)); await refresh(); return result; }
  catch (error) { note(error.message, true); return null; }
}
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const result = await api('me');
    if (!result.staff) throw Error('บัญชีนี้ยังไม่มีสิทธิ์ผู้ดูแลระบบวัด');
    $('#auth-status').hidden = true; $('#admin-app').hidden = false;
    await refresh();
  } catch (error) {
    $('#auth-status').classList.add('error');
    $('#auth-status').textContent = error.message;
    const link = document.createElement('a'); link.href = 'https://watt.nathoeng.com/'; link.textContent = ' ไปเข้าสู่ระบบสมาชิกวัด ↗';
    $('#auth-status').append(link);
  }
});
document.querySelectorAll('.tabs button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('selected', b === button));
  document.querySelectorAll('.tab-panel').forEach(p => p.hidden = p.id !== button.dataset.tab);
}));
$('#inventory-search').addEventListener('input', renderInventory);
$('#isbn').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('#lookup-isbn').click(); } });
$('#lookup-isbn').addEventListener('click', () => lookupIsbn().catch(error => note(error.message, true)));
$('#book-form').elements.coverUrl.addEventListener('input', previewCover);
$('#book-form').addEventListener('submit', async event => { event.preventDefault(); const result = await save(event.target, 'book', r => `บันทึกชื่อเรื่อง ${r.book.title} แล้ว`); if (result) $('#book-select').value = result.book.id; });
$('#receive-form').addEventListener('submit', async event => { event.preventDefault(); const result = await save(event.target, 'receive', r => `รับเข้าแล้ว: ${r.copy.barcode}`); if (result) { $('#last-barcode').hidden = false; $('#last-barcode').textContent = `รหัสติดหนังสือ: ${result.copy.barcode}`; event.target.elements.barcode.value = ''; } });
$('#member-form').addEventListener('submit', async event => { event.preventDefault(); try { await lookupMember(data(event.target).card, $('#member-result')); } catch (e) { note(e.message, true); } });
$('#loan-card').addEventListener('change', async event => { try { await lookupMember(event.target.value, $('#member-match')); } catch (e) { note(e.message, true); } });
$('#loan-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target, body = data(form);
  if (!member || member.cardNumber !== body.card || member.status !== 'active') return note('สแกนและตรวจสมาชิกก่อนยืม', true);
  body.dueAt = body.dueAt ? `${body.dueAt}T23:59:59+07:00` : null;
  await save(form, 'checkout', r => `บันทึกยืม ${r.result.barcode} ให้ ${r.member.name} แล้ว`);
});
$('#return-form').addEventListener('submit', async event => { event.preventDefault(); const result = await save(event.target, 'return', r => `รับคืน ${r.result.barcode} แล้ว`); if (result) event.target.reset(); });
