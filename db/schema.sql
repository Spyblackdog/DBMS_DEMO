create table if not exists public.tracking_points (
  id bigserial primary key,
  lat double precision not null,
  lng double precision not null,
  label text,
  created_at timestamptz not null default now()
);

create index if not exists tracking_points_created_at_idx
  on public.tracking_points (created_at desc);

