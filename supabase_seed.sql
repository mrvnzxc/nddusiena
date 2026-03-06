-- Seed data for checkpoints, edges, and destinations

insert into public.checkpoints (name, latitude, longitude) values
  ('parking_area',          6.153378,               125.166866),
  ('parking_side_entrance', 6.153476,               125.166953),
  ('hallway_1',             6.153054,               125.167330),
  ('hallway_2',             6.153137,               125.167391),
  ('gym_entrance',          6.152853,               125.167856),
  ('front_clinic',          6.152984,               125.167690),
  ('clinic_other_side',     6.152920,               125.167637),
  ('clinic_right_entrance', 6.153027,               125.167584),
  ('right_building_exit',   6.153221,               125.167747),
  ('basketball_area',       6.153581,               125.167949),
  ('left_building_exit',    6.153503,               125.167476),
  ('left_corner',           6.153503,               125.167476),
  ('center_statue',         6.153344072470366,      125.16752586475036),
  ('canteen_center',        6.152673,               125.167535),
  ('canteen_right',         6.152525,               125.167823),
  ('canteen_left',          6.152889,               125.167319)
on conflict (name) do nothing;


with edge_pairs as (
  -- parking and approach to hallways
  select 'parking_area'::text          as from_name, 'parking_side_entrance'::text as to_name union all
  select 'parking_side_entrance',      'parking_area'                              union all

  -- from parking side, go directly toward hallway 1 (then hallway 2)
  select 'parking_side_entrance',      'hallway_1'                                 union all
  select 'hallway_1',                  'parking_side_entrance'                     union all

  -- center to hallways / right building
  select 'center_statue',              'hallway_2'                                 union all
  select 'hallway_2',                  'center_statue'                             union all

  select 'center_statue',              'right_building_exit'                       union all
  select 'right_building_exit',        'center_statue'                             union all

  -- right building to basketball & clinic side
  select 'right_building_exit',        'basketball_area'                           union all
  select 'basketball_area',            'right_building_exit'                       union all

  select 'right_building_exit',        'clinic_other_side'                         union all
  select 'clinic_other_side',          'right_building_exit'                       union all

  -- clinic perimeter and hallways
  select 'clinic_other_side',          'front_clinic'                              union all
  select 'front_clinic',               'clinic_other_side'                         union all

  select 'front_clinic',               'clinic_right_entrance'                     union all
  select 'clinic_right_entrance',      'front_clinic'                              union all

  select 'front_clinic',               'hallway_1'                                 union all
  select 'hallway_1',                  'front_clinic'                              union all

  select 'hallway_1',                  'hallway_2'                                 union all
  select 'hallway_2',                  'hallway_1'                                 union all

  -- gym and canteen
  select 'gym_entrance',               'front_clinic'                              union all
  select 'front_clinic',               'gym_entrance'                              union all

  select 'clinic_right_entrance',      'canteen_center'                            union all
  select 'canteen_center',             'clinic_right_entrance'                     union all

  select 'canteen_center',             'canteen_left'                              union all
  select 'canteen_left',               'canteen_center'                            union all

  select 'canteen_center',             'canteen_right'                             union all
  select 'canteen_right',              'canteen_center'
)
insert into public.edges (id, from_checkpoint, to_checkpoint, distance)
select
  gen_random_uuid(),
  c_from.id,
  c_to.id,
  public.haversine_distance(
    c_from.latitude, c_from.longitude,
    c_to.latitude,   c_to.longitude
  ) as distance
from edge_pairs ep
join public.checkpoints c_from on c_from.name = ep.from_name
join public.checkpoints c_to   on c_to.name   = ep.to_name
on conflict do nothing;


-- Destinations (dest coords should be the actual office window/counter, NOT near the hallway checkpoint)
-- To update existing rows: run the UPDATE statements below after initial insert.
insert into public.destinations (name, checkpoint_id, dest_latitude, dest_longitude)
select
  'Finance',
  c.id,
  6.153050,
  125.167430
from public.checkpoints c
where c.name = 'hallway_2'
on conflict (name) do nothing;

insert into public.destinations (name, checkpoint_id, dest_latitude, dest_longitude)
select
  'Registrar',
  c.id,
  6.153040,
  125.167500
from public.checkpoints c
where c.name = 'hallway_2'
on conflict (name) do nothing;

insert into public.destinations (name, checkpoint_id, dest_latitude, dest_longitude)
select
  'Clinic',
  c.id,
  6.152984,
  125.167690
from public.checkpoints c
where c.name = 'front_clinic'
on conflict (name) do nothing;

-- UPDATE existing destination rows (run this if data was already seeded with old coords)
update public.destinations set dest_latitude = 6.153050, dest_longitude = 125.167430 where name = 'Finance';
update public.destinations set dest_latitude = 6.153040, dest_longitude = 125.167500 where name = 'Registrar';
update public.destinations set dest_latitude = 6.152984, dest_longitude = 125.167690 where name = 'Clinic';

