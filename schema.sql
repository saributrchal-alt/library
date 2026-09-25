-- Run once in the SAME Supabase project as the temple membership database.
-- Existing public.books from the first version is extended in place.
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null, author text, description text, category text, isbn text,
  total_copies integer not null default 0, available_copies integer not null default 0,
  is_active boolean not null default false, created_at timestamptz not null default now()
);
alter table public.books add column if not exists cover_url text;
alter table public.books add column if not exists source_url text;
create unique index if not exists books_isbn_unique on public.books (isbn) where isbn is not null;
alter table public.books enable row level security;
drop policy if exists "Public can read active books" on public.books;
create policy "Public can read active books" on public.books for select to anon, authenticated using (is_active = true);

create sequence if not exists public.library_copy_seq start with 1;
create table if not exists public.library_copies (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id),
  barcode text not null unique default ('NTL-' || lpad(nextval('public.library_copy_seq')::text, 8, '0')),
  status text not null default 'available' check (status in ('available','on_loan','repair','retired')),
  shelf text, acquired_at timestamptz not null default now(), notes text
);
create index if not exists library_copies_book_idx on public.library_copies(book_id);
create table if not exists public.library_loans (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid not null references public.library_copies(id),
  member_id text not null,
  delivery_method text not null check (delivery_method in ('pickup','ship_cod')),
  status text not null default 'on_loan' check (status in ('on_loan','returned')),
  borrowed_at timestamptz not null default now(), due_at timestamptz,
  returned_at timestamptz, handled_by text not null, return_handled_by text,
  notes text
);
create unique index if not exists library_one_open_loan_per_copy on public.library_loans(copy_id) where status='on_loan';
create index if not exists library_loans_member_idx on public.library_loans(member_id);
create table if not exists public.library_copy_events (
  id bigint generated always as identity primary key,
  copy_id uuid not null references public.library_copies(id),
  event_type text not null,
  member_id text, actor_id text not null,
  details text, created_at timestamptz not null default now()
);
-- The server uses SUPABASE_SECRET_KEY to query through the Data API.
-- New Supabase projects require explicit grants even for service_role.
grant usage on schema public to service_role;
grant select, insert, update on table public.books to service_role;
grant select on table public.library_copies, public.library_loans to service_role;

-- Client browsers have no direct access to inventory, loans or audit history.
alter table public.library_copies enable row level security;
alter table public.library_loans enable row level security;
alter table public.library_copy_events enable row level security;
revoke all on public.library_copies, public.library_loans, public.library_copy_events from anon, authenticated;
revoke all on sequence public.library_copy_seq from anon, authenticated;

-- The API calls this with a service role AFTER verifying the signed temple session
-- and checking staff privileges in public.members. A row lock prevents double loans.
create or replace function public.library_change_copy(
  p_barcode text, p_action text, p_actor text,
  p_member text default null, p_method text default null,
  p_note text default null, p_due_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_copy public.library_copies%rowtype; v_loan public.library_loans%rowtype;
begin
  select * into v_copy from public.library_copies where barcode=p_barcode for update;
  if not found then raise exception 'Copy not found'; end if;
  if p_action='checkout' then
    if v_copy.status <> 'available' then raise exception 'Copy is not available'; end if;
    if p_member is null or p_method not in ('pickup','ship_cod') then raise exception 'Member and delivery method required'; end if;
    if not exists (select 1 from public.members where id::text=p_member and coalesce(membership_status,'active')='active') then raise exception 'Active member not found'; end if;
    insert into public.library_loans(copy_id,member_id,delivery_method,handled_by,due_at,notes)
      values(v_copy.id,p_member,p_method,p_actor,p_due_at,p_note) returning * into v_loan;
    update public.library_copies set status='on_loan' where id=v_copy.id;
  elsif p_action='return' then
    if v_copy.status <> 'on_loan' then raise exception 'Copy is not on loan'; end if;
    select * into v_loan from public.library_loans where copy_id=v_copy.id and status='on_loan' for update;
    if not found then raise exception 'Open loan not found'; end if;
    update public.library_loans set status='returned',returned_at=now(),return_handled_by=p_actor where id=v_loan.id;
    update public.library_copies set status='available' where id=v_copy.id;
    p_member:=v_loan.member_id;
  elsif p_action in ('repair','retire','restore') then
    if v_copy.status='on_loan' then raise exception 'Return copy before changing inventory status'; end if;
    if p_action='restore' and v_copy.status not in ('repair','retired') then raise exception 'Copy is not out of circulation'; end if;
    update public.library_copies set status=case p_action when 'repair' then 'repair' when 'retire' then 'retired' else 'available' end,
      notes=coalesce(p_note,notes) where id=v_copy.id;
  else raise exception 'Invalid action'; end if;
  insert into public.library_copy_events(copy_id,event_type,member_id,actor_id,details)
    values(v_copy.id,p_action,p_member,p_actor,p_note);
  update public.books b set total_copies=(select count(*) from public.library_copies c where c.book_id=b.id and c.status<>'retired'),
    available_copies=(select count(*) from public.library_copies c where c.book_id=b.id and c.status='available')
    where b.id=v_copy.book_id;
  return jsonb_build_object('barcode',v_copy.barcode,'action',p_action,'loan_id',v_loan.id);
end $$;
revoke all on function public.library_change_copy(text,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.library_change_copy(text,text,text,text,text,text,timestamptz) to service_role;

create or replace function public.library_receive_copy(
  p_book_id uuid, p_barcode text, p_shelf text, p_note text, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_copy public.library_copies%rowtype;
begin
  if not exists (select 1 from public.books where id=p_book_id) then raise exception 'Book not found'; end if;
  insert into public.library_copies(book_id,barcode,shelf,notes)
    values(p_book_id,coalesce(nullif(p_barcode,''),'NTL-' || pg_catalog.lpad(nextval('public.library_copy_seq'::pg_catalog.regclass)::text,8,'0')),p_shelf,p_note)
    returning * into v_copy;
  insert into public.library_copy_events(copy_id,event_type,actor_id,details)
    values(v_copy.id,'receive',p_actor,p_note);
  update public.books set total_copies=total_copies+1,available_copies=available_copies+1 where id=p_book_id;
  return jsonb_build_object('id',v_copy.id,'barcode',v_copy.barcode,'book_id',v_copy.book_id);
end $$;
revoke all on function public.library_receive_copy(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.library_receive_copy(uuid,text,text,text,text) to service_role;
