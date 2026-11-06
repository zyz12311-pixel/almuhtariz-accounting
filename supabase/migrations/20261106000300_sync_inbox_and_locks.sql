-- This RPC stores an event once. It does NOT post its payload into accounting tables.
create function public.ingest_branch_event(p_organization uuid,p_installation uuid,p_event uuid,p_payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare receipt uuid;
begin
 if not exists(select 1 from public.installations i where i.organization_id=p_organization and i.id=p_installation and i.active) then raise exception 'Unknown or inactive installation';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload->>'installation_id' is distinct from p_installation::text then raise exception 'Invalid event installation';end if;
 insert into public.sync_inbox(organization_id,installation_id,event_id,event_type,payload) values(p_organization,p_installation,p_event,'invoice.issued',p_payload) on conflict(organization_id,installation_id,event_id) do nothing;
 if exists(select 1 from public.sync_inbox s where s.organization_id=p_organization and s.installation_id=p_installation and s.event_id=p_event and s.payload<>p_payload) then raise exception 'Event ID reused with a different payload';end if;
 select receipt_id into receipt from public.sync_inbox s where s.organization_id=p_organization and s.installation_id=p_installation and s.event_id=p_event;
 return receipt;
end;$$;
revoke all on function public.ingest_branch_event(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_branch_event(uuid,uuid,uuid,jsonb) to service_role;
create function private.reject_ledger_edit() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Posted accounting records are immutable';end;$$;
create trigger journal_entries_immutable before update or delete on public.journal_entries for each row execute function private.reject_ledger_edit();
create trigger journal_lines_immutable before update or delete on public.journal_lines for each row execute function private.reject_ledger_edit();
create trigger snapshots_immutable before update or delete on public.invoice_snapshots for each row execute function private.reject_ledger_edit();
create function private.protect_invoice() returns trigger language plpgsql set search_path='' as $$begin if old.status='issued' then raise exception 'Issued invoices cannot be modified or deleted';end if;if tg_op='DELETE' then return old;end if;return new;end;$$;
create trigger invoice_immutable before update or delete on public.invoices for each row execute function private.protect_invoice();
create function private.protect_invoice_line() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op in ('UPDATE','DELETE') and exists(select 1 from public.invoices i where i.organization_id=old.organization_id and i.id=old.invoice_id and i.status='issued') then raise exception 'Issued lines are immutable';end if;
 if tg_op in ('INSERT','UPDATE') and exists(select 1 from public.invoices i where i.organization_id=new.organization_id and i.id=new.invoice_id and i.status='issued') then raise exception 'Issued lines are immutable';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
create trigger invoice_lines_immutable before insert or update or delete on public.invoice_lines for each row execute function private.protect_invoice_line();
