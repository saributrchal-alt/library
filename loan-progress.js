// Shared member/admin loan milestones. The last step is complete only after staff receipt.
(function(root){
 function steps(loan){
  const shipping=loan.delivery_method!=='pickup';
  const stopped=['cancelled','rejected'].includes(loan.status);
  const approved=['ready_pickup','ready_ship','shipped','on_loan','return_shipping','returned'].includes(loan.status);
  const received=['on_loan','return_shipping','returned'].includes(loan.status);
  const returning=loan.status==='return_shipping'||loan.status==='returned'||(loan.status==='on_loan'&&loan.return_method==='pickup');
  const list=[{label:'ส่งคำขอยืม',done:true},{label:'อนุมัติการยืม',done:approved}];
  if(shipping)list.push({label:'จัดส่งหนังสือ',done:['shipped','on_loan','return_shipping','returned'].includes(loan.status)});
  list.push({label:shipping?'ผู้ยืมรับหนังสือ':'รับหนังสือที่วัด',done:received},
   {label:loan.return_method==='pickup'?'แจ้งนำคืนที่วัด':'แจ้งส่งคืนหนังสือ',done:returning},
   {label:'ห้องสมุดรับคืนแล้ว',done:loan.status==='returned'});
  const next=stopped?-1:list.findIndex(s=>!s.done);
  return list.map((s,i)=>({...s,current:i===next}));
 }
 function render(loan){
  const wrap=document.createElement('section');wrap.className='loan-progress';wrap.setAttribute('aria-label','ความคืบหน้าการยืมและคืนหนังสือ');
  const title=document.createElement('h4');title.textContent='ติดตามการยืม–คืน';wrap.append(title);
  const list=document.createElement('ol');list.className='loan-progress-track';
  steps(loan).forEach((step,i)=>{
   const item=document.createElement('li');item.className=step.done?'is-done':step.current?'is-current':'is-pending';
   if(step.current)item.setAttribute('aria-current','step');
   const mark=document.createElement('span');mark.className='loan-step-mark';mark.textContent=step.done?'✓':String(i+1);mark.setAttribute('aria-hidden','true');
   const label=document.createElement('span');label.className='loan-step-label';label.textContent=step.label;
   const state=document.createElement('small');state.textContent=step.done?'สำเร็จแล้ว':step.current?'รอดำเนินการ':'ยังไม่ถึงขั้นตอน';
   item.append(mark,label,state);list.append(item);
  });wrap.append(list);
  if(['cancelled','rejected'].includes(loan.status)){
   const note=document.createElement('p');note.className='loan-progress-stopped';note.textContent=loan.status==='cancelled'?'รายการนี้ยกเลิกแล้ว':'รายการนี้ไม่ได้รับอนุมัติ';wrap.append(note);
  }
  return wrap;
 }
 root.LibraryLoanProgress={steps,render};
})(globalThis);
