-- Run in the library Supabase project's SQL editor after reviewing existing schema.
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  description text,
  category text,
  isbn text,
  total_copies integer not null default 0 check (total_copies >= 0),
  available_copies integer not null default 0 check (available_copies >= 0 and available_copies <= total_copies),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.books enable row level security;
create policy "Public can read active books" on public.books for select to anon, authenticated using (is_active = true);
-- Do not add public insert/update/delete policies. Manage inventory through trusted staff tools.
