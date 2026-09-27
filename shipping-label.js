const SENDER_ADDRESS = "231 หมู่ 2 บ้านตาลเดี่ยว\nต.ธาตุ อ.วานรนิวาส จ.สกลนคร 47120\nโทร. 0963513441";
const n=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls||'';if(text!=null)el.textContent=text;return el;};
// Code 39 (wide:narrow = 3:1), internal copy ID only; never a carrier barcode.
const patterns={0:'nnnwwnwnn',1:'wnnwnnnnw',2:'nnwwnnnnw',3:'wnwwnnnnn',4:'nnnwwnnnw',5:'wnnwwnnnn',6:'nnwwwnnnn',7:'nnnwnnwnw',8:'wnnwnnwnn',9:'nnwwnnwnn',A:'wnnnnwnnw',B:'nnwnnwnnw',C:'wnwnnwnnn',D:'nnnnwwnnw',E:'wnnnwwnnn',F:'nnwnwwnnn',G:'nnnnnwwnw',H:'wnnnnwwnn',I:'nnwnnwwnn',J:'nnnnwwwnn',K:'wnnnnnnww',L:'nnwnnnnww',M:'wnwnnnnwn',N:'nnnnwnnww',O:'wnnnwnnwn',P:'nnwnwnnwn',Q:'nnnnnnwww',R:'wnnnnnwwn',S:'nnwnnnwwn',T:'nnnnwnwwn',U:'wwnnnnnnw',V:'nwwnnnnnw',W:'wwwnnnnnn',X:'nwnnwnnnw',Y:'wwnnwnnnn',Z:'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','*':'nwnnwnwnn'};
function barcode(value){
 const code=String(value||'').toUpperCase();if(!/^[A-Z0-9.-]{4,24}$/.test(code))return null;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');let x=12;
 for(const char of '*'+code+'*'){const pattern=patterns[char];for(let i=0;i<9;i++){const w=pattern[i]==='w'?3:1;if(i%2===0){const r=document.createElementNS(ns,'rect');r.setAttribute('x',x);r.setAttribute('y',0);r.setAttribute('width',w);r.setAttribute('height',32);svg.append(r);}x+=w;}x++;}
 svg.setAttribute('viewBox',`0 0 ${x+12} 32`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`รหัสตัวเล่ม ${code}`);return svg;
}
export function renderShippingLabel(loan){
 const label=n('article','parcel-label');
 const head=n('header','parcel-head'),brand=n('div');brand.append(n('strong','','NATHOENG'),n('span','','LIBRARY · ห้องสมุดนาเทิง'));head.append(brand,n('b','parcel-service','BOOK\nDELIVERY'));label.append(head);
 const route=n('div','parcel-route');route.append(n('strong','',loan.carrier||'รอระบุบริษัทขนส่ง'),n('span','','TH / พัสดุหนังสือ'));label.append(route);
 const recipient=n('section','parcel-recipient');recipient.append(n('div','parcel-caption','TO / ผู้รับ'),n('h2','',loan.recipient||'ยังไม่ระบุชื่อผู้รับ'),n('b','parcel-phone',loan.phone?`โทร. ${loan.phone}`:'ยังไม่ระบุเบอร์โทร'),n('p','parcel-address',loan.address||'ยังไม่ระบุที่อยู่'));
 const postcode=String(loan.address||'').match(/\b[1-9]\d{4}\b(?=\s*$)/);if(postcode)recipient.append(n('div','parcel-postcode',postcode[0]));label.append(recipient);
 const sender=n('section','parcel-sender');sender.append(n('span','parcel-caption','FROM / ผู้ส่ง · ที่อยู่ส่งคืน'),n('b','','ห้องสมุดวัดพุทธอุทยานนาเทิง'),n('p','',SENDER_ADDRESS));label.append(sender);
 const item=n('section','parcel-item');item.append(n('span','parcel-caption','CONTENTS / รายการหนังสือ'),n('p','',loan.library_copies?.books?.title||'หนังสือห้องสมุด'));
 const code=loan.library_copies?.barcode||'';const bars=barcode(code);if(bars)item.append(bars);item.append(n('span','parcel-copy',`รหัสตัวเล่ม · ${code||'—'}`));label.append(item);
 const footer=n('footer','parcel-footer');footer.append(n('strong','','COD · เก็บเฉพาะค่าขนส่งปลายทาง'),n('span','','ไม่ใช่ราคาหนังสือ • โปรดรักษาพัสดุให้แห้ง'));label.append(footer);
 return label;
}
export function showShippingLabel(loan,{demo=false}={}){
 document.querySelector('#parcel-overlay')?.remove();
 if(!document.querySelector('link[data-parcel]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/shipping-label.css';css.dataset.parcel='true';document.head.append(css);}
 const overlay=n('div','parcel-overlay');overlay.id='parcel-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','ตัวอย่างฉลากพัสดุ');
 const toolbar=n('div','parcel-toolbar'),description=n('div');description.append(n('strong','','ฉลากพัสดุ · 100 × 150 มม.'),n('small','',demo?'ตัวอย่างข้อมูลสมมติ':'เลือกกระดาษ 100 × 150 มม. · ขนาดจริง 100% · ปิดหัว/ท้ายกระดาษ'));
 const print=n('button','','พิมพ์ฉลาก'),close=n('button','','ปิด');print.type=close.type='button';toolbar.append(description,print,close);overlay.append(toolbar);
 const notice=n('p','parcel-notice');notice.setAttribute('role','status');overlay.append(notice);
 const paper=renderShippingLabel(loan);overlay.append(paper);document.body.append(overlay);
 const previous=document.activeElement,oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
 const dismiss=()=>{overlay.remove();document.body.classList.remove('printing-parcel');document.body.style.overflow=oldOverflow;document.removeEventListener('keydown',keys);previous?.focus();};
 function keys(e){if(e.key==='Escape')dismiss();if(e.key==='Tab'){if(e.shiftKey&&document.activeElement===print){e.preventDefault();close.focus();}else if(!e.shiftKey&&document.activeElement===close){e.preventDefault();print.focus();}}}document.addEventListener('keydown',keys);close.onclick=dismiss;
 print.onclick=async()=>{
  await document.fonts.ready;
  const missing=!loan.recipient||!loan.phone||!loan.address;
  if(missing){notice.textContent='กรอกชื่อผู้รับ เบอร์โทร และที่อยู่ผู้รับให้ครบก่อนพิมพ์';return;}
  if(paper.scrollHeight>paper.clientHeight+2){notice.textContent='ข้อความยาวเกินฉลาก กรุณาย่อรายละเอียดที่ไม่จำเป็นก่อนพิมพ์ เพื่อไม่ให้ข้อมูลถูกตัด';return;}
  notice.textContent='';document.body.classList.add('printing-parcel');window.print();document.body.classList.remove('printing-parcel');
 };print.focus();return overlay;
}
