-- Administrator-only provisioning, not an automatic migration.
-- Replace the empty UUID and company name below, review, then run in SQL Editor.
-- Never store a real password or private company identity in this source file.
begin;
do $$
declare
 owner_id uuid := nullif('', '')::uuid;
 company_name text := 'منشأتي';
 org_id uuid;
begin
 if owner_id is null then raise exception 'Set owner_id to the Auth user UUID before running'; end if;
 if not exists(select 1 from auth.users where id=owner_id) then raise exception 'Auth user does not exist';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 if exists(select 1 from public.organization_members where user_id=owner_id) then raise exception 'User already has an organization membership; review instead of provisioning again';end if;
 insert into public.organizations(name_ar,activity) values(company_name,'trade') returning id into org_id;
 insert into public.organization_members(organization_id,user_id,role) values(org_id,owner_id,'owner');
 insert into public.branches(organization_id,name) values(org_id,'الفرع الرئيسي');
end;$$;
commit;
