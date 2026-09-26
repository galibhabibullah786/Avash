create or replace function public.verified_reports_in_region(p_region_id uuid)
returns table (
  id uuid,
  lat double precision,
  lng double precision,
  description text,
  photo_url text,
  ai_category text,
  created_at timestamptz
) as $$
begin
  return query
  select 
    b.id,
    st_y(b.geom::geometry) as lat,
    st_x(b.geom::geometry) as lng,
    b.description,
    b.photo_url,
    b.ai_validation->>'category' as ai_category,
    b.created_at
  from breeding_reports b
  join regions r on st_intersects(b.geom, r.geom)
  where r.id = p_region_id and b.status = 'verified';
end;
$$ language plpgsql security definer;

grant execute on function public.verified_reports_in_region(uuid) to anon, authenticated, service_role;
