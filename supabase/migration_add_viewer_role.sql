-- Migration: add 'viewer' to profiles role constraint
-- Run this on existing databases that already have profiles_role_check
alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
add constraint profiles_role_check
check (role in ('admin', 'user', 'viewer'));
