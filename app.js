const config = window.LIBRARY_CONFIG || {};
const form = document.querySelector('#search-form');
const input = document.querySelector('#search');
const section = document.querySelector('#results-section');
const results = document.querySelector('#results');
const message = document.querySelector('#result-message');
const heading = document.querySelector('#results-title');
const modal = document.querySelector('#detail-modal');
const modalCard = modal.querySelector('.modal-card');
let currentBooks = [];
let previousFocus = null;

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = String(content);
  return node;
}
function showMessage(content) {
  message.textContent = content;
  message.hidden = false;
}
async function searchBooks(query) {
  const url = new URL('/api/library', location.origin);
  url.searchParams.set('action', 'catalog'); url.searchParams.set('q', query);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
  return (await response.json()).books;
}
function renderBooks(books) {
  currentBooks = books;
  results.replaceChildren();
  if (!books.length) return showMessage('ยังไม่พบหนังสือที่ตรงกับคำค้น ลองใช้คำอื่นดูนะครับ');
  books.forEach(book => {
    const card = el('button', 'book-card');
    card.type = 'button';
    if (book.cover_url && /^https:\/\//i.test(book.cover_url)) {
      const cover = el('img', 'book-cover'); cover.src = book.cover_url; cover.alt = ''; cover.loading = 'lazy'; card.append(cover);
    } else card.append(el('span', 'book-spine', '✦'));
    const body = el('span');
    body.append(el('h3', '', book.title), el('p', '', book.author || 'ไม่ระบุผู้เขียน'), el('small', '', book.available_copies > 0 ? 'มีหนังสือให้ยืม' : 'ยังไม่มีเล่มว่าง'));
    card.append(body);
    card.addEventListener('click', () => openDetail(book));
    results.append(card);
  });
}
async function submitSearch(event) {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) { input.focus(); return; }
  section.hidden = false;
  section.scrollIntoView({behavior: 'smooth', block: 'start'});
  heading.textContent = `ผลการค้นหา “${query}”`;
  results.replaceChildren(); message.hidden = true;
  showMessage('กำลังค้นหาหนังสือ...');
  try { const books = await searchBooks(query); message.hidden = true; renderBooks(books); }
  catch (error) { console.error(error); showMessage('ทะเบียนหนังสือยังไม่ได้เชื่อมต่อ กรุณาลองอีกครั้งภายหลัง'); }
}
function openDetail(book) {
  previousFocus = document.activeElement;
  const content = document.querySelector('#detail-content');
  content.replaceChildren();
  content.append(el('span', 'detail-kicker', book.category || 'หนังสือห้องสมุด'));
  const title = el('h2', '', book.title); title.id = 'detail-title'; content.append(title);
  content.append(el('p', 'detail-meta', [book.author && `ผู้เขียน: ${book.author}`, book.isbn && `ISBN: ${book.isbn}`].filter(Boolean).join('  ·  ') || 'รายละเอียดหนังสือ'));
  const availability = el('span', book.available_copies > 0 ? 'availability' : 'availability unavailable', book.available_copies > 0 ? `พร้อมให้ยืม ${book.available_copies} เล่ม` : 'ยังไม่มีเล่มว่าง');
  content.append(availability, el('p', 'detail-description', book.description || 'ยังไม่มีคำอธิบายหนังสือ'));
  content.append(el('p', 'borrow-note', 'ติดต่อเจ้าหน้าที่เพื่อบันทึกยืม–คืนด้วยบัตรสมาชิกวัดใบเดิม และติดตามรายการยืมได้ที่ห้องสมุดของฉัน'));
  const link = el('a', 'borrow-button', 'ดูรายการยืมของฉัน');
  link.href = '#member-area';
  link.addEventListener('click', () => { closeDetail(); loadMyLoans(); });
  content.append(link);
  modal.hidden = false; document.body.style.overflow = 'hidden'; modalCard.focus();
}
function closeDetail() { modal.hidden = true; document.body.style.overflow = ''; previousFocus?.focus(); }
form.addEventListener('submit', submitSearch);
document.querySelector('#clear-search').addEventListener('click', () => { input.value = ''; section.hidden = true; input.focus(); window.scrollTo({top: 0, behavior: 'smooth'}); });
document.querySelector('#close-detail').addEventListener('click', closeDetail);
modal.addEventListener('click', event => { if (event.target.dataset.close) closeDetail(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) closeDetail(); });

// Keep short-lived assertions in memory; renew from the temple's HttpOnly session.
let memberAssertion = null;
let memberExpiry = 0;
async function memberApi(action) {
  if (!memberAssertion || Date.now() >= memberExpiry) {
    const response = await fetch('https://watt.nathoeng.com/api/line-login?route=library-session', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) {
      const error = new Error(response.status === 401 ? 'กรุณาเข้าสู่ระบบสมาชิกวัดก่อน แล้วกลับมาใช้ห้องสมุดได้เลย' : 'ยังเชื่อมบัญชีสมาชิกไม่ได้ กรุณาลองใหม่อีกครั้ง');
      error.loginRequired = response.status === 401;
      throw error;
    }
    const data = await response.json();
    memberAssertion = data.token; memberExpiry = Date.now() + 120000;
  }
  const response = await fetch(`/api/library?action=${encodeURIComponent(action)}`, { cache: 'no-store', headers: { Authorization: `Bearer ${memberAssertion}` } });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) { memberAssertion = null; memberExpiry = 0; }
    throw new Error(data.error || 'ยังโหลดรายการไม่ได้ กรุณาลองใหม่');
  }
  return data;
}
function memberError(error) {
  document.querySelector('#member-status').textContent = error.message;
  document.querySelector('#member-login').hidden = !error.loginRequired;
}
async function loadMyLoans() {
  const target = document.querySelector('#my-loans');
  const button = document.querySelector('#my-loans-button');
  button.disabled = true; target.textContent = 'กำลังโหลดรายการ…';
  try {
    const { loans } = await memberApi('my-loans');
    target.replaceChildren();
    if (!loans.length) target.textContent = 'ยังไม่มีรายการยืมหนังสือ';
    for (const loan of loans) {
      const row = el('article', 'member-loan');
      row.append(el('strong', '', loan.library_copies?.books?.title || 'หนังสือห้องสมุด'));
      row.append(el('p', '', `${loan.library_copies?.barcode || ''} · ${loan.status === 'returned' ? 'คืนแล้ว' : 'กำลังยืม'}`));
      if (loan.due_at) row.append(el('small', '', `กำหนดคืน ${new Date(loan.due_at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}`));
      target.append(row);
    }
  } catch (error) { target.textContent = ''; memberError(error); }
  finally { button.disabled = false; }
}
document.querySelector('#my-loans-button').addEventListener('click', loadMyLoans);
(async () => {
  try {
    const member = await memberApi('me');
    document.querySelector('#member-status').textContent = `${member.name} · เชื่อมบัญชีสมาชิกวัดแล้ว`;
    document.querySelector('#member-actions').hidden = false;
    document.querySelector('#staff-link').hidden = !member.staff;
    document.querySelector('.member-link').textContent = 'บัญชีของฉัน ↗';
    if (new URLSearchParams(location.search).get('member') === '1') await loadMyLoans();
  } catch (error) { memberError(error); }
})();
