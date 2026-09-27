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
let resultPage=0;
let searchSequence=0;
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
async function searchBooks(query,page=0) {
  const url = new URL('/api/library', location.origin);
  url.searchParams.set('action', 'catalog'); url.searchParams.set('q', query);url.searchParams.set('page',page);url.searchParams.set('category',document.querySelector('#category-filter').value);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
  return await response.json();
}
function renderBooks(books,append=false) {
  currentBooks = append?[...currentBooks,...books]:books;
  if(!append)results.replaceChildren();
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
  const sequence=++searchSequence;resultPage=0;document.querySelector('#more-books').hidden=true;
  section.hidden = false;
  section.scrollIntoView({behavior: 'smooth', block: 'start'});
  heading.textContent = query?`ผลการค้นหา “${query}”`:"หนังสือในห้องสมุด";
  results.replaceChildren(); message.hidden = true;
  showMessage('กำลังค้นหาหนังสือ...');
  try { const data = await searchBooks(query);if(sequence!==searchSequence)return; message.hidden = true; renderBooks(data.books);document.querySelector('#more-books').hidden=!data.hasMore; }
  catch (error) { console.error(error); showMessage('ทะเบียนหนังสือยังไม่ได้เชื่อมต่อ กรุณาลองอีกครั้งภายหลัง'); }
}
async function openDetail(book) {
  previousFocus = document.activeElement;
  const content=document.querySelector('#detail-content');content.replaceChildren(el('h2','','กำลังโหลด…'));
  modal.hidden=false;document.body.style.overflow='hidden';modalCard.focus();
  try {
    const response=await fetch(`/api/library?action=detail&id=${encodeURIComponent(book.id)}`),data=await response.json();
    if(!response.ok)throw Error(data.error||'โหลดหนังสือไม่ได้');
    book=data.book;content.replaceChildren();
    const title=el('h2','',book.title);title.id='detail-title';content.append(title);
    if(/^https:\/\//i.test(book.cover_url||'')){const img=el('img','detail-cover');img.src=book.cover_url;img.alt=`ปก ${book.title}`;content.append(img);}
    const dl=el('dl','book-metadata');
    for(const [label,key] of [['ผู้เขียน','author'],['ISBN','isbn'],['หมวด','category'],['เลขหมู่','classification'],['หัวข้อ','subject'],['เลขเรียกหนังสือ','call_number'],['สำนักพิมพ์','publisher'],['ปีพิมพ์','published_year'],['ครั้งที่พิมพ์','edition'],['ภาษา','language'],['จำนวนหน้า','pages']]){dl.append(el('dt','',label),el('dd','',book[key]||'ไม่ระบุ'));}
    content.append(dl,el('p','detail-description',book.description||'ยังไม่มีคำอธิบาย'),el('p','availability',`พร้อมให้ยืม ${book.available_copies} จาก ${book.total_copies} เล่ม`));
    const copies=el('ul','copy-list');for(const copy of data.copies)copies.append(el('li','',`${copy.barcode} · ${window.LIBRARY_STATUS[copy.status]||copy.status} · ${copy.shelf||'ยังไม่ระบุชั้น'}`));content.append(copies);
    if(book.available_copies>0)content.append(await reservationForm(book));
    else content.append(el('p','borrow-note','ยังไม่มีตัวเล่มพร้อมให้ยืม'));
  }catch(error){content.replaceChildren(el('h2','','เปิดรายละเอียดไม่สำเร็จ'),el('p','',error.message));}
}
async function reservationForm(book){
 const f=el('form','reservation-form');f.append(el('h3','','จองเพื่อยืม'),el('p','','ไม่ต้องระบุเวลารับหนังสือ'));
 const method=el('select');method.name='method';method.append(new Option('รับด้วยตนเองที่วัด','pickup'),new Option('ส่งไปอ่านที่บ้าน · ค่าส่ง COD','ship_cod'));
 const methodLabel=el('label','','วิธีรับหนังสือ');methodLabel.append(method);f.append(methodLabel);
 const {mountAddress}=await import('/address-form.js');
 let defaults={},profileError='';
 try{defaults=(await memberApi('borrow-profile')).profile;}catch(error){profileError=error.message;}
 const contact=mountAddress(f,defaults);
 if(profileError)f.append(el('p','borrow-note',profileError));
 f.append(el('p','borrow-note',window.LIBRARY_TERMS));
 const acceptLabel=el('label','checkbox'),accept=el('input');accept.type='checkbox';accept.required=true;acceptLabel.append(accept,document.createTextNode('ข้าพเจ้ายอมรับเงื่อนไขการยืมและรับผิดชอบค่าขนส่งตามวิธีที่เลือก'));f.append(acceptLabel);
 const submit=el('button','borrow-button','ส่งคำขอจองยืม');submit.type='submit';const status=el('p');status.setAttribute('role','status');f.append(submit,status);
 f.onsubmit=async event=>{
  event.preventDefault();submit.disabled=true;status.textContent='กำลังจอง…';
  try{contact.validate();await memberApi('reserve','POST',{...Object.fromEntries(new FormData(f)),bookId:book.id,accepted:accept.checked,termsVersion:window.LIBRARY_TERMS_VERSION});status.textContent='ส่งคำขอแล้ว · ตัวเล่มถูกกันไว้ รอเจ้าหน้าที่อนุมัติ';submit.textContent='จองแล้ว';await loadMyLoans();}
  catch(error){status.textContent=error.message;submit.disabled=false;if(error.loginRequired){const a=el('a','','เข้าสู่ระบบสมาชิกวัด');a.href='https://watt.nathoeng.com/#login-page';status.append(a);}}
 };return f;
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
async function memberApi(action,method='GET',body=null,params={}) {
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
  const response = await fetch(`/api/library?${new URLSearchParams({action,...params})}`, { method,cache: 'no-store', headers: { Authorization: `Bearer ${memberAssertion}`,...(body?{'Content-Type':'application/json'}:{}) },...(body?{body:JSON.stringify(body)}:{}) });
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
      row.append(el('p', '', `${loan.library_copies?.barcode || ''} · ${window.LIBRARY_STATUS[loan.status]||loan.status}`));
      row.append(el('p','',loan.delivery_method==='pickup'?'รับที่วัด':'จัดส่งไปอ่านที่บ้าน · ค่าส่ง COD'));
      if (loan.due_at) row.append(el('small', '', `กำหนดคืน ${new Date(loan.due_at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}`));
      if(loan.tracking_number)row.append(el('p','',`ขาไป: ${loan.carrier} · ${loan.tracking_number}`));
      if(loan.return_address)row.append(el('p','','ที่อยู่ส่งคืน: '+loan.return_address));
      if(loan.return_tracking_number)row.append(el('p','',`ขากลับ: ${loan.return_carrier} · ${loan.return_tracking_number}`));
      if(loan.return_method==='pickup'&&loan.status!=='returned')row.append(el('p','','เลือกนำมาคืนที่วัด · รอเจ้าหน้าที่รับคืน'));
      const feedback=el('p');feedback.setAttribute('role','status');
      async function action(operation,extra={},button){
        button.disabled=true;feedback.textContent='กำลังบันทึก…';
        try{await memberApi('loan-action','POST',{loanId:loan.id,operation,...extra});await loadMyLoans();}
        catch(e){feedback.textContent=e.message;button.disabled=false;}
      }
      function button(label,operation){const btn=el('button','',label);btn.type='button';btn.onclick=()=>{if(confirm(`${label}?`))action(operation,{},btn);};row.append(btn);}
      if(['pending','ready_pickup','ready_ship'].includes(loan.status))button('ยกเลิกการจอง','cancel');
      if(loan.status==='shipped')button('ฉันได้รับหนังสือแล้ว','received');
      if(loan.status==='on_loan'){
        button('เลือกนำมาคืนเองที่วัด','return_pickup');
        const f=el('form','return-form');f.append(el('h4','','แจ้งส่งคืนทางขนส่ง'),el('p','','ผู้ยืมชำระค่าส่งขากลับ ไม่เรียกเก็บปลายทางจากวัด · ส่งกลับตามที่อยู่ห้องสมุดที่แสดงในรายการนี้ หากไม่พบที่อยู่ กรุณาติดต่อเจ้าหน้าที่ก่อนส่ง'));
        for(const [name,label] of [['carrier','บริษัทขนส่ง'],['trackingNumber','เลขพัสดุขากลับ']]){const wrap=el('label','',label),input=el('input');input.name=name;input.required=true;input.maxLength=100;wrap.append(input);f.append(wrap);}
        const btn=el('button','','แจ้งส่งคืนแล้ว');btn.type='submit';f.append(btn);f.onsubmit=e=>{e.preventDefault();action('return_shipping',Object.fromEntries(new FormData(f)),btn);};row.append(f);
      }
      const history=el('button','','ประวัติรายการ');history.type='button';history.onclick=async()=>{history.disabled=true;try{const data=await memberApi('history','GET',null,{loanId:loan.id});const ul=el('ul');for(const e of data.events)ul.append(el('li','',`${new Date(e.created_at).toLocaleString('th-TH')} · ${({approve:'อนุมัติ',reject:'ไม่อนุมัติ',cancel:'ยกเลิก',ship:'จัดส่ง',handover:'รับที่วัด',received:'รับหนังสือแล้ว',accept_return:'ตรวจรับคืนแล้ว',return_pickup:'เลือกนำมาคืนที่วัด'})[e.event_type]||window.LIBRARY_STATUS[e.event_type]||e.event_type}`));history.replaceWith(ul);}catch(e){feedback.textContent=e.message;history.disabled=false;}};row.append(history,feedback);
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


for(const [code,label] of window.LIBRARY_CATEGORIES)document.querySelector('#category-filter').append(new Option(`${code} · ${label}`,code));
document.querySelector('#category-filter').onchange=()=>form.requestSubmit();
document.querySelector('#more-books').onclick=async function(){this.disabled=true;const sequence=searchSequence;try{const data=await searchBooks(input.value.trim(),resultPage+1);if(sequence!==searchSequence)return;resultPage++;renderBooks(data.books,true);this.hidden=!data.hasMore;}catch{showMessage('โหลดเพิ่มไม่สำเร็จ กรุณาลองใหม่');}finally{this.disabled=false;}};
modal.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const nodes=[...modalCard.querySelectorAll('a,button,input,select,textarea,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});
const bookId=new URLSearchParams(location.search).get('book');if(bookId)openDetail({id:bookId});
