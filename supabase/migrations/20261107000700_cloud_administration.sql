alter table public.branches add column active boolean not null default true;
alter table public.organization_members add column session_not_before timestamptz;
create index organization_members_user on public.organization_members(user_id, organization_id);

create function private.cloud_session_started() returns timestamptz
language sql stable security definer set search_path='' as $$
  select s.created_at from auth.sessions s
  where s.id = case when (auth.jwt()->>'session_id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then (auth.jwt()->>'session_id')::uuid end and s.user_id = (select auth.uid());
$$;
revoke all on function private.cloud_session_started() from public, anon, authenticated, service_role;

create or replace function private.has_org_role(p_org uuid,p_roles text[]) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.organization_members m
    cross join (select private.cloud_session_started() as started) s
    where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.active
      and m.role=any(p_roles) and s.started is not null
      and (m.session_not_before is null or s.started>=m.session_not_before)
  );
$$;

create or replace function private.assigned_pos(p_org uuid,p_pos uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
  select private.has_org_role(p_org,array['staff']) and exists(
    select 1 from public.pos_user_access a
    join public.pos_points p on (p.organization_id,p.id)=(a.organization_id,a.pos_id)
    join public.branches b on (b.organization_id,b.id)=(p.organization_id,p.branch_id)
    where a.organization_id=p_org and a.user_id=(select auth.uid())
      and b.active and p.active and (p_pos is null or p.id=p_pos)
  );
$$;

alter policy member_self_or_owner on public.organization_members using(
  (user_id=(select auth.uid()) and private.has_org_role(organization_id,array['owner','accountant','staff']))
  or private.has_org_role(organization_id,array['owner'])
);
alter policy access_visible on public.pos_user_access using(
  private.has_org_role(organization_id,array['owner'])
  or (user_id=(select auth.uid()) and private.assigned_pos(organization_id,pos_id))
);

-- Costs, invoice internals and raw snapshots are manager data.
alter policy catalog_visible on public.items using(private.has_org_role(organization_id,array['owner','accountant']));
alter policy invoices_visible on public.invoices using(private.has_org_role(organization_id,array['owner','accountant']));

create function private.lock_cloud_owner(p_org uuid) returns void
language plpgsql set search_path='' as $$
begin
  if not private.has_org_role(p_org,array['owner']) then
    raise insufficient_privilege using message='صلاحيات مالك المنشأة مطلوبة.';
  end if;
  perform 1 from public.organizations where id=p_org for update;
  if not private.has_org_role(p_org,array['owner']) then
    raise insufficient_privilege using message='صلاحيات مالك المنشأة مطلوبة.';
  end if;
end;
$$;
revoke all on function private.lock_cloud_owner(uuid) from public, anon, authenticated, service_role;

create function public.cloud_admin_overview(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_org_role(p_org,array['owner']) then
    raise insufficient_privilege using message='صلاحيات مالك المنشأة مطلوبة.';
  end if;
  return jsonb_build_object(
    'organization',(select jsonb_build_object('name_ar',name_ar,'activity',activity) from public.organizations where id=p_org),
    'branches',coalesce((select jsonb_agg(b order by b.name,b.id) from public.branches b where b.organization_id=p_org),'[]'::jsonb),
    'points',coalesce((select jsonb_agg(p order by p.name,p.id) from public.pos_points p where p.organization_id=p_org),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'user_id',m.user_id,'email',u.email,'role',m.role,'active',m.active,'self',m.user_id=(select auth.uid()),
      'pos_ids',coalesce((select jsonb_agg(a.pos_id order by a.pos_id) from public.pos_user_access a
                         where a.organization_id=p_org and a.user_id=m.user_id),'[]'::jsonb)
    ) order by u.email,m.user_id) from public.organization_members m join auth.users u on u.id=m.user_id
    where m.organization_id=p_org),'[]'::jsonb)
  );
end;
$$;

create function public.cloud_update_organization(p_org uuid,p_name text,p_activity text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_cloud_owner(p_org);
  if p_name is null or length(btrim(p_name)) not between 1 and 150
     or p_activity is null or p_activity not in ('trade','events','engineering') then
    raise sqlstate 'PT400' using message='اسم المنشأة والنشاط مطلوبان.';
  end if;
  update public.organizations set name_ar=btrim(p_name),activity=p_activity where id=p_org;
end;
$$;

create function public.cloud_save_branch(p_org uuid,p_id uuid,p_name text,p_address text,p_active boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare saved uuid;
begin
  perform private.lock_cloud_owner(p_org);
  if p_name is null or length(btrim(p_name)) not between 1 and 150 or length(p_address)>300 or p_active is null then
    raise sqlstate 'PT400' using message='بيانات الفرع غير صالحة.';
  end if;
  if p_id is null then
    insert into public.branches(organization_id,name,address,active)
    values(p_org,btrim(p_name),nullif(btrim(p_address),''),p_active) returning id into saved;
  else
    update public.branches set name=btrim(p_name),address=nullif(btrim(p_address),''),active=p_active
    where organization_id=p_org and id=p_id returning id into saved;
    if saved is null then raise sqlstate 'PT404' using message='الفرع غير موجود في هذه المنشأة.'; end if;
  end if;
  return saved;
end;
$$;

create function public.cloud_save_pos(p_org uuid,p_id uuid,p_branch uuid,p_name text,p_prefix text,p_active boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare saved uuid;
begin
  perform private.lock_cloud_owner(p_org);
  if p_name is null or length(btrim(p_name)) not between 1 and 150 or p_prefix is null
     or p_prefix !~ '^[A-Z0-9]{1,6}$' or p_active is null then
    raise sqlstate 'PT400' using message='أدخل اسم النقطة وبادئة من 1 إلى 6 أحرف إنجليزية كبيرة أو أرقام.';
  end if;
  if p_id is null then
    if not exists(select 1 from public.branches where organization_id=p_org and id=p_branch and active) then
      raise sqlstate 'PT400' using message='اختر فرعًا مفعّلًا من هذه المنشأة.';
    end if;
    insert into public.pos_points(organization_id,branch_id,name,prefix,active)
    values(p_org,p_branch,btrim(p_name),p_prefix,p_active) returning id into saved;
  else
    -- The existing branch and invoice prefix remain attached to issued records.
    update public.pos_points set name=btrim(p_name),active=p_active
    where organization_id=p_org and id=p_id and branch_id=p_branch and prefix=p_prefix returning id into saved;
    if saved is null then raise sqlstate 'PT404' using message='تعذر العثور على النقطة في الفرع المحدد.'; end if;
  end if;
  return saved;
exception when unique_violation then
  raise sqlstate 'PT409' using message='بادئة نقطة البيع مستخدمة في المنشأة.';
end;
$$;

create function public.cloud_save_member(
  p_org uuid,p_user uuid,p_email text,p_role text,p_active boolean,p_pos_ids uuid[],p_end_sessions boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; previous public.organization_members;
begin
  perform private.lock_cloud_owner(p_org);
  if p_role is null or p_role not in ('owner','accountant','staff') or p_active is null
     or p_end_sessions is null or p_pos_ids is null or cardinality(p_pos_ids)>100 then
    raise sqlstate 'PT400' using message='بيانات عضوية الفريق غير صالحة.';
  end if;
  if p_user is null then
    if p_email is null or length(p_email)>254 then raise sqlstate 'PT400' using message='أدخل بريد الحساب المؤكد.'; end if;
    select id into target from auth.users where lower(email)=lower(btrim(p_email)) and email_confirmed_at is not null;
    if target is null then raise sqlstate 'PT404' using message='يلزم حساب سحابي ببريد مؤكد قبل إضافته.'; end if;
  else
    target:=p_user;
  end if;
  select * into previous from public.organization_members where organization_id=p_org and user_id=target;
  if p_user is null and previous.user_id is not null then
    raise sqlstate 'PT409' using message='هذا الحساب عضو بالفعل. عدّل عضويته من القائمة.';
  end if;
  if p_user is not null and previous.user_id is null then
    raise sqlstate 'PT404' using message='العضو غير موجود في هذه المنشأة.';
  end if;
  if target=(select auth.uid()) then
    raise sqlstate 'PT409' using message='يعدّل مالك آخر عضويتك أو جلساتك في المنشأة.';
  end if;
  if p_role<>'staff' and cardinality(p_pos_ids)>0 then
    raise sqlstate 'PT400' using message='تعيين نقاط البيع مخصص للعامل.';
  end if;
  if p_role='staff' and p_active and cardinality(p_pos_ids)=0 then
    raise sqlstate 'PT400' using message='اختر نقطة بيع واحدة على الأقل للعامل المفعّل.';
  end if;
  if exists(select 1 from unnest(p_pos_ids) requested(pos_id) where not exists(
    select 1 from public.pos_points p join public.branches b on (b.organization_id,b.id)=(p.organization_id,p.branch_id)
    where p.organization_id=p_org and p.id=requested.pos_id and
      ((p.active and b.active) or exists(select 1 from public.pos_user_access a
       where a.organization_id=p_org and a.user_id=target and a.pos_id=p.id))
  )) then
    raise sqlstate 'PT400' using message='تعيين نقطة البيع غير صالح لهذه المنشأة.';
  end if;
  if previous.user_id is null then
    insert into public.organization_members(organization_id,user_id,role,active)
    values(p_org,target,p_role,p_active);
  else
    update public.organization_members set role=p_role,active=p_active,
      session_not_before=case when p_end_sessions or active is distinct from p_active or role is distinct from p_role
        then clock_timestamp() else session_not_before end
    where organization_id=p_org and user_id=target;
  end if;
  delete from public.pos_user_access where organization_id=p_org and user_id=target;
  insert into public.pos_user_access(organization_id,user_id,pos_id)
  select distinct p_org,target,id from unnest(p_pos_ids) id;
  return target;
end;
$$;

revoke all on function public.cloud_admin_overview(uuid), public.cloud_update_organization(uuid,text,text),
  public.cloud_save_branch(uuid,uuid,text,text,boolean), public.cloud_save_pos(uuid,uuid,uuid,text,text,boolean),
  public.cloud_save_member(uuid,uuid,text,text,boolean,uuid[],boolean) from public, anon, authenticated, service_role;
grant execute on function public.cloud_admin_overview(uuid), public.cloud_update_organization(uuid,text,text),
  public.cloud_save_branch(uuid,uuid,text,text,boolean), public.cloud_save_pos(uuid,uuid,uuid,text,text,boolean),
  public.cloud_save_member(uuid,uuid,text,text,boolean,uuid[],boolean) to authenticated;

create function public.cloud_staff_catalog(p_org uuid,p_installation uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare available uuid[]; chosen uuid; products jsonb;
begin
  if not private.assigned_pos(p_org,null) then
    raise insufficient_privilege using message='يلزم تعيين نقطة بيع مفعّلة لهذا العامل.';
  end if;
  select array_agg(i.id order by s.received_at desc nulls last,i.id) into available
  from public.installations i
  left join public.branch_snapshots s on (s.organization_id,s.installation_id)=(i.organization_id,i.id)
  where i.organization_id=p_org and i.active and exists(
    select 1 from public.pos_points p
    where p.organization_id=p_org and p.branch_id=i.branch_id and private.assigned_pos(p_org,p.id)
  );
  if p_installation is not null and not coalesce(p_installation=any(available),false) then
    raise insufficient_privilege using message='نسخة الفرع غير متاحة لهذا الحساب.';
  end if;
  chosen:=coalesce(p_installation,available[1]);
  select coalesce(jsonb_agg(x),'[]'::jsonb) into products from (
    select item.id,item.name_ar,item.barcode,item.unit_price,item.base_unit
    from public.items item where item.organization_id=p_org and item.installation_id=chosen and item.active
    order by item.name_ar,item.id limit 100
  ) x;
  if exists(select 1 from public.branch_snapshots where organization_id=p_org and installation_id=chosen) then
    select coalesce(jsonb_agg(x),'[]'::jsonb) into products from (
      select item_json->>'id' as id,left(item_json->>'name_ar',150) as name_ar,
        case when jsonb_typeof(item_json->'barcode')='string' then left(item_json->>'barcode',80) end as barcode,
        round((item_json->>'unit_price')::numeric*100) as unit_price,
        case when jsonb_typeof(item_json->'base_unit')='string' then left(item_json->>'base_unit',40) end as base_unit
      from public.branch_snapshots s cross join lateral jsonb_array_elements(
        case when jsonb_typeof(s.payload->'tables'->'items')='array'
          then s.payload->'tables'->'items' else '[]'::jsonb end
      ) as element(item_json)
      where s.organization_id=p_org and s.installation_id=chosen and item_json->>'active' in ('1','true')
        and jsonb_typeof(item_json->'name_ar')='string' and jsonb_typeof(item_json->'id')='number'
        and item_json->>'unit_price' ~ '^[0-9]{1,15}(\.[0-9]{1,2})?$'
      order by item_json->>'name_ar',item_json->>'id' limit 100
    ) x;
  end if;
  return jsonb_build_object('items',products,'installation_id',chosen,'branches',coalesce((
    select jsonb_agg(jsonb_build_object('id',i.id,'name',b.name) order by b.name,i.id)
    from public.installations i join public.branches b on (b.organization_id,b.id)=(i.organization_id,i.branch_id)
    where i.organization_id=p_org and i.id=any(available)
  ),'[]'::jsonb));
end;
$$;
revoke all on function public.cloud_staff_catalog(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.cloud_staff_catalog(uuid,uuid) to authenticated;

create function public.cloud_devices(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_org_role(p_org,array['owner']) then raise insufficient_privilege; end if;
  return jsonb_build_object(
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name)
      from public.branches where organization_id=p_org and active),'[]'::jsonb),
    'devices',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'active',d.active and i.active and b.active,
      'created_at',d.created_at,'last_sequence',d.last_sequence,'branch_name',b.name) order by d.created_at desc)
      from public.branch_devices d join public.installations i on (i.organization_id,i.id)=(d.organization_id,d.id)
      join public.branches b on (b.organization_id,b.id)=(i.organization_id,i.branch_id)
      where d.organization_id=p_org),'[]'::jsonb)
  );
end;
$$;

create function public.cloud_link_device(p_org uuid,p_branch uuid,p_installation uuid,p_token_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_cloud_owner(p_org);
  if p_installation is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or not exists(
    select 1 from public.branches where organization_id=p_org and id=p_branch and active
  ) then raise sqlstate 'PT400' using message='اختر فرعًا مفعّلًا وأدخل معرف النسخة المحلية الصحيح.'; end if;
  insert into public.installations(id,organization_id,branch_id) values(p_installation,p_org,p_branch)
  on conflict (id) do nothing;
  if not exists(select 1 from public.installations where id=p_installation and organization_id=p_org and branch_id=p_branch and active) then
    raise sqlstate 'PT409' using message='معرف النسخة مستخدم أو موقوف.';
  end if;
  insert into public.branch_devices(id,organization_id,token_hash) values(p_installation,p_org,p_token_hash);
exception when unique_violation then
  raise sqlstate 'PT409' using message='هذه النسخة مرتبطة مسبقًا.';
end;
$$;
revoke all on function public.cloud_devices(uuid),public.cloud_link_device(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.cloud_devices(uuid),public.cloud_link_device(uuid,uuid,uuid,text) to authenticated;

create function private.check_snapshot_branch() returns trigger language plpgsql set search_path='' as $$
begin
  perform 1 from public.installations i join public.branches b on (b.organization_id,b.id)=(i.organization_id,i.branch_id)
  where i.id=new.installation_id and i.organization_id=new.organization_id and i.active and b.active for share of b,i;
  if not found then raise insufficient_privilege using message='الفرع أو نسخته موقوفة.'; end if;
  return new;
end;
$$;
revoke all on function private.check_snapshot_branch() from public,anon,authenticated,service_role;
create trigger snapshot_active_branch before insert or update on public.branch_snapshots
for each row execute function private.check_snapshot_branch();
