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
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || `บันทึกไม่สำเร็จ (HTTP ${response.status})`);
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
  const edit=$('#edit-book'),editing=edit.value;edit.replaceChildren(option('','เพิ่มชื่อเรื่องใหม่'));for(const b of inventory.books)edit.append(option(b.id,b.title));edit.value=editing;
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
    title.textContent = book?.title || 'ไม่พบชื่อเรื่อง'; details.textContent = `${copy.barcode} · ${copy.shelf || 'ไม่ระบุชั้น'} · ${window.LIBRARY_STATUS[copy.status]||copy.status}`;
    label.append(title, details); row.append(label);
    const menu = document.createElement('select'); menu.setAttribute('aria-label', `เปลี่ยนสถานะ ${copy.barcode}`);
    menu.append(option('', 'จัดการตัวเล่ม'), option('repair', 'พักซ่อม'), option('retire', 'สละออก'), option('restore', 'นำกลับใช้'));
    menu.addEventListener('change', async () => {
      if (!menu.value) return;
      if (!['available','repair','retired'].includes(copy.status)) { note('ต้องรับคืนก่อนเปลี่ยนสถานะตัวเล่ม', true); menu.value = ''; return; }
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
  form.elements.subject.value = (found.subjects || [])[0]?.name || '';
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
  const button = form.querySelector('button[type="submit"]');
  let status = form.querySelector('.save-status');
  if (!status) {
    status = document.createElement('p');
    status.className = 'save-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    button.after(status);
  }
  button.disabled = true;
  status.classList.remove('error');
  status.textContent = 'กำลังบันทึก...';
  try {
    const payload=data(form);if(payload.dueAt)payload.dueAt+='T23:59:59+07:00';
    const result = await api(action, 'POST', payload);
    status.textContent = success(result);
    note(status.textContent);
    try { await refresh(); }
    catch (error) { note(`บันทึกแล้ว แต่โหลดรายการใหม่ไม่สำเร็จ: ${error.message}`, true); }
    return result;
  } catch (error) {
    status.textContent = error.message || 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง';
    status.classList.add('error');
    note(status.textContent, true);
    status.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return null;
  } finally {
    button.disabled = false;
  }
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
    if (/เข้าสู่ระบบสมาชิกวัดก่อน/.test(error.message)) {
      const link = document.createElement('a'); link.href = 'https://watt.nathoeng.com/'; link.textContent = ' ไปเข้าสู่ระบบสมาชิกวัด ↗';
      $('#auth-status').append(link);
    }
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
$('#book-form').addEventListener('submit', async event => { event.preventDefault(); if(coverBusy)return; const f=event.target;f.elements.category.value=window.LIBRARY_CATEGORIES.find(c=>c[0]===f.elements.classification.value)?.[1]||'';const cover=f.elements.coverUrl.value;if(cover&&!cover.includes('/storage/v1/object/public/library-covers/')&&!/^https:\/\/media\.nathoeng\.com\/uploads\/library\/\d{4}\/\d{2}\/[a-f0-9]{32}\.webp$/.test(cover)){try{await importCover();}catch(e){note(e.message,true);return;}} const result = await save(event.target, 'book', r => `บันทึกชื่อเรื่อง ${r.book.title} แล้ว`); if (result) {$('#book-select').value = result.book.id;$('#book-form').elements.id.value=result.book.id;$('#edit-book').value=result.book.id;} });
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


// Catalog classification and compressed cover storage.
for(const [code,label] of window.LIBRARY_CATEGORIES) $('#classification').append(option(code,`${code} · ${label}`));
$('#classification').value='294.3';
for(const label of window.LIBRARY_SUBJECTS) $('#subjects').append(option(label,label));
$('#desk-terms').textContent=window.LIBRARY_TERMS;
let coverBusy=false;
async function storeCover(file) {
  if(coverBusy) throw Error('กำลังเตรียมภาพ กรุณารอสักครู่');
  coverBusy=true;
  const submit=$('#book-form button[type="submit"]'); submit.disabled=true;
  let bitmap;
  try {
    $('#image-status').textContent='กำลังย่อและเก็บภาพ…';
    if(file.size>20*1024*1024 || !file.type.startsWith('image/')) throw Error('เลือกไฟล์ภาพขนาดไม่เกิน 20 MB');
    bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
    const canvas=document.createElement('canvas'),scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    let blob;
    for(const quality of [.85,.7,.55,.4,.25]) { blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=512000) break; }
    if(!blob||blob.size>512000) throw Error('ภาพยังใหญ่เกินไป กรุณาเลือกภาพอื่น');
    const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
    const result=await api('cover','POST',{image});
    $('#book-form').elements.coverUrl.value=result.url;previewCover();
    $('#image-status').textContent=`เก็บภาพแล้ว · ${Math.round(blob.size/1024)} KB · กดบันทึกชื่อเรื่องเพื่อใช้ภาพนี้`;
  } catch(error) { $('#image-status').textContent=error.message; throw error; }
  finally {bitmap?.close();coverBusy=false;submit.disabled=false;}
}
async function importCover() {
  const value=$('#book-form').elements.coverUrl.value.trim();
  if(!/^https:\/\//i.test(value)) throw Error('ใส่ URL ภาพ HTTPS ก่อน');
  let response;
  try {response=await fetch(value,{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!response.ok) throw Error();}
  catch {throw Error('เว็บไซต์ต้นทางไม่อนุญาตให้ดึงภาพ กรุณาบันทึกรูปแล้วใช้ปุ่มเลือกรูปภาพ');}
  await storeCover(await response.blob());
}
$('#import-cover').onclick=()=>importCover().catch(e=>note(e.message,true));
for(const id of ['#cover-file','#cover-camera']) $(id).onchange=event=>{if(event.target.files[0]) storeCover(event.target.files[0]).catch(e=>note(e.message,true));};
$('#edit-book').onchange=()=>{
 const form=$('#book-form'),book=inventory.books.find(b=>b.id===$('#edit-book').value);form.reset();
 form.elements.id.value=book?.id||'';
 if(book) for(const [field,key] of Object.entries({title:'title',author:'author',isbn:'isbn',classification:'classification',category:'category',subject:'subject',coverUrl:'cover_url',sourceUrl:'source_url',publisher:'publisher',publishedYear:'published_year',edition:'edition',language:'language',pages:'pages',callNumber:'call_number',description:'description'})) form.elements[field].value=book[key]??'';
 if(!form.elements.classification.value)form.elements.classification.value='294.3';
 $('#image-status').textContent='เลือกหรือถ่ายภาพใหม่ได้';previewCover();
};

const labelStatus=s=>window.LIBRARY_STATUS[s]||s;
const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
let requests=[];
for(const [value,label] of Object.entries(window.LIBRARY_STATUS)) $('#request-filter').append(option(value,label));
async function loadRequests(){try{requests=(await api('loans')).loans;renderRequests();}catch(e){note(e.message,true);}}
$('#refresh-requests').onclick=loadRequests;$('#request-filter').onchange=renderRequests;
document.querySelector('[data-tab="requests"]').addEventListener('click',loadRequests);
function renderRequests(){
 const box=$('#request-list');box.replaceChildren();const filter=$('#request-filter').value;
 const rows=requests.filter(l=>filter==='all'||(filter==='active'?!['returned','rejected','cancelled'].includes(l.status):l.status===filter));
 if(!rows.length)box.textContent='ไม่มีรายการในสถานะนี้';
 for(const loan of rows){
   const card=node('article','');card.className='request-card';
   card.append(node('h3',loan.library_copies?.books?.title||'หนังสือ'),node('p',`${loan.library_copies?.barcode||''} · ${labelStatus(loan.status)}`),node('p',`สมาชิก: ${loan.recipient||loan.member_id} · ${loan.delivery_method==='pickup'?'รับที่วัด':'จัดส่ง COD'}`));
   if(loan.phone)card.append(node('p',`โทร. ${loan.phone}`));if(loan.address)card.append(node('p',loan.address));
   if(loan.tracking_number)card.append(node('p',`ขาไป: ${loan.carrier} · ${loan.tracking_number}`));
   if(loan.return_tracking_number)card.append(node('p',`ขากลับ: ${loan.return_carrier} · ${loan.return_tracking_number}`));
   if(loan.return_method==='pickup')card.append(node('p','ผู้ยืมเลือกนำมาคืนที่วัด'));
   if(loan.due_at)card.append(node('p',`กำหนดคืน ${new Date(loan.due_at).toLocaleDateString('th-TH')}`));
   card.append(LibraryLoanProgress.render(loan));
   const form=node('form','');form.className='loan-controls';
   function field(name,label,type='text'){const wrap=node('label',label),input=node('input','');input.name=name;input.type=type;wrap.append(input);form.append(wrap);return input;}
   if(loan.status==='pending') field('dueAt','กำหนดคืน (ถ้ามี)','date');
   if(loan.status==='ready_ship'){field('carrier','บริษัทขนส่ง');field('trackingNumber','เลขพัสดุขาไป');field('returnAddress','ที่อยู่ห้องสมุดและเบอร์โทรสำหรับส่งคืน');}
   if(['on_loan','return_shipping'].includes(loan.status)){const wrap=node('label','สภาพเมื่อรับคืน'),select=node('select','');select.name='condition';select.append(option('available','พร้อมให้ยืม'),option('repair','ต้องพักซ่อม'));wrap.append(select);form.append(wrap);}
   field('note','หมายเหตุ');
   const actions={pending:[['approve','อนุมัติ'],['reject','ไม่อนุมัติ']],ready_pickup:[['handover','ส่งมอบให้ผู้ยืมแล้ว'],['cancel','ยกเลิก']],ready_ship:[['ship','บันทึกจัดส่งแล้ว'],['cancel','ยกเลิก']],shipped:[['received','ยืนยันผู้ยืมได้รับแล้ว']],on_loan:[['accept_return','ตรวจรับคืนแล้ว']],return_shipping:[['accept_return','ตรวจรับคืนแล้ว']]}[loan.status]||[];
   for(const [operation,label] of actions){const button=node('button',label);button.type='button';button.className='secondary';button.onclick=async()=>{
      if(['ship'].includes(operation)&&(!form.elements.carrier.value.trim()||!form.elements.trackingNumber.value.trim()))return note('กรอกบริษัทขนส่งและเลขพัสดุ',true);
      if(!confirm(`${label} — ${loan.library_copies?.barcode||''}?`))return;
      form.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{const payload=data(form);if(payload.dueAt)payload.dueAt+='T23:59:59+07:00';await api('loan-action','POST',{...payload,loanId:loan.id,operation});note('บันทึกแล้ว');await loadRequests();await refresh();}catch(e){note(e.message,true);}finally{form.querySelectorAll('button').forEach(b=>b.disabled=false);}
   };form.append(button);}
   if(actions.length)card.append(form);
   if(loan.delivery_method==='ship_cod'){const print=node('button','พิมพ์ฉลากจัดส่ง');print.className='secondary';print.onclick=()=>printLabel(loan);card.append(print);}
   const history=node('button','ดูประวัติ');history.className='secondary';history.onclick=async()=>{try{const result=await api('history','GET',null,{loanId:loan.id});const ul=node('ul','');for(const e of result.events)ul.append(node('li',`${new Date(e.created_at).toLocaleString('th-TH')} · ${eventLabel(e.event_type)}${e.details?' · '+e.details:''}`));history.replaceWith(ul);}catch(e){note(e.message,true);}};card.append(history);box.append(card);
 }
}
function eventLabel(s){return ({approve:'อนุมัติ',reject:'ไม่อนุมัติ',cancel:'ยกเลิก',ship:'จัดส่ง',handover:'รับที่วัด',received:'ผู้ยืมได้รับแล้ว',accept_return:'เจ้าหน้าที่รับคืน',return_pickup:'เลือกคืนที่วัด'})[s]||labelStatus(s);}
async function printLabel(loan){
 try { const {showShippingLabel}=await import('/shipping-label.js');showShippingLabel(loan); }
 catch(error){note('เปิดตัวอย่างฉลากไม่ได้ กรุณาลองใหม่',true);}
}

let cameraStream=null;
function closeCamera(){cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;$('#camera-video').srcObject=null;$('#camera-panel').hidden=true;}
$('#open-camera').onclick=async()=>{
 try{closeCamera();if(!navigator.mediaDevices?.getUserMedia)throw Error('อุปกรณ์นี้ไม่รองรับการเปิดกล้อง ใช้ตัวเลือกกล้องของอุปกรณ์หรือเลือกรูปได้');cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});$('#camera-video').srcObject=cameraStream;$('#camera-panel').hidden=false;await $('#camera-video').play();}
 catch(e){closeCamera();note(e.name==='NotAllowedError'?'ยังไม่ได้รับสิทธิ์กล้อง กรุณาอนุญาตกล้อง หรือเลือกรูปภาพ':e.message,true);}
};
$('#close-camera').onclick=closeCamera;
$('#snap-cover').onclick=async()=>{
 const video=$('#camera-video');if(!video.videoWidth)return note('รอภาพจากกล้องสักครู่',true);
 const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);closeCamera();
 try{const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!blob)throw Error('ถ่ายภาพไม่สำเร็จ');await storeCover(blob);}catch(e){note(e.message,true);}
};
window.addEventListener('pagehide',closeCamera);
document.addEventListener('visibilitychange',()=>{if(document.hidden)closeCamera();});
