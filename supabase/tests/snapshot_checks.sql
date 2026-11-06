-- Reversible integration check, executed as project administrator.
begin;
do $$
declare org uuid; branch uuid; installation uuid:=gen_random_uuid(); answer jsonb; payload jsonb;
begin
 insert into public.organizations(name_ar) values('اختبار ترحيل مؤقت') returning id into org;
 insert into public.branches(organization_id,name) values(org,'اختبار') returning id into branch;
 insert into public.installations(id,organization_id,branch_id) values(installation,org,branch);
 insert into public.branch_devices(id,organization_id,token_hash) values(installation,org,repeat('a',64));
 payload:=jsonb_build_object('version',1,'installation_id',installation,'tables',jsonb_build_object('items',jsonb_build_array(),'invoices',jsonb_build_array()));
 answer:=public.publish_branch_snapshot(installation,repeat('a',64),1,repeat('b',64),payload);
 if answer->>'accepted'<>'true' then raise exception 'Publication failed';end if;
 answer:=public.publish_branch_snapshot(installation,repeat('a',64),1,repeat('b',64),payload);
 if answer->>'replayed'<>'true' then raise exception 'Replay failed';end if;
 begin
  perform public.publish_branch_snapshot(installation,repeat('c',64),2,repeat('b',64),payload);
  raise exception 'Test failed: wrong device credential accepted';
 exception when others then if sqlerrm='Test failed: wrong device credential accepted' then raise;end if;end;
 begin
  perform public.publish_branch_snapshot(installation,repeat('a',64),1,repeat('c',64),payload);
  raise exception 'Test failed: conflicting replay accepted';
 exception when others then if sqlerrm='Test failed: conflicting replay accepted' then raise;end if;end;
 if has_function_privilege('authenticated','public.publish_branch_snapshot(uuid,text,bigint,text,jsonb)','EXECUTE') then raise exception 'Client can bypass device authentication';end if;
 if has_table_privilege('anon','public.branch_snapshots','SELECT') or has_table_privilege('authenticated','public.branch_devices','SELECT') then raise exception 'Private device data exposed';end if;
end;$$;
rollback;
select 'PASS: atomic snapshot, replay, credential checks and privileges; fixtures rolled back' as result;
