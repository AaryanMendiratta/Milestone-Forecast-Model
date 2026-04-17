-- ============================================================
-- Supabase schema for Monte Carlo simulation results
-- Run this in your Supabase project → SQL Editor
-- ============================================================

-- Stores one record per "Run Simulation" button click
create table if not exists monte_carlo_runs (
  id              uuid         primary key default gen_random_uuid(),
  created_at      timestamptz  not null default now(),
  simulation_count int         not null,
  output_name     text,
  metric_configs  jsonb        -- snapshot of metric + distribution config used
);

-- Stores one row per simulation iteration
-- temp_vars: { "temp_population-Oncology--|SINGLE": 52341.0, ... }
-- outputs:   { "Oncology--2024": 125000.0, "Cardiology--2025": 85000.0, ... }
-- total_output: sum of all segment-year values for the selected output
create table if not exists monte_carlo_iterations (
  id           bigserial    primary key,
  run_id       uuid         not null references monte_carlo_runs(id) on delete cascade,
  iteration    int          not null,
  temp_vars    jsonb        not null default '{}',
  outputs      jsonb        not null default '{}',
  total_output float8       not null default 0
);

create index if not exists idx_mc_iterations_run_id
  on monte_carlo_iterations(run_id);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Backend uses the service key (bypasses RLS entirely).
-- Frontend uses the anon key — read-only access granted here.

alter table monte_carlo_runs       enable row level security;
alter table monte_carlo_iterations enable row level security;

-- Allow anyone (anon / authenticated) to read simulation data
create policy "Allow anon read runs"
  on monte_carlo_runs for select using (true);

create policy "Allow anon read iterations"
  on monte_carlo_iterations for select using (true);
