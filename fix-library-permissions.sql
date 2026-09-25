-- Run once in the SQL Editor of the Supabase project used by library.nathoeng.com.
-- The library API holds SUPABASE_SECRET_KEY server-side and acts as service_role.
-- Grant only the privileges used by this API; do not grant book writes to anon/authenticated.
grant usage on schema public to service_role;
grant select, insert, update on table public.books to service_role;
grant select on table public.library_copies, public.library_loans to service_role;
