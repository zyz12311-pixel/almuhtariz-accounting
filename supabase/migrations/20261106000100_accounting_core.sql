-- Cloud schema only: local SQLite remains the writer while offline.
create table public.organizations (
 id uuid primary key default gen_random_uuid(), name_ar text not null, vat_number text, cr_number text,
 activity text not null default 'trade' check(activity in ('trade','events','engineering')), settings jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create table public.organization_members (
 organization_id uuid not null references public.organizations(id), user_id uuid not null references auth.users(id),
 role text not null check(role in ('owner','accountant','staff')), active boolean not null default true,
 primary key(organization_id,user_id)
);
create table public.branches (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),name text not null,address text,
 unique(organization_id,id)
);
create table public.installations (
 id uuid primary key,organization_id uuid not null references public.organizations(id),branch_id uuid not null,active boolean not null default true,
 created_at timestamptz not null default now(),unique(organization_id,id),
 foreign key(organization_id,branch_id) references public.branches(organization_id,id)
);
create table public.pos_points (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),branch_id uuid not null,
 name text not null,prefix text not null,active boolean not null default true,
 unique(organization_id,id),unique(organization_id,prefix),foreign key(organization_id,branch_id) references public.branches(organization_id,id)
);
create table public.pos_user_access (
 organization_id uuid not null,user_id uuid not null,pos_id uuid not null,
 primary key(organization_id,user_id,pos_id),foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id),
 foreign key(organization_id,pos_id) references public.pos_points(organization_id,id)
);
create table public.accounts (
 organization_id uuid not null references public.organizations(id),code text not null,name_ar text not null,
 type text not null check(type in ('asset','liability','equity','revenue','expense')),postable boolean not null default true,
 primary key(organization_id,code)
);
create table public.parties (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),installation_id uuid not null,local_id bigint not null,
 name_ar text not null,vat_number text,phone text,address text,kind text not null default 'customer' check(kind in ('customer','supplier','both')),
 unique(organization_id,id),unique(organization_id,installation_id,local_id),foreign key(organization_id,installation_id) references public.installations(organization_id,id)
);
create table public.items (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),installation_id uuid not null,local_id bigint not null,
 name_ar text not null,barcode text,unit_price bigint not null check(unit_price>=0),vat_rate numeric(5,2) not null default 15 check(vat_rate between 0 and 100),active boolean not null default true,
 unique(organization_id,id),unique(organization_id,installation_id,local_id),foreign key(organization_id,installation_id) references public.installations(organization_id,id),
 check(barcode is null or length(barcode) between 1 and 80)
);
create unique index items_barcode_unique on public.items(organization_id,barcode) where barcode is not null;
create table public.invoices (
 id uuid primary key,organization_id uuid not null references public.organizations(id),installation_id uuid not null,branch_id uuid not null,pos_id uuid not null,party_id uuid,
 local_id bigint not null,number text,type text not null check(type in ('388','381')),status text not null default 'draft' check(status in ('draft','issued')),
 payment text not null check(payment in ('cash','bank','credit')),issue_date date,issue_time time,icv bigint,pih text,hash text,qr text,
 subtotal bigint not null check(subtotal>=0),vat bigint not null check(vat>=0),total bigint not null check(total=subtotal+vat),
 ref_invoice_id uuid,reason text,notes text,created_by uuid references auth.users(id),local_created_by bigint,created_at timestamptz not null default now(),
 unique(organization_id,id),unique(organization_id,installation_id,local_id),unique(organization_id,number),unique(organization_id,branch_id,icv),
 foreign key(organization_id,installation_id) references public.installations(organization_id,id),
 foreign key(organization_id,branch_id) references public.branches(organization_id,id),foreign key(organization_id,pos_id) references public.pos_points(organization_id,id),
 foreign key(organization_id,party_id) references public.parties(organization_id,id),foreign key(organization_id,ref_invoice_id) references public.invoices(organization_id,id)
);
create table public.invoice_lines (
 organization_id uuid not null,invoice_id uuid not null,line_no integer not null check(line_no>0),description text not null,qty numeric(18,6) not null check(qty>0),
 unit_price bigint not null check(unit_price>=0),vat_rate numeric(5,2) not null check(vat_rate between 0 and 100),net bigint not null check(net>=0),vat bigint not null check(vat>=0),total bigint not null check(total=net+vat),
 primary key(organization_id,invoice_id,line_no),foreign key(organization_id,invoice_id) references public.invoices(organization_id,id)
);
create table public.invoice_snapshots (
 organization_id uuid not null,invoice_id uuid not null,company jsonb not null,party jsonb,
 primary key(organization_id,invoice_id),foreign key(organization_id,invoice_id) references public.invoices(organization_id,id)
);
create table public.journal_entries (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),installation_id uuid not null,local_id bigint not null,
 entry_no bigint not null,entry_date date not null,description text,source_invoice_id uuid,branch_id uuid not null,
 unique(organization_id,id),unique(organization_id,installation_id,local_id),unique(organization_id,installation_id,entry_no),
 foreign key(organization_id,installation_id) references public.installations(organization_id,id),foreign key(organization_id,source_invoice_id) references public.invoices(organization_id,id),
 foreign key(organization_id,branch_id) references public.branches(organization_id,id)
);
create table public.journal_lines (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,entry_id uuid not null,account_code text not null,
 debit bigint not null default 0 check(debit>=0),credit bigint not null default 0 check(credit>=0),check(debit=0 or credit=0),
 foreign key(organization_id,entry_id) references public.journal_entries(organization_id,id),foreign key(organization_id,account_code) references public.accounts(organization_id,code)
);
create table public.settings (
 organization_id uuid not null references public.organizations(id),key text not null,value jsonb not null,primary key(organization_id,key)
);
create table public.branch_chains (
 organization_id uuid not null,branch_id uuid not null,icv bigint not null check(icv>=0),last_hash text not null,
 primary key(organization_id,branch_id),foreign key(organization_id,branch_id) references public.branches(organization_id,id)
);
create table public.sync_inbox (
 organization_id uuid not null,installation_id uuid not null,event_id uuid not null,event_type text not null,payload jsonb not null,
 receipt_id uuid not null default gen_random_uuid(),received_at timestamptz not null default now(),processed_at timestamptz,
 primary key(organization_id,installation_id,event_id),foreign key(organization_id,installation_id) references public.installations(organization_id,id)
);
create index invoice_org_date on public.invoices(organization_id,issue_date);
create index journal_org_date on public.journal_entries(organization_id,entry_date);
create index journal_account on public.journal_lines(organization_id,account_code);

-- Composite keys also bind documents to their installation and POS branch.
alter table public.pos_points add unique(organization_id,branch_id,id);
alter table public.installations add unique(organization_id,id,branch_id);
alter table public.invoices add foreign key(organization_id,branch_id,pos_id) references public.pos_points(organization_id,branch_id,id);
alter table public.invoices add foreign key(organization_id,installation_id,branch_id) references public.installations(organization_id,id,branch_id);
alter table public.invoices add foreign key(organization_id,created_by) references public.organization_members(organization_id,user_id);
alter table public.journal_entries add foreign key(organization_id,installation_id,branch_id) references public.installations(organization_id,id,branch_id);
