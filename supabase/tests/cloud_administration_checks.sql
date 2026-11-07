-- Run as the migration owner on a test project. Fixtures are rolled back.
begin;
do $$
declare
  org_a uuid:=gen_random_uuid(); org_b uuid:=gen_random_uuid();
  owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid();
  session_a uuid:=gen_random_uuid(); session_b uuid:=gen_random_uuid(); old_worker uuid:=gen_random_uuid(); new_worker uuid:=gen_random_uuid();
  branch_a uuid; other_branch uuid; branch_b uuid; point_a uuid; point_b uuid;
  device_a uuid:=gen_random_uuid(); other_device uuid:=gen_random_uuid(); device_b uuid:=gen_random_uuid();
  worker_email text:='t10-'||worker::text||'@example.invalid';
  result jsonb; payload jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_a,'t10-'||owner_a::text||'@example.invalid',now()),
    (owner_b,'t10-'||owner_b::text||'@example.invalid',now()),
    (worker,worker_email,now());
  insert into auth.sessions(id,user_id,created_at) values
    (session_a,owner_a,now()),(session_b,owner_b,now()),(old_worker,worker,now());
  insert into public.organizations(id,name_ar) values(org_a,'Alpha'),(org_b,'Beta');
  insert into public.organization_members(organization_id,user_id,role) values
    (org_a,owner_a,'owner'),(org_b,owner_b,'owner'),(org_b,worker,'accountant');
  insert into public.branches(organization_id,name) values(org_b,'Beta branch') returning id into branch_b;
  insert into public.pos_points(organization_id,branch_id,name,prefix) values(org_b,branch_b,'Beta POS','B') returning id into point_b;
  insert into public.installations(id,organization_id,branch_id) values(device_b,org_b,branch_b);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'session_id',session_a,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if (select count(*) from public.organizations)<>1 then raise exception 'Tenant RLS failure'; end if;
  perform public.cloud_update_organization(org_a,'Alpha updated','events');
  branch_a:=public.cloud_save_branch(org_a,null,'Branch A','Address',true);
  other_branch:=public.cloud_save_branch(org_a,null,'Branch A2',null,true);
  point_a:=public.cloud_save_pos(org_a,null,branch_a,'POS A','A',true);
  perform public.cloud_link_device(org_a,branch_a,device_a,repeat('a',64));
  perform public.cloud_link_device(org_a,other_branch,other_device,repeat('c',64));
  begin
    perform public.cloud_update_organization(org_b,'Intrusion','trade');
    raise exception 'Foreign organization update allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.cloud_save_member(org_a,null,worker_email,'staff',true,array[point_b],false);
    raise exception 'Foreign point assignment allowed';
  exception when sqlstate 'PT400' then null; end;
  begin
    perform public.cloud_save_member(org_a,owner_a,null,'staff',false,'{}',true);
    raise exception 'Owner could lock out their own account';
  exception when sqlstate 'PT409' then null; end;
  if public.cloud_save_member(org_a,null,worker_email,'staff',true,array[point_a],false)<>worker then
    raise exception 'Verified account was not linked';
  end if;
  result:=public.cloud_admin_overview(org_a);
  if jsonb_array_length(result->'members')<>2 or result->'organization'->>'name_ar'<>'Alpha updated' then
    raise exception 'Administration projection is incorrect';
  end if;
  execute 'reset role';

  insert into public.items(organization_id,installation_id,local_id,name_ar,unit_price,purchase_cost)
  values(org_a,device_a,1,'Cost protected',1200,999),(org_a,other_device,1,'Other branch',1200,998),
        (org_b,device_b,1,'Beta catalog',1200,997);
  payload:=jsonb_build_object('version',1,'installation_id',device_a,'tables',jsonb_build_object(
    'items','[{"id":1,"active":1,"name_ar":"Sale only","unit_price":12,"purchase_cost":9.99,"base_unit":"unit"}]'::jsonb));
  perform public.publish_branch_snapshot(device_a,repeat('a',64),1,repeat('b',64),payload);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'session_id',old_worker,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.items where organization_id=org_a) or
     exists(select 1 from public.branches where organization_id=org_a) or
     exists(select 1 from public.branch_snapshots where organization_id=org_a) or
     (select count(*) from public.items where organization_id=org_b)<>1 then raise exception 'Direct access leaks data or blocks authorized role'; end if;
  result:=public.cloud_staff_catalog(org_a,null);
  if jsonb_array_length(result->'branches')<>1 or jsonb_array_length(result->'items')<>1
    or result->'items'->0->>'unit_price'<>'1200' or (result->'items'->0) ? 'purchase_cost' then
    raise exception 'Staff projection exposes cost or unrelated branches: %',result;
  end if;
  begin
    perform public.cloud_staff_catalog(org_a,other_device);
    raise exception 'Unassigned installation allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.cloud_admin_overview(org_a);
    raise exception 'Staff administration allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.cloud_save_branch(org_b,null,'Accountant intrusion',null,true);
    raise exception 'Accountant write allowed';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'session_id',session_a)::text,true);
  execute 'set local role authenticated';
  perform public.cloud_save_branch(org_a,branch_a,'Branch A','Address',false);
  execute 'reset role';
  begin
    perform public.publish_branch_snapshot(device_a,repeat('a',64),2,repeat('d',64),payload);
    raise exception 'Disabled branch accepted a new snapshot';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'session_id',old_worker)::text,true);
  execute 'set local role authenticated';
  begin
    perform public.cloud_staff_catalog(org_a,null);
    raise exception 'Disabled branch still visible';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'session_id',session_a)::text,true);
  execute 'set local role authenticated';
  perform public.cloud_save_branch(org_a,branch_a,'Branch A','Address',true);
  perform public.cloud_save_member(org_a,worker,null,'staff',false,array[point_a],false);
  perform public.cloud_save_member(org_a,worker,null,'staff',true,array[point_a],false);
  perform public.cloud_save_member(org_a,worker,null,'staff',true,array[point_a],true);
  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'session_id',old_worker)::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.organization_members where organization_id=org_a and user_id=worker)
    or not exists(select 1 from public.organization_members where organization_id=org_b and user_id=worker) then
    raise exception 'Session revocation was not isolated to the organization';
  end if;
  execute 'reset role';
  insert into auth.sessions(id,user_id,created_at) values(new_worker,worker,clock_timestamp());
  perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'session_id',new_worker)::text,true);
  execute 'set local role authenticated';
  if jsonb_array_length(public.cloud_staff_catalog(org_a,null)->'items')<>1 then raise exception 'New session denied'; end if;
  execute 'reset role';
  delete from auth.sessions where id=new_worker;
  execute 'set local role authenticated';
  if exists(select 1 from public.organization_members where user_id=worker) then raise exception 'Signed-out session still allowed'; end if;
  execute 'reset role';
  if has_function_privilege('anon','public.cloud_admin_overview(uuid)','EXECUTE')
    or has_table_privilege('authenticated','public.organization_members','UPDATE')
    or has_table_privilege('authenticated','public.branch_devices','SELECT') then raise exception 'Excess database grants'; end if;
end;
$$;
rollback;
select 'PASS: tenant and branch isolation, safe catalog, atomic administration, scoped session revocation' as result;
