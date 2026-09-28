import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeCover,uploadCover} from '../lib/cover-upload.js';
const bytes=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(30),Buffer.from([255,217])]);
const sample='data:image/jpeg;base64,'+bytes.toString('base64');
test('photo validation rejects wrong format, oversized and invalid JPEG',()=>{
 assert.equal(decodeCover(sample).bytes.length,35);
 for(const value of ['data:image/svg+xml;base64,PHN2Zz4=',sample.replace('jpeg','png'),'data:image/jpeg;base64,'+Buffer.alloc(50).toString('base64'), 'x'.repeat(700000)])assert.throws(()=>decodeCover(value));
});
const mediaUrl='https://media.nathoeng.com/uploads/library/2026/09/'+'a'.repeat(32)+'.webp';
async function withMedia(mock,run){
 const oldFetch=globalThis.fetch,oldUrl=process.env.MEDIA_UPLOAD_URL,oldKey=process.env.MEDIA_UPLOAD_KEY;
 process.env.MEDIA_UPLOAD_URL='https://media.nathoeng.com/upload.php';process.env.MEDIA_UPLOAD_KEY='test-only-key-'.repeat(4);globalThis.fetch=mock;
 try{await run();}finally{globalThis.fetch=oldFetch;for(const [name,value] of [['MEDIA_UPLOAD_URL',oldUrl],['MEDIA_UPLOAD_KEY',oldKey]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
}
test('uploads compressed photo to Hostinger as authenticated multipart',async()=>{
 const calls=[];
 await withMedia(async(url,options)=>{calls.push({url,options});return {ok:true,status:201,json:async()=>({ok:true,url:mediaUrl,bytes:120})};},async()=>{
  assert.deepEqual(await uploadCover(sample),{url:mediaUrl,bytes:120});
  assert.equal(calls.length,1);const {url,options}=calls[0];
  assert.equal(url,process.env.MEDIA_UPLOAD_URL);assert.equal(options.headers['X-Upload-Key'],process.env.MEDIA_UPLOAD_KEY);
  assert.equal(options.redirect,'error');assert.equal(options.headers['Content-Type'],undefined);
  assert.equal(options.body.get('folder'),'library');
  const file=options.body.get('file');assert.equal(file.type,'image/jpeg');assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes);
 });
});
test('missing or unsafe configuration never sends the key',async()=>{
 await withMedia(async()=>{assert.fail('must not fetch');},async()=>{
  process.env.MEDIA_UPLOAD_URL='https://example.com/upload.php';await assert.rejects(uploadCover(sample),{status:503});
  process.env.MEDIA_UPLOAD_URL='https://media.nathoeng.com/upload.php';delete process.env.MEDIA_UPLOAD_KEY;await assert.rejects(uploadCover(sample),{status:503});
 });
});
test('rejects auth failure, malformed responses and foreign photo URLs without fallback',async()=>{
 for(const response of [
  {ok:false,status:401,json:async()=>({error:'unauthorized'})},
  {ok:true,status:201,json:async()=>{throw Error('not JSON');}},
  {ok:true,status:201,json:async()=>({ok:true,url:'https://example.com/a.webp',bytes:120})},
  {ok:true,status:201,json:async()=>({ok:false,url:mediaUrl,bytes:120})}
 ]){
  let calls=0;await withMedia(async()=>{calls++;return response;},async()=>{await assert.rejects(uploadCover(sample),{status:503});assert.equal(calls,1);});
 }
 await withMedia(async()=>{throw Error('timeout');},async()=>{await assert.rejects(uploadCover(sample),{status:503});});
});
