import { randomUUID } from 'node:crypto';
const str = (v, n = 300) => String(v ?? '').trim().slice(0, n);
const enc = encodeURIComponent;
async function session(token) {
  if (!token || token.length > 4000) return null;
  const response = await fetch('https://watt.nathoeng.com/api/line-login?route=library-verify', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  if (response.status === 401) return null;
  if (response.status === 400 || response.status === 405) throw new Error('TEMPLE_VERSION_OLD');
  if (!response.ok) throw new Error('Temple verification unavailable');
  const claim = await response.json();
  return claim?.sub ? claim : null;
}
async function db(path, method = 'GET', body) {
  const key = process.env.SUPABASE_SECRET_KEY;
  const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(`${new URL(process.env.SUPABASE_URL).origin}/rest/v1/${path}`, {
    method, cache: 'no-store', headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const raw = await response.text();
  let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const error = new Error(data?.message || `Database error ${response.status}`);
    error.httpStatus = response.status;
    error.dbCode = String(data?.code || '').slice(0,30);
    throw error;
  }
  return data;
}
async function dbAll(path) {
  const result=[];
  for(let offset=0;;offset+=1000){const rows=await db(`${path}&limit=1000&offset=${offset}`);result.push(...rows);if(rows.length<1000)return result;}
}
function isbn(raw) {
  const code = str(raw, 20).replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(code) && [...code].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0) % 10 === 0) return code;
  if (/^\d{9}[\dX]$/.test(code) && [...code].reduce((s, d, i) => s + (10 - i) * (d === 'X' ? 10 : Number(d)), 0) % 11 === 0) return code;
  return null;
}
async function memberByCard(raw) {
  const card = str(raw, 39);
  if (!/^2\d{12}$/.test(card)) return null;
  let sum = 0; for (let i = 0; i < 12; i++) sum += Number(card[i]) * (i % 2 ? 3 : 1);
  if ((10 - sum % 10) % 10 !== Number(card[12])) return null;
  const cards = await db(`member_card_numbers?card_number=eq.${enc(card)}&select=member_id&limit=1`);
  if (!cards.length) return null;
  const people = await db(`members?id=eq.${enc(cards[0].member_id)}&select=id,full_name,display_name,role,membership_status&limit=1`);
  const person = people[0];
  return person ? { id: person.id, name: person.full_name || person.display_name || 'สมาชิก', role: person.role, status: person.membership_status || 'active', cardNumber: card } : null;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const action = str(req.query.action, 30);
  if (['catalog','detail'].includes(action) && req.method === 'GET') {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return res.status(503).json({ error: 'ยังไม่ได้เชื่อมทะเบียนหนังสือ' });
    try {
      const fields='id,title,author,description,category,isbn,cover_url,available_copies,total_copies,classification,subject,publisher,published_year,edition,language,pages,call_number';
      if (action==='detail') {
        if (!/^[0-9a-f-]{36}$/i.test(str(req.query.id))) return res.status(400).json({error:'รหัสหนังสือไม่ถูกต้อง'});
        const books=await db(`books?id=eq.${enc(req.query.id)}&is_active=eq.true&select=${fields}&limit=1`);
        if (!books[0]) return res.status(404).json({error:'ไม่พบหนังสือ'});
        const copies=await db(`library_copies?book_id=eq.${enc(req.query.id)}&status=neq.retired&select=barcode,status,shelf&order=barcode.asc`);
        return res.json({book:books[0],copies});
      }
      const query=str(req.query.q,80).replace(/[^\p{L}\p{N}\s-]/gu,' ').trim();
      const category=str(req.query.category,20);
      const page=Math.max(0,Math.min(10000,Number.parseInt(req.query.page,10)||0));
      let path=`books?is_active=eq.true&select=${fields}&order=title.asc,id.asc&limit=41&offset=${page*40}`;
      if(query) path+=`&or=(${['title','author','category','isbn','subject','call_number'].map(k=>`${k}.ilike.${enc('%'+query+'%')}`).join(',')})`;
      if(category && /^\d{3}(\.\d+)?$/.test(category)) path+=`&classification=like.${enc(category==='200'?'2*':category.endsWith('00')?category[0]+'*':category+'*')}`;
      const books=await db(path);
      return res.json({books:books.slice(0,40),hasMore:books.length>40,page});
    } catch(error) { console.error('Catalog:',error); return res.status(503).json({ error: 'ยังค้นหาทะเบียนหนังสือไม่ได้', dbStatus: error.httpStatus || null, dbCode: error.dbCode || null }); }
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
    return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่าการเชื่อมระบบสมาชิก' });
  let claim;
  try { claim = await session(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')); }
  catch (error) { return res.status(503).json({ error: error.message === 'TEMPLE_VERSION_OLD' ? 'เว็บวัดยังไม่ใช้เวอร์ชันตรวจสิทธิ์ห้องสมุดล่าสุด กรุณานำ Deployment ล่าสุดของเว็บวัดขึ้น Production' : 'ยังตรวจสอบสิทธิ์กับเว็บไซต์วัดไม่ได้ กรุณาลองใหม่อีกครั้ง' }); }
  if (!claim) return res.status(401).json({ error: 'ข้อมูลเข้าสู่ระบบหมดอายุ กรุณารีเฟรชหน้าเจ้าหน้าที่' });
  try {
    const people = await db(`members?id=eq.${enc(claim.sub)}&select=id,full_name,display_name,role,membership_status&limit=1`);
    const actor = people[0];
    if (!actor || (actor.membership_status && actor.membership_status !== 'active')) return res.status(403).json({ error: 'สมาชิกไม่มีสิทธิ์ใช้งาน' });
    const staff = actor.role === 'admin';
    if (action === 'me' && req.method === 'GET') return res.json({ id: actor.id, name: actor.full_name || actor.display_name || 'สมาชิก', role: actor.role, staff });
    if (action === 'my-loans' && req.method === 'GET') {
      const loans = await db(`library_loans?member_id=eq.${enc(actor.id)}&select=*,library_copies(barcode,books(title,author,cover_url))&order=borrowed_at.desc&limit=100`);
      return res.json({ loans });
    }
    if(action==='reserve' && req.method==='POST') {
      const b=req.body||{};
      if(!/^[0-9a-f-]{36}$/i.test(str(b.bookId)) || b.accepted!==true || b.termsVersion!=='2026-09-27' || !['pickup','ship_cod'].includes(b.method)) return res.status(400).json({error:'เลือกหนังสือ วิธีรับ และยอมรับเงื่อนไขก่อนจอง'});
      const loan=await db('rpc/library_reserve','POST',{p_book:b.bookId,p_actor:actor.id,p_method:b.method,p_recipient:str(b.recipient,200),p_phone:str(b.phone,40),p_address:str(b.address,1000),p_terms:b.termsVersion});
      return res.json({loan});
    }
    if(action==='loan-action' && req.method==='POST') {
      const b=req.body||{}, allowed=staff?['approve','reject','cancel','ship','handover','received','return_shipping','return_pickup','accept_return']:['cancel','received','return_shipping','return_pickup'];
      if(!allowed.includes(b.operation) || !/^[0-9a-f-]{36}$/i.test(str(b.loanId))) return res.status(403).json({error:'ไม่อนุญาตให้ทำรายการนี้'});
      const loan=await db('rpc/library_loan_action','POST',{p_loan:b.loanId,p_actor:actor.id,p_action:b.operation,p_data:{returnAddress:str(b.returnAddress,1000),carrier:str(b.carrier,100),trackingNumber:str(b.trackingNumber,100),dueAt:str(b.dueAt,40),note:str(b.note,500),condition:b.condition==='repair'?'repair':'available'}});
      return res.json({loan});
    }
    if(action==='history' && req.method==='GET') {
      if(!/^[0-9a-f-]{36}$/i.test(str(req.query.loanId))) return res.status(400).json({error:'รหัสรายการไม่ถูกต้อง'});
      const loans=await db(`library_loans?id=eq.${enc(req.query.loanId)}${staff?'':`&member_id=eq.${enc(actor.id)}`}&select=id&limit=1`);
      if(!loans.length) return res.status(404).json({error:'ไม่พบรายการ'});
      return res.json({events:await db(`library_copy_events?loan_id=eq.${enc(req.query.loanId)}&select=event_type,created_at,details&order=created_at.asc`)});
    }
    if (!staff) return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบวัด' });
    if (req.method === 'GET' && action === 'inventory') {
      const books = await dbAll('books?select=*&order=title.asc,id.asc');
      const copies = await dbAll('library_copies?select=id,book_id,barcode,status,shelf,notes&order=acquired_at.desc,id.asc');
      return res.json({ books, copies });
    }
    if (req.method === 'GET' && action === 'member') return res.json({ member: await memberByCard(req.query.card) });
    if (req.method === 'GET' && action === 'loans') return res.json({ loans: await dbAll('library_loans?select=*,library_copies(barcode,books(title,author))&order=requested_at.desc,id.asc') });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};
    if(action==='cover') {
      if(typeof b.image!=='string' || b.image.length>700000) return res.status(400).json({error:'ภาพต้องมีขนาดไม่เกิน 500 KB'});
      const match=/^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(b.image);
      if(!match) return res.status(400).json({error:'รองรับ JPEG หรือ WebP เท่านั้น'});
      const bytes=Buffer.from(match[2],'base64');
      const valid=match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
      if(!valid||bytes.length>512000) return res.status(400).json({error:'ข้อมูลภาพไม่ถูกต้องหรือใหญ่เกิน 500 KB'});
      const name=`${randomUUID()}.${match[1]==='jpeg'?'jpg':'webp'}`,key=process.env.SUPABASE_SECRET_KEY;
      const headers={apikey:key,'Content-Type':`image/${match[1]}`};
      if(!key.startsWith('sb_secret_')) headers.Authorization=`Bearer ${key}`;
      const origin=new URL(process.env.SUPABASE_URL).origin;
      const upload=await fetch(`${origin}/storage/v1/object/library-covers/${name}`,{method:'POST',headers,body:bytes});
      if(!upload.ok) return res.status(503).json({error:'เก็บภาพไม่สำเร็จ กรุณาตรวจว่าได้รัน SQL อัปเดตแล้ว'});
      return res.json({url:`${origin}/storage/v1/object/public/library-covers/${name}`});
    }
    if (action === 'book') {
      const title = str(b.title, 250), code = b.isbn ? isbn(b.isbn) : null;
      if (!title || (b.isbn && !code)) return res.status(400).json({ error: 'ชื่อหนังสือหรือ ISBN ไม่ถูกต้อง' });
      const cover = str(b.coverUrl, 1000), source = str(b.sourceUrl, 1000);
      if ([cover, source].some(v => v && !/^https:\/\//i.test(v))) return res.status(400).json({ error: 'ลิงก์ต้องเริ่มด้วย https://' });
      const payload = { title, isbn: code, author: str(b.author, 250), category: str(b.category, 100), description: str(b.description, 4000), cover_url: cover || null, source_url: source || null, is_active: true };
      Object.assign(payload,{classification:str(b.classification,20),subject:str(b.subject,100),publisher:str(b.publisher,250),published_year:str(b.publishedYear,30),edition:str(b.edition,100),language:str(b.language,60),call_number:str(b.callNumber,100),pages:b.pages?Number(b.pages):null});
      if(payload.pages!==null&&(!Number.isInteger(payload.pages)||payload.pages<1||payload.pages>100000)) return res.status(400).json({error:'จำนวนหน้าไม่ถูกต้อง'});
      if(!/^\d{3}(\.\d+)?$/.test(payload.classification)) return res.status(400).json({error:'เลือกหมวดหนังสือ'});
      if(b.id) {
        if(!/^[0-9a-f-]{36}$/i.test(str(b.id))) return res.status(400).json({error:'รหัสหนังสือไม่ถูกต้อง'});
        const rows=await db(`books?id=eq.${enc(b.id)}`,'PATCH',payload);
        if(!rows.length) return res.status(404).json({error:'ไม่พบหนังสือ'});
        return res.json({book:rows[0]});
      }
      const existing = code ? await db(`books?isbn=eq.${enc(code)}&select=id&limit=1`) : [];
      if(existing.length) return res.status(409).json({error:'ISBN นี้มีในทะเบียนแล้ว กรุณาเลือกแก้ไขชื่อเรื่องเดิม หรือรับตัวเล่มเพิ่ม'});
      const rows = await db('books', 'POST', payload);
      return res.json({ book: rows[0] });
    }
    if (action === 'receive') {
      if (!/^[0-9a-f-]{36}$/i.test(str(b.bookId))) return res.status(400).json({ error: 'เลือกชื่อหนังสือ' });
      const code = str(b.barcode, 40).toUpperCase();
      if (code && !/^[A-Z0-9-]{4,40}$/.test(code)) return res.status(400).json({ error: 'รหัสตัวเล่มไม่ถูกต้อง' });
      const result = await db('rpc/library_receive_copy', 'POST', { p_book_id: b.bookId, p_barcode: code || null, p_shelf: str(b.shelf, 100), p_note: str(b.note, 500), p_actor: actor.id });
      return res.json({ copy: result });
    }
    if (['checkout', 'return', 'repair', 'retire', 'restore'].includes(action)) {
      let member = null;
      if (action === 'checkout') {
        member = await memberByCard(b.card);
        if (!member || member.status !== 'active') return res.status(400).json({ error: 'ไม่พบสมาชิกที่มีสิทธิ์ โปรดสแกนบัตรสมาชิกวัด' });
        if (b.accepted!=='on' && b.accepted!==true) return res.status(400).json({error:'สมาชิกต้องยอมรับเงื่อนไขก่อน'});
        if (b.method!=='pickup') return res.status(400).json({ error: 'เลือกวิธีรับหนังสือ' });
      }
      const result = await db('rpc/library_change_copy', 'POST', { p_barcode: str(b.barcode, 40).toUpperCase(), p_action: action, p_actor: actor.id, p_member: member?.id || null, p_method: member ? b.method : null, p_note: str(b.note, 500), p_due_at: b.dueAt || null });
      return res.json({ result, member });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) { console.error('Library API:', error); return res.status(400).json({ error: error.message || 'เกิดข้อผิดพลาด' }); }
}

