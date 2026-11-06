-- Read-only schema smoke check. Run after migrations in a test Supabase project.
do $$
declare name text;
begin
 foreach name in array array['organizations','organization_members','branches','installations','pos_points','pos_user_access','accounts','items','parties','invoices','invoice_lines','invoice_snapshots','journal_entries','journal_lines','settings','branch_chains','sync_inbox','invoice_documents','invoice_tax_totals','regulatory_queue','audit_events','warehouses','item_units','stock_movements'] loop
  if not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=name and c.relrowsecurity) then raise exception 'Missing table or RLS: %',name;end if;
  if has_table_privilege('anon','public.'||name,'SELECT') then raise exception 'Anonymous access found: %',name;end if;
  if has_table_privilege('authenticated','public.'||name,'INSERT') or has_table_privilege('authenticated','public.'||name,'UPDATE') or has_table_privilege('authenticated','public.'||name,'DELETE') then raise exception 'Direct client write found: %',name;end if;
 end loop;
 if has_function_privilege('authenticated','public.ingest_branch_event(uuid,uuid,uuid,jsonb)','EXECUTE') then raise exception 'Client can call privileged sync RPC';end if;
end;$$;
