import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/library.js';
process.env.SUPABASE_URL='https://db.example';process.env.SUPABASE_SECRET_KEY='sb_secret_test';
const id='12345678-1234-1234-1234-123456789012';
async function invoke(action,body={},options={}){
 const calls=[],original=globalThis.fetch;
 globalThis.fetch=async(url,init={})=>{
  const path=String(url);calls.push({path,body:init.body&&JSON.parse(init.body)});
  if(path.includes('library-verify'))return Response.json({sub:'member-A'});
  if(path.includes('/members?'))return Response.json([{id:'member-A',role:options.staff?'admin':'member',membership_status:'active'}]);
  if(path.includes('/rpc/'))return options.rpcError?Response.json({message:'ไม่มีสิทธิ์ทำรายการ'},{status:400}):Response.json({id,status:'pending'});
  if(path.includes('/library_loans?'))return Response.json([]);
  if(path.includes('/books?'))return Response.json(options.books||[]);
  throw Error('Unexpected request '+path);
 };
 const res={code:200,setHeader(){},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
 try{await handler({method:options.method||'POST',query:{action,...options.query},headers:{authorization:'Bearer test'},body},res);}finally{globalThis.fetch=original;}
 return {res,calls};
}
test('reservation uses verified member and records versioned consent',async()=>{
 const {res,calls}=await invoke('reserve',{bookId:id,method:'pickup',accepted:true,termsVersion:'2026-09-27',memberId:'victim'});
 assert.equal(res.code,200);const rpc=calls.find(c=>c.path.includes('/rpc/'));assert.equal(rpc.body.p_actor,'member-A');assert.equal(rpc.body.p_terms,'2026-09-27');assert.ok(!JSON.stringify(rpc).includes('victim'));
});
test('reservation without consent never reaches write RPC',async()=>{
 const {res,calls}=await invoke('reserve',{bookId:id,method:'pickup'});assert.equal(res.code,400);assert.ok(!calls.some(c=>c.path.includes('/rpc/')));
});
test('member cannot approve or mark a copy returned',async()=>{
 for(const operation of ['approve','ship','handover','accept_return']){const {res,calls}=await invoke('loan-action',{loanId:id,operation});assert.equal(res.code,403);assert.ok(!calls.some(c=>c.path.includes('/rpc/')));}
});
test('return tracking uses verified actor and correct operation',async()=>{
 const {res,calls}=await invoke('loan-action',{loanId:id,operation:'return_shipping',carrier:'Thailand Post',trackingNumber:'TEST123',actor:'victim'});assert.equal(res.code,200);const rpc=calls.find(c=>c.path.includes('/rpc/'));assert.equal(rpc.body.p_actor,'member-A');assert.equal(rpc.body.p_data.trackingNumber,'TEST123');
});
test('history of another member is not disclosed',async()=>{
 const {res,calls}=await invoke('history',{}, {method:'GET',query:{loanId:id}});assert.equal(res.code,404);assert.ok(calls.some(c=>c.path.includes('member_id=eq.member-A')));assert.ok(!calls.some(c=>c.path.includes('library_copy_events')));
});
test('staff upload rejects oversized and non-raster image payloads',async()=>{
 for(const image of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/jpeg;base64,aaaa','a'.repeat(700001)]){const {res,calls}=await invoke('cover',{image},{staff:true});assert.equal(res.code,400);assert.ok(!calls.some(c=>c.path.includes('/storage/')));}
});
test('search runs database filtering before pagination',async()=>{
 const {res,calls}=await invoke('catalog',{}, {method:'GET',query:{q:'สมาธิ',category:'294.3',page:'2'}});assert.equal(res.code,200);const path=calls[0].path;assert.ok(path.includes('offset=80'));assert.ok(path.includes('&or=('));assert.ok(path.includes('classification=like.294.3*'));
});
test('staff shipping carries return address into transaction',async()=>{
 const {res,calls}=await invoke('loan-action',{loanId:id,operation:'ship',carrier:'Post',trackingNumber:'123',returnAddress:'Library return address'},{staff:true});assert.equal(res.code,200);assert.equal(calls.find(c=>c.path.includes('/rpc/')).body.p_data.returnAddress,'Library return address');
});
