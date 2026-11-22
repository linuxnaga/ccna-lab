-- CCNA Lab platform: profiles, subscriptions and lab progress.
-- Run in the Supabase SQL editor (or `supabase db push`).

-- Profiles: one row per auth user, created automatically on sign-up.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  xp integer not null default 0,
  best_streak integer not null default 0,
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

-- Subscriptions: mirrored from Stripe by the webhook (service role only writes).
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_subscription_id text unique not null,
  status text not null,
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Lab progress: one row per user per lab, across every course/vendor.
create table if not exists public.lab_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id text not null,
  lab_id text not null,
  completed_at timestamptz,
  xp_earned integer not null default 0,
  hints_used integer not null default 0,
  commands_mastered text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id, lab_id)
);

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.lab_progress enable row level security;

-- Users can read their own rows. All writes go through the server
-- (service role), so XP and access cannot be edited from the browser.
create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles: update own name" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "subscriptions: read own" on public.subscriptions
  for select using (auth.uid() = user_id);
create policy "lab_progress: read own" on public.lab_progress
  for select using (auth.uid() = user_id);

-- Only display_name is user-editable on profiles.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- Create a profile whenever a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Record a lab completion and award XP once, atomically.
-- Returns the XP awarded (0 if the lab was already completed).
create or replace function public.complete_lab(
  p_user uuid,
  p_course text,
  p_lab text,
  p_xp integer,
  p_hints integer,
  p_commands text[]
) returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  awarded integer := 0;
begin
  insert into public.lab_progress (user_id, course_id, lab_id, completed_at, xp_earned, hints_used, commands_mastered)
  values (p_user, p_course, p_lab, now(), greatest(p_xp, 0), p_hints, coalesce(p_commands, '{}'))
  on conflict (user_id, course_id, lab_id) do update
    set completed_at = now(),
        xp_earned = excluded.xp_earned,
        hints_used = excluded.hints_used,
        commands_mastered = excluded.commands_mastered,
        updated_at = now()
    where public.lab_progress.completed_at is null
  returning xp_earned into awarded;

  if awarded is null then
    return 0; -- already completed earlier: no XP farming
  end if;

  update public.profiles set xp = xp + awarded where id = p_user;
  return awarded;
end;
$$;

revoke execute on function public.complete_lab(uuid, text, text, integer, integer, text[]) from public, anon, authenticated;
grant execute on function public.complete_lab(uuid, text, text, integer, integer, text[]) to service_role;
