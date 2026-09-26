import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/library.js';
process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
async function run(action, { active = true, valid = true, method = 'GET' } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('library-verify')) return Response.json(valid ? {sub:'member-A'} : {}, {status:valid ? 200 : 401});
    if (String(url).includes('/members?')) return Response.json([{id:'member-A',full_name:'Member A',role:'member',membership_status:active?'active':'cancelled'}]);
    if (String(url).includes('/library_loans?')) return Response.json([]);
    throw new Error('Unexpected database access');
  };
  const res = {code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  try { await handler({method,query:{action,memberId:'member-B'},headers:{authorization:'Bearer test'}},res); }
  finally { globalThis.fetch=original; }
  return {res,calls};
}
test('member loans are scoped to verified identity, ignoring supplied member ID',async()=>{
  const {res,calls}=await run('my-loans');assert.equal(res.code,200);
  assert.ok(calls.some(url=>url.includes('member_id=eq.member-A')));
  assert.ok(calls.every(url=>!url.includes('member-B')));
});
test('ordinary member cannot perform staff checkout',async()=>{
  const {res,calls}=await run('checkout',{method:'POST'});assert.equal(res.code,403);assert.equal(calls.length,2);
});
test('cancelled member cannot see loans',async()=>{const {res,calls}=await run('my-loans',{active:false});assert.equal(res.code,403);assert.equal(calls.length,2);});
test('invalid assertion cannot reach member records',async()=>{const {res,calls}=await run('my-loans',{valid:false});assert.equal(res.code,401);assert.equal(calls.length,1);});
