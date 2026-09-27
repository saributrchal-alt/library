-- Run AFTER schema.sql in the temple's existing Supabase SQL Editor.
-- Additive migration. Existing books, copies, memberships and loans remain in place.
begin;
alter table public.books add column if not exists classification text;
alter table public.books add column if not exists subject text;
alter table public.books add column if not exists publisher text;
alter table public.books add column if not exists published_year text;
alter table public.books add column if not exists edition text;
alter table public.books add column if not exists language text;
alter table public.books add column if not exists pages integer;
alter table public.books add column if not exists call_number text;
alter table public.library_loans add column if not exists recipient text;
alter table public.library_loans add column if not exists return_address text;
alter table public.library_loans add column if not exists phone text;
alter table public.library_loans add column if not exists address text;
alter table public.library_loans add column if not exists carrier text;
alter table public.library_loans add column if not exists tracking_number text;
alter table public.library_loans add column if not exists return_method text;
alter table public.library_loans add column if not exists return_carrier text;
alter table public.library_loans add column if not exists return_tracking_number text;
alter table public.library_loans add column if not exists accepted_at timestamptz;
alter table public.library_loans add column if not exists terms_version text;
alter table public.library_loans add column if not exists received_at timestamptz;
alter table public.library_loans add column if not exists requested_at timestamptz default now();
alter table public.library_loans drop constraint if exists library_loans_status_check;
alter table public.library_loans add constraint library_loans_status_check check(status in ('pending','ready_pickup','ready_ship','shipped','on_loan','return_shipping','returned','cancelled','rejected'));
alter table public.library_copies drop constraint if exists library_copies_status_check;
alter table public.library_copies add constraint library_copies_status_check check(status in ('available','pending','ready_pickup','ready_ship','shipped','on_loan','return_shipping','repair','retired'));
drop index if exists public.library_one_open_loan_per_copy;
create unique index library_one_open_loan_per_copy on public.library_loans(copy_id) where status not in ('returned','cancelled','rejected');
alter table public.library_copy_events add column if not exists loan_id uuid references public.library_loans(id);
grant select on public.library_copy_events to service_role;

-- Always calculate counts on a serialized book row, including simultaneous reservations.
create or replace function public.library_recount(p_book uuid) returns void language sql security definer set search_path='' as $$
 update public.books b set available_copies=(select count(*) from public.library_copies c where c.book_id=b.id and c.status='available'), total_copies=(select count(*) from public.library_copies c where c.book_id=b.id and c.status<>'retired') where b.id=p_book;
$$;
revoke all on function public.library_recount(uuid) from public,anon,authenticated;
grant execute on function public.library_recount(uuid) to service_role;

create or replace function public.library_reserve(p_book uuid,p_actor text,p_method text,p_recipient text,p_phone text,p_address text,p_terms text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.library_copies%rowtype; l public.library_loans%rowtype;
begin
 if p_method not in ('pickup','ship_cod') or p_method is null or p_terms is distinct from '2026-09-27' then raise exception 'กรุณายอมรับเงื่อนไขและเลือกวิธีรับหนังสือ'; end if;
 if not exists(select 1 from public.members where id::text=p_actor and coalesce(membership_status,'active')='active') then raise exception 'สมาชิกไม่มีสิทธิ์ใช้งาน'; end if;
 if p_method='ship_cod' and (coalesce(length(trim(p_recipient)),0)=0 or coalesce(length(trim(p_phone)),0)<8 or coalesce(length(trim(p_address)),0)<10) then raise exception 'กรอกชื่อ เบอร์โทร และที่อยู่จัดส่งให้ครบ'; end if;
 perform 1 from public.books where id=p_book and is_active=true for update;
 if not found then raise exception 'ไม่พบหนังสือ'; end if;
 if exists(select 1 from public.library_loans ll join public.library_copies lc on lc.id=ll.copy_id where lc.book_id=p_book and ll.member_id=p_actor and ll.status not in ('returned','cancelled','rejected')) then raise exception 'มีรายการจองหรือยืมหนังสือชื่อนี้อยู่แล้ว'; end if;
 select * into c from public.library_copies where book_id=p_book and status='available' order by acquired_at,id limit 1 for update;
 if not found then raise exception 'ไม่มีตัวเล่มพร้อมให้ยืม กรุณาค้นหาใหม่'; end if;
 insert into public.library_loans(copy_id,member_id,delivery_method,status,handled_by,recipient,phone,address,accepted_at,terms_version)
 values(c.id,p_actor,p_method,'pending',p_actor,nullif(p_recipient,''),nullif(p_phone,''),nullif(p_address,''),now(),p_terms) returning * into l;
 update public.library_copies set status='pending' where id=c.id;
 insert into public.library_copy_events(copy_id,loan_id,event_type,member_id,actor_id) values(c.id,l.id,'pending',p_actor,p_actor);
 perform public.library_recount(p_book);
 return to_jsonb(l);
end $$;
revoke all on function public.library_reserve(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.library_reserve(uuid,text,text,text,text,text,text) to service_role;

create or replace function public.library_loan_action(p_loan uuid,p_actor text,p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.library_loans%rowtype; c public.library_copies%rowtype; b uuid; staff boolean; next_status text;
begin
 select lc.book_id into b from public.library_loans ll join public.library_copies lc on lc.id=ll.copy_id where ll.id=p_loan;
 if b is null then raise exception 'ไม่พบรายการ'; end if;
 perform 1 from public.books where id=b for update;
 select * into l from public.library_loans where id=p_loan for update;
 select * into c from public.library_copies where id=l.copy_id for update;
 select role='admin' into staff from public.members where id::text=p_actor and coalesce(membership_status,'active')='active';
 if staff is null or (not staff and l.member_id<>p_actor) then raise exception 'ไม่มีสิทธิ์ทำรายการ'; end if;
 if p_action in ('approve','reject','ship','handover','accept_return') and not staff then raise exception 'เฉพาะเจ้าหน้าที่'; end if;
 case p_action
 when 'approve' then
   if l.status<>'pending' then raise exception 'รายการไม่ได้รออนุมัติ'; end if;
   next_status:=case l.delivery_method when 'pickup' then 'ready_pickup' else 'ready_ship' end;
 when 'reject' then
   if l.status<>'pending' then raise exception 'รายการไม่ได้รออนุมัติ'; end if; next_status:='rejected';
 when 'cancel' then
   if l.status not in ('pending','ready_pickup','ready_ship') then raise exception 'ยกเลิกไม่ได้หลังส่งมอบหนังสือ'; end if; next_status:='cancelled';
 when 'ship' then
   if l.status<>'ready_ship' then raise exception 'รายการไม่ได้รอจัดส่ง'; end if;
   if coalesce(length(trim(p_data->>'carrier')),0)=0 or coalesce(length(trim(p_data->>'trackingNumber')),0)=0 then raise exception 'กรอกบริษัทขนส่งและเลขพัสดุ'; end if;
   if coalesce(length(trim(p_data->>'returnAddress')),0)<10 then raise exception 'กรอกที่อยู่ห้องสมุดสำหรับส่งคืน'; end if;
   update public.library_loans set return_address=left(p_data->>'returnAddress',1000),carrier=left(p_data->>'carrier',100),tracking_number=left(p_data->>'trackingNumber',100) where id=l.id;
   next_status:='shipped';
 when 'handover' then
   if l.status<>'ready_pickup' then raise exception 'รายการไม่ได้รอรับที่วัด'; end if; next_status:='on_loan';
 when 'received' then
   if l.status<>'shipped' then raise exception 'รายการยังไม่ได้จัดส่ง'; end if; next_status:='on_loan';
 when 'return_shipping' then
   if l.status<>'on_loan' then raise exception 'รายการไม่ได้อยู่ระหว่างยืม'; end if;
   if coalesce(length(trim(p_data->>'carrier')),0)=0 or coalesce(length(trim(p_data->>'trackingNumber')),0)=0 then raise exception 'กรอกบริษัทขนส่งและเลขพัสดุขากลับ'; end if;
   update public.library_loans set return_method='shipping',return_carrier=left(p_data->>'carrier',100),return_tracking_number=left(p_data->>'trackingNumber',100) where id=l.id;
   next_status:='return_shipping';
 when 'return_pickup' then
   if l.status<>'on_loan' then raise exception 'รายการไม่ได้อยู่ระหว่างยืม'; end if;
   update public.library_loans set return_method='pickup' where id=l.id; next_status:='on_loan';
 when 'accept_return' then
   if l.status not in ('on_loan','return_shipping') then raise exception 'รายการไม่ได้อยู่ระหว่างยืมหรือส่งคืน'; end if; next_status:='returned';
 else raise exception 'ไม่รองรับคำสั่งนี้'; end case;
 update public.library_loans set status=next_status,
   handled_by=case when staff then p_actor else handled_by end,
   due_at=case when p_action='approve' and nullif(p_data->>'dueAt','') is not null then (p_data->>'dueAt')::timestamptz else due_at end,
   received_at=case when next_status='on_loan' then coalesce(received_at,now()) else received_at end,
   returned_at=case when next_status='returned' then now() else returned_at end,
   return_handled_by=case when next_status='returned' then p_actor else return_handled_by end,
   return_method=case when next_status='returned' then coalesce(return_method,'pickup') else return_method end
 where id=l.id returning * into l;
 update public.library_copies set status=case when next_status in ('rejected','cancelled') then 'available' when next_status='returned' then case when p_data->>'condition'='repair' then 'repair' else 'available' end else next_status end where id=c.id;
 insert into public.library_copy_events(copy_id,loan_id,event_type,member_id,actor_id,details) values(c.id,l.id,p_action,l.member_id,p_actor,left(p_data->>'note',500));
 perform public.library_recount(b);
 return to_jsonb(l);
end $$;
revoke all on function public.library_loan_action(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.library_loan_action(uuid,text,text,jsonb) to service_role;

-- Replace legacy entry points too: a reserved/shipped copy must never be repaired or checked out twice.
create or replace function public.library_change_copy(p_barcode text,p_action text,p_actor text,p_member text default null,p_method text default null,p_note text default null,p_due_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.library_copies%rowtype; l public.library_loans%rowtype; b uuid;
begin
 if not exists(select 1 from public.members where id::text=p_actor and role='admin' and coalesce(membership_status,'active')='active') then raise exception 'เฉพาะเจ้าหน้าที่'; end if;
 select book_id into b from public.library_copies where barcode=p_barcode;
 perform 1 from public.books where id=b for update;
 select * into c from public.library_copies where barcode=p_barcode for update;
 if not found then raise exception 'ไม่พบตัวเล่ม'; end if;
 if p_action='checkout' then
   if c.status<>'available' then raise exception 'ตัวเล่มไม่พร้อมให้ยืม'; end if;
   if p_method is distinct from 'pickup' then raise exception 'งานจัดส่งให้ใช้รายการจองของสมาชิก'; end if;
   if not exists(select 1 from public.members where id::text=p_member and coalesce(membership_status,'active')='active') then raise exception 'สมาชิกไม่มีสิทธิ์'; end if;
   insert into public.library_loans(copy_id,member_id,delivery_method,handled_by,due_at,notes,accepted_at,terms_version,received_at)
    values(c.id,p_member,p_method,p_actor,p_due_at,p_note,now(),'2026-09-27',now()) returning * into l;
   update public.library_copies set status='on_loan' where id=c.id;
 elsif p_action='return' then
   select * into l from public.library_loans where copy_id=c.id and status in ('on_loan','return_shipping') for update;
   if not found then raise exception 'ไม่พบรายการยืมที่รับคืนได้'; end if;
   perform public.library_loan_action(l.id,p_actor,'accept_return',jsonb_build_object('note',p_note));
   return jsonb_build_object('barcode',c.barcode,'action',p_action,'loan_id',l.id);
 elsif p_action in ('repair','retire','restore') then
   if c.status not in ('available','repair','retired') then raise exception 'ต้องยกเลิกการจองหรือรับคืนก่อน'; end if;
   if p_action='restore' and c.status not in ('repair','retired') then raise exception 'ตัวเล่มพร้อมให้ยืมอยู่แล้ว'; end if;
   update public.library_copies set status=case p_action when 'repair' then 'repair' when 'retire' then 'retired' else 'available' end, notes=coalesce(p_note,notes) where id=c.id;
 else raise exception 'ไม่รองรับคำสั่ง'; end if;
 insert into public.library_copy_events(copy_id,loan_id,event_type,member_id,actor_id,details) values(c.id,l.id,p_action,p_member,p_actor,p_note);
 perform public.library_recount(b);
 return jsonb_build_object('barcode',c.barcode,'action',p_action,'loan_id',l.id);
end $$;

create or replace function public.library_receive_copy(p_book_id uuid,p_barcode text,p_shelf text,p_note text,p_actor text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.library_copies%rowtype;
begin
 if not exists(select 1 from public.members where id::text=p_actor and role='admin' and coalesce(membership_status,'active')='active') then raise exception 'เฉพาะเจ้าหน้าที่'; end if;
 perform 1 from public.books where id=p_book_id for update;
 if not found then raise exception 'ไม่พบหนังสือ'; end if;
 insert into public.library_copies(book_id,barcode,shelf,notes) values(p_book_id,coalesce(nullif(p_barcode,''),'NTL-'||pg_catalog.lpad(nextval('public.library_copy_seq'::pg_catalog.regclass)::text,8,'0')),p_shelf,p_note) returning * into c;
 insert into public.library_copy_events(copy_id,event_type,actor_id,details) values(c.id,'receive',p_actor,p_note);
 perform public.library_recount(p_book_id);
 return to_jsonb(c);
end $$;

-- Images are public book covers only; clients cannot write directly.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('library-covers','library-covers',true,512000,array['image/jpeg','image/webp'])
on conflict(id) do update set public=true,file_size_limit=512000,allowed_mime_types=array['image/jpeg','image/webp'];
commit;
