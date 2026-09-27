import { areas } from './thai-areas.js';
export { areas };
const text=(v,n)=>String(v??'').trim().slice(0,n);
export function validateBorrowContact(value, memberName='') {
  const recipient=text(memberName||value.recipient,200),phone=text(value.phone,40).replace(/[\s()-]/g,'');
  if(!recipient)throw Error('กรุณาระบุชื่อผู้รับ');
  if(!/^(?:0[0-9]{8,9}|\+66[0-9]{8,9})$/.test(phone))throw Error('กรุณากรอกเบอร์โทรศัพท์ไทยให้ครบ 9–10 หลัก หรือรูปแบบ +66');
  const p=areas.provinces.find(x=>x[0]===Number(value.provinceId));
  const d=areas.districts.find(x=>x[0]===Number(value.districtId));
  const s=areas.subdistricts.find(x=>x[0]===Number(value.subdistrictId));
  const house=text(value.houseNo,40),village=text(value.villageNo,20),extra=text(value.addressExtra,200),postal=text(value.postalCode,5);
  if(!house||!p||!d||!s||d[1]!==p[0]||s[1]!==d[0])throw Error('กรุณากรอกบ้านเลขที่และเลือกจังหวัด อำเภอ ตำบลให้ครบและตรงกัน');
  if(!/^[1-9][0-9]{4}$/.test(postal)||String(value.postalCode??'').trim().length!==5)throw Error('กรุณากรอกรหัสไปรษณีย์ 5 หลัก');
  if(village&&!/^[0-9๐-๙]{1,3}$/.test(village))throw Error('หมู่ที่ต้องเป็นตัวเลข 1–3 หลัก หรือเว้นว่าง');
  if(/[\u0000-\u001f]/.test(house+village+extra))throw Error('ข้อมูลที่อยู่มีอักขระไม่ถูกต้อง');
  const address=[house,village?'หมู่ '+village:'',extra,(p[0]===1?'แขวง':'ตำบล')+s[2],(p[0]===1?'':'อำเภอ')+d[2],p[2]||p[1],postal].filter(Boolean).join(' ');
  return {recipient,phone,address};
}
export function profileDefaults(member={},details={}) {
  const p=areas.provinces.find(x=>x[0]===Number(details.address_province_id));
  const d=areas.districts.find(x=>x[0]===Number(details.address_district_id)&&x[1]===p?.[0]);
  const s=areas.subdistricts.find(x=>x[0]===Number(details.address_subdistrict_id)&&x[1]===d?.[0]);
  return {recipient:member.full_name||member.display_name||'',phone:member.phone||'',houseNo:details.address_house_no||'',villageNo:details.address_village_no||'',addressExtra:details.address_extra||'',provinceId:p?.[0]||'',districtId:d?.[0]||'',subdistrictId:s?.[0]||'',postalCode:s?.[3]||'',legacyAddress:details.member_address||''};
}
