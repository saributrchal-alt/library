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
function configured() { return Boolean(config.supabaseUrl && config.supabaseAnonKey); }
async function searchBooks(query) {
  const base = String(config.supabaseUrl).replace(/\/$/, '');
  const url = new URL(`${base}/rest/v1/books`);
  url.searchParams.set('select', 'id,title,author,description,category,isbn,cover_url,available_copies,total_copies');
  url.searchParams.set('is_active', 'eq.true');
  url.searchParams.set('or', `(title.ilike.%${query}%,author.ilike.%${query}%,category.ilike.%${query}%)`);
  url.searchParams.set('order', 'title.asc');
  url.searchParams.set('limit', '40');
  const response = await fetch(url, {headers: {apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}`}});
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
  return response.json();
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
  if (!configured()) return showMessage('หน้าเว็บพร้อมแล้ว กำลังเชื่อมต่อทะเบียนหนังสือของห้องสมุด โปรดลองอีกครั้งภายหลัง');
  showMessage('กำลังค้นหาหนังสือ...');
  try { const books = await searchBooks(query); message.hidden = true; renderBooks(books); }
  catch (error) { console.error(error); showMessage('ยังค้นหารายการหนังสือไม่ได้ในขณะนี้ กรุณาลองอีกครั้งภายหลัง'); }
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
  content.append(el('p', 'borrow-note', 'สมาชิกวัดใช้บัตรสมาชิกใบเดิมเพื่อใช้สิทธิ์ห้องสมุด ระบบขอยืมจะเปิดเมื่อเชื่อมการยืนยันตัวตนและเจ้าหน้าที่เรียบร้อย'));
  const link = el('a', 'borrow-button', 'ไปยังเว็บสมาชิกวัด ↗');
  link.href = config.templeMemberUrl || 'https://watt.nathoeng.com/';
  content.append(link);
  modal.hidden = false; document.body.style.overflow = 'hidden'; modalCard.focus();
}
function closeDetail() { modal.hidden = true; document.body.style.overflow = ''; previousFocus?.focus(); }
form.addEventListener('submit', submitSearch);
document.querySelector('#clear-search').addEventListener('click', () => { input.value = ''; section.hidden = true; input.focus(); window.scrollTo({top: 0, behavior: 'smooth'}); });
document.querySelector('#close-detail').addEventListener('click', closeDetail);
modal.addEventListener('click', event => { if (event.target.dataset.close) closeDetail(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) closeDetail(); });
