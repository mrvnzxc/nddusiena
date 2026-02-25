-- Supabase schema for NDDSU AR Navigation

create extension if not exists "pgcrypto";

-- Haversine distance in meters
create or replace function public.haversine_distance(
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision
) returns double precision
language plpgsql
as $$
declare
  r constant double precision := 6371000; -- Earth radius in meters
  dlat double precision := radians(lat2 - lat1);
  dlon double precision := radians(lon2 - lon1);
  a double precision;
  c double precision;
begin
  a := sin(dlat / 2)^2
       + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2)^2;
  c := 2 * atan2(sqrt(a), sqrt(1 - a));
  return r * c;
end;
$$;

-- 1) checkpoints
create table if not exists public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  latitude double precision not null,
  longitude double precision not null
);

-- 2) edges (graph connections)
create table if not exists public.edges (
  id uuid primary key default gen_random_uuid(),
  from_checkpoint uuid not null references public.checkpoints(id) on delete cascade,
  to_checkpoint uuid not null references public.checkpoints(id) on delete cascade,
  distance double precision not null,
  constraint edges_no_self_loop check (from_checkpoint <> to_checkpoint)
);

create index if not exists idx_edges_from on public.edges(from_checkpoint);
create index if not exists idx_edges_to   on public.edges(to_checkpoint);

-- 3) destinations
create table if not exists public.destinations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  checkpoint_id uuid not null references public.checkpoints(id) on delete cascade,
  dest_latitude double precision,
  dest_longitude double precision
);

