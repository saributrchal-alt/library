import crypto from 'node:crypto';

const str = (v, n = 300) => String(v ?? '').trim().slice(0, n);
const enc = encodeURIComponent;
function session(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token || token.length > 4000) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claim = JSON.parse(Buffer.from(body, 'base64url').toString());
    return claim.aud === 'nathoeng-library' && claim.sub && claim.exp > Date.now() && claim.exp - Date.now() <= 300000 ? claim : null;
  } catch { return null; }
}
async function db(path, method = 'GET', body) {
  const key = process.env.SUPABASE_SECRET_KEY;
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    method, cache: 'no-store', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const raw = await response.text();
  let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(data?.message || `Database error ${response.status}`);
  return data;
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
  if (!process.env.SESSION_SECRET || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
    return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่าการเชื่อมระบบสมาชิก' });
  const claim = session(str(req.headers.authorization).replace(/^Bearer\s+/i, ''));
  if (!claim) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบสมาชิกวัดอีกครั้ง' });
  try {
    const people = await db(`members?id=eq.${enc(claim.sub)}&select=id,role,membership_status&limit=1`);
    const actor = people[0];
    if (!actor || (actor.membership_status && actor.membership_status !== 'active')) return res.status(403).json({ error: 'สมาชิกไม่มีสิทธิ์ใช้งาน' });
    const action = str(req.query.action, 30);
    const staff = actor.role === 'admin';
    if (action === 'me') return res.json({ id: actor.id, role: actor.role, staff });
    if (!staff) return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบวัด' });
    if (req.method === 'GET' && action === 'inventory') {
      const books = await db('books?select=id,title,author,isbn,cover_url,total_copies,available_copies,is_active&order=created_at.desc&limit=200');
      const copies = await db('library_copies?select=id,book_id,barcode,status,shelf,notes&order=acquired_at.desc&limit=500');
      return res.json({ books, copies });
    }
    if (req.method === 'GET' && action === 'member') return res.json({ member: await memberByCard(req.query.card) });
    if (req.method === 'GET' && action === 'loans') return res.json({ loans: await db('library_loans?select=id,copy_id,member_id,delivery_method,status,borrowed_at,due_at,returned_at&order=borrowed_at.desc&limit=100') });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};
    if (action === 'book') {
      const title = str(b.title, 250), code = b.isbn ? isbn(b.isbn) : null;
      if (!title || (b.isbn && !code)) return res.status(400).json({ error: 'ชื่อหนังสือหรือ ISBN ไม่ถูกต้อง' });
      const cover = str(b.coverUrl, 1000), source = str(b.sourceUrl, 1000);
      if ([cover, source].some(v => v && !/^https:\/\//i.test(v))) return res.status(400).json({ error: 'ลิงก์ต้องเริ่มด้วย https://' });
      const payload = { title, isbn: code, author: str(b.author, 250), category: str(b.category, 100), description: str(b.description, 4000), cover_url: cover || null, source_url: source || null, is_active: true };
      const existing = code ? await db(`books?isbn=eq.${enc(code)}&select=id&limit=1`) : [];
      const rows = existing.length ? await db(`books?id=eq.${enc(existing[0].id)}`, 'PATCH', payload) : await db('books', 'POST', payload);
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
        if (!['pickup', 'ship_cod'].includes(b.method)) return res.status(400).json({ error: 'เลือกวิธีรับหนังสือ' });
      }
      const result = await db('rpc/library_change_copy', 'POST', { p_barcode: str(b.barcode, 40).toUpperCase(), p_action: action, p_actor: actor.id, p_member: member?.id || null, p_method: member ? b.method : null, p_note: str(b.note, 500), p_due_at: b.dueAt || null });
      return res.json({ result, member });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) { console.error('Library API:', error); return res.status(400).json({ error: error.message || 'เกิดข้อผิดพลาด' }); }
}
