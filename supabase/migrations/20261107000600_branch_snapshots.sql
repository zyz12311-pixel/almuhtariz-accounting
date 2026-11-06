-- A branch remains the single accounting writer; immutable documents are never
-- replayed into a second ledger. This projection is for cloud reads and backup.
create table public.branch_devices(
 id uuid primary key references public.installations(id),organization_id uuid not null,
 token_hash text not null check(length(token_hash)=64),active boolean not null default true,
 last_sequence bigint not null default 0,last_hash text,created_at timestamptz not null default now(),
 foreign key(organization_id,id) references public.installations(organization_id,id)
);
create table public.branch_snapshots(
 installation_id uuid primary key references public.branch_devices(id),organization_id uuid not null,
 sequence bigint not null check(sequence>0),payload_hash text not null,payload jsonb not null,
 received_at timestamptz not null default now(),
 foreign key(organization_id,installation_id) references public.installations(organization_id,id)
);
alter table public.branch_devices enable row level security;
alter table public.branch_snapshots enable row level security;
revoke all on public.branch_devices,public.branch_snapshots from anon,authenticated;
grant all on public.branch_devices,public.branch_snapshots to service_role;
grant select on public.branch_snapshots to authenticated;
create policy snapshots_managers on public.branch_snapshots for select to authenticated using(private.has_org_role(organization_id,array['owner','accountant']));
create function public.publish_branch_snapshot(p_installation uuid,p_token_hash text,p_sequence bigint,p_payload_hash text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare device public.branch_devices; prior public.branch_snapshots;
begin
 select * into device from public.branch_devices where id=p_installation for update;
 if device.id is null or not device.active or device.token_hash<>p_token_hash then raise exception 'Device authorization failed';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload->>'installation_id' is distinct from p_installation::text or p_payload->>'version' is distinct from '1' or octet_length(p_payload::text)>5000000 or length(p_payload_hash)<>64 or p_sequence<=0 then raise exception 'Invalid branch snapshot';end if;
 if p_sequence=device.last_sequence and p_payload_hash=device.last_hash then return jsonb_build_object('accepted',true,'replayed',true,'sequence',p_sequence);end if;
 if p_sequence<=device.last_sequence then raise exception 'Stale or conflicting snapshot';end if;
 insert into public.branch_snapshots(installation_id,organization_id,sequence,payload_hash,payload) values(device.id,device.organization_id,p_sequence,p_payload_hash,p_payload)
 on conflict(installation_id) do update set sequence=excluded.sequence,payload_hash=excluded.payload_hash,payload=excluded.payload,received_at=now();
 update public.branch_devices set last_sequence=p_sequence,last_hash=p_payload_hash where id=device.id;
 return jsonb_build_object('accepted',true,'replayed',false,'sequence',p_sequence);
end;$$;
revoke all on function public.publish_branch_snapshot(uuid,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.publish_branch_snapshot(uuid,text,bigint,text,jsonb) to service_role;
