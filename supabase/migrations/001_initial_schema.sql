-- NORTH OS — Initial Schema
-- Run this in your Supabase SQL editor or via supabase db push

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────

create type domain_type as enum (
  'ventures', 'career', 'wealth', 'body', 'mind', 'unknown'
);

create type inbox_item_type as enum (
  'idea', 'task', 'article', 'investment', 'reading', 'other'
);

create type inbox_status as enum (
  'unreviewed', 'triaged', 'scheduled', 'archived', 'done'
);

create type ai_recommendation_type as enum (
  'do_this_week', 'queue', 'archive'
);

create type mentor_feed_type as enum (
  'pattern', 'warning', 'insight', 'question', 'weekly_debrief'
);

create type severity_type as enum (
  'info', 'warning', 'critical'
);

-- ─────────────────────────────────────────────
-- USERS (extends Supabase auth.users)
-- ─────────────────────────────────────────────

create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  name          text,
  identity_statement text,
  created_at    timestamptz default now() not null
);

alter table public.users enable row level security;
create policy "Users can read/write own profile"
  on public.users for all using (auth.uid() = id);

-- ─────────────────────────────────────────────
-- ANNUAL GOALS
-- ─────────────────────────────────────────────

create table public.annual_goals (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references public.users(id) on delete cascade,
  domain           domain_type not null,
  title            text not null,
  target_metric    text not null,
  target_date      date not null,
  current_progress int not null default 0 check (current_progress between 0 and 100),
  year             int not null default extract(year from now())::int,
  created_at       timestamptz default now() not null,
  updated_at       timestamptz default now() not null
);

alter table public.annual_goals enable row level security;
create policy "Users manage own goals"
  on public.annual_goals for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- WEEKLY PLANS
-- ─────────────────────────────────────────────

create table public.weekly_plans (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.users(id) on delete cascade,
  week_start     date not null,
  capacity       int not null default 5 check (capacity between 1 and 10),
  domain_targets jsonb not null default '{}',
  mentor_note    text,
  created_at     timestamptz default now() not null,
  unique (user_id, week_start)
);

alter table public.weekly_plans enable row level security;
create policy "Users manage own weekly plans"
  on public.weekly_plans for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- DAILY LOGS
-- ─────────────────────────────────────────────

create table public.daily_logs (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references public.users(id) on delete cascade,
  date             date not null,
  -- Morning
  top_3            jsonb not null default '[]',
  morning_question text,
  -- Evening
  completed        jsonb not null default '[]',
  evening_note     text,
  score            int check (score between 0 and 100),
  recovery_mode    boolean not null default false,
  created_at       timestamptz default now() not null,
  updated_at       timestamptz default now() not null,
  unique (user_id, date)
);

alter table public.daily_logs enable row level security;
create policy "Users manage own daily logs"
  on public.daily_logs for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- INBOX
-- ─────────────────────────────────────────────

create table public.inbox (
  id                       uuid primary key default uuid_generate_v4(),
  user_id                  uuid not null references public.users(id) on delete cascade,
  content                  text not null,
  type                     inbox_item_type not null default 'other',
  source_domain            domain_type not null default 'unknown',
  -- AI reasoning (populated async)
  alignment_score          int check (alignment_score between 1 and 10),
  alignment_reasoning      text,
  ai_recommendation        ai_recommendation_type,
  ai_recommendation_reason text,
  estimated_time_minutes   int,
  conflicts_with           text,
  -- Status
  status                   inbox_status not null default 'unreviewed',
  scheduled_week           date,
  created_at               timestamptz default now() not null,
  updated_at               timestamptz default now() not null
);

alter table public.inbox enable row level security;
create policy "Users manage own inbox"
  on public.inbox for all using (auth.uid() = user_id);

create index idx_inbox_user_status on public.inbox (user_id, status);
create index idx_inbox_user_created on public.inbox (user_id, created_at desc);

-- ─────────────────────────────────────────────
-- MENTOR FEED
-- ─────────────────────────────────────────────

create table public.mentor_feed (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.users(id) on delete cascade,
  type           mentor_feed_type not null,
  content        text not null,
  severity       severity_type not null default 'info',
  related_domain domain_type,
  is_read        boolean not null default false,
  created_at     timestamptz default now() not null
);

alter table public.mentor_feed enable row level security;
create policy "Users manage own mentor feed"
  on public.mentor_feed for all using (auth.uid() = user_id);

create index idx_mentor_feed_user_unread on public.mentor_feed (user_id, is_read, created_at desc);

-- ─────────────────────────────────────────────
-- FUNCTIONS & TRIGGERS
-- ─────────────────────────────────────────────

-- Auto-update updated_at columns
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger update_annual_goals_updated_at
  before update on public.annual_goals
  for each row execute function update_updated_at();

create trigger update_daily_logs_updated_at
  before update on public.daily_logs
  for each row execute function update_updated_at();

create trigger update_inbox_updated_at
  before update on public.inbox
  for each row execute function update_updated_at();

-- Auto-create user profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
