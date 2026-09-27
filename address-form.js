import { areas, validateBorrowContact } from './lib/borrow-address.js';
export function mountAddress(form, defaults={}) {
 const box=document.createElement('fieldset');box.className='borrow-contact';
 const legend=document.createElement('legend');legend.textContent='ข้อมูลผู้ยืม / ผู้รับหนังสือ';box.append(legend);
 const help=document.createElement('p');help.textContent='* จำเป็นทั้งการรับที่วัดและจัดส่ง · ตรวจสอบข้อมูลก่อนยืนยัน';box.append(help);
 const fields={};
 for(const [name,label,kind,required,max] of [['recipient','ชื่อผู้รับ *','input',true,200],['phone','เบอร์โทรศัพท์ *','input',true,40],['houseNo','บ้านเลขที่ *','input',true,40],['villageNo','หมู่ที่ (ถ้ามี)','input',false,3],['addressExtra','หมู่บ้าน อาคาร ซอย ถนน (ถ้ามี)','input',false,200],['provinceId','จังหวัด *','select',true],['districtId','อำเภอ / เขต *','select',true],['subdistrictId','ตำบล / แขวง *','select',true],['postalCode','รหัสไปรษณีย์ *','input',true,5]]){
  const labelNode=document.createElement('label');labelNode.textContent=label;const input=document.createElement(kind);input.name=name;input.required=required;if(max)input.maxLength=max;
  if(name==='phone'){input.type='tel';input.autocomplete='tel';}if(name==='postalCode'){input.inputMode='numeric';input.pattern='[1-9][0-9]{4}';input.autocomplete='postal-code';}
  fields[name]=input;labelNode.append(input);box.append(labelNode);
 }
 const legacy=document.createElement('p');legacy.className='borrow-note';legacy.hidden=!defaults.legacyAddress;legacy.textContent='ที่อยู่เดิมในบัญชี: '+(defaults.legacyAddress||'');box.append(legacy);
 const options=(input,rows,label)=>{input.replaceChildren(new Option('— '+label+' —',''));for(const row of rows)input.append(new Option(row.at(-1),row[0]));};
 const provinces=areas.provinces.map(([id,name])=>[id,name]).sort((a,b)=>a[1].localeCompare(b[1],'th'));
 function districts(){options(fields.districtId,areas.districts.filter(x=>x[1]===Number(fields.provinceId.value)).map(x=>[x[0],x[2]]),'เลือกอำเภอ / เขต');fields.districtId.disabled=!fields.provinceId.value;subdistricts();}
 function subdistricts(){options(fields.subdistrictId,areas.subdistricts.filter(x=>x[1]===Number(fields.districtId.value)).map(x=>[x[0],x[2]]),'เลือกตำบล / แขวง');fields.subdistrictId.disabled=!fields.districtId.value;fields.postalCode.value='';}
 options(fields.provinceId,provinces,'เลือกจังหวัด');districts();
 fields.provinceId.onchange=districts;fields.districtId.onchange=subdistricts;
 fields.subdistrictId.onchange=()=>{fields.postalCode.value=areas.subdistricts.find(x=>x[0]===Number(fields.subdistrictId.value))?.[3]||'';};
 for(const key of ['recipient','phone','houseNo','villageNo','addressExtra'])fields[key].value=defaults[key]||'';
 fields.recipient.readOnly=Boolean(defaults.recipient);
 fields.provinceId.value=defaults.provinceId||'';districts();fields.districtId.value=defaults.districtId||'';subdistricts();fields.subdistrictId.value=defaults.subdistrictId||'';fields.subdistrictId.onchange();
 form.append(box);
 return {validate:()=>validateBorrowContact(Object.fromEntries(new FormData(form)),defaults.recipient)};
}
