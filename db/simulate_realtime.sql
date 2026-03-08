-- Run this in a SQL session to simulate realtime incoming points.
-- It appends a new row every ~1 second for 60 seconds.
do $$
declare
  i int;
  base_lat double precision := 10.776900;
  base_lng double precision := 106.700900;
begin
  for i in 1..60 loop
    insert into public.tracking_points(lat, lng, label)
    values (
      base_lat + (random() - 0.5) * 0.01,
      base_lng + (random() - 0.5) * 0.01,
      'Sim ' || i
    );
    perform pg_sleep(1);
  end loop;
end $$;

