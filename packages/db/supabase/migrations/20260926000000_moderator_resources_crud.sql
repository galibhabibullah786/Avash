-- 1. Update has_capability
create or replace function public.has_capability(p_capability text) returns boolean
  language sql stable security invoker
as $$
  select case public.app_role()
    when 'admin' then p_capability in (
      'reports:moderate', 'news:moderate', 'inventory:write', 'hospitals:manage', 'roles:manage'
    )
    when 'moderator' then p_capability in ('reports:moderate', 'news:moderate', 'inventory:write', 'hospitals:manage')
    when 'citizen' then false
    else false
  end;
$$;

-- 2. Migrate auth.users
update auth.users
set raw_app_meta_data = jsonb_set(coalesce(raw_app_meta_data, '{}'::jsonb), '{role}', '"moderator"')
where raw_app_meta_data->>'role' = 'hospital_staff';

-- 3. Migrate role_assignments
alter table role_assignments drop constraint if exists role_assignments_new_role_valid;
alter table role_assignments drop constraint if exists role_assignments_previous_role_valid;

update role_assignments set new_role = 'moderator' where new_role = 'hospital_staff';
update role_assignments set previous_role = 'moderator' where previous_role = 'hospital_staff';

alter table role_assignments add constraint role_assignments_new_role_valid
  check (new_role in ('citizen', 'moderator', 'admin'));
alter table role_assignments add constraint role_assignments_previous_role_valid
  check (previous_role is null or previous_role in ('citizen', 'moderator', 'admin'));

-- 4. Drop verified_hospital_staff
drop table if exists verified_hospital_staff cascade;

-- 5. Update blood_inventory RLS
drop policy if exists blood_inventory_insert_verified_staff on blood_inventory;
create policy blood_inventory_insert_moderator on blood_inventory for insert
  with check (public.has_capability('inventory:write'));

drop policy if exists blood_inventory_update_verified_staff on blood_inventory;
create policy blood_inventory_update_moderator on blood_inventory for update
  using (public.has_capability('inventory:write'));
