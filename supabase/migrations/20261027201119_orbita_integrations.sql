-- Version mirrors the migration applied by the Supabase connector.
create table public.orbita_integration_credentials (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google','clickup','slack','discord')),
  company_id text not null check (company_id in ('company-1','company-2','company-3')),
  iv text not null,
  ciphertext text not null,
  updated_at timestamptz not null,
  primary key (owner_id, provider, company_id)
);
create table public.orbita_oauth_states (
  state_hash text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'google'),
  company_id text not null check (company_id in ('company-1','company-2','company-3')),
  iv text not null,
  ciphertext text not null,
  expires_at bigint not null,
  consumed_at bigint
);
create index orbita_oauth_expiry_idx on public.orbita_oauth_states(expires_at);

-- No browser policies: neither anonymous nor signed-in clients can read tokens.
alter table public.orbita_integration_credentials enable row level security;
alter table public.orbita_integration_credentials force row level security;
alter table public.orbita_oauth_states enable row level security;
alter table public.orbita_oauth_states force row level security;
revoke all on public.orbita_integration_credentials, public.orbita_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.orbita_integration_credentials, public.orbita_oauth_states to service_role;

create function public.orbita_disconnect(p_owner_id uuid, p_provider text, p_company_id text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  -- Lock/remove pending state before credentials, preventing an in-flight callback reconnect.
  delete from public.orbita_oauth_states where owner_id=p_owner_id and provider=p_provider and company_id=p_company_id;
  delete from public.orbita_integration_credentials where owner_id=p_owner_id and provider=p_provider and company_id=p_company_id;
end;
$$;
create function public.orbita_create_oauth_state(p_state_hash text, p_owner_id uuid, p_company_id text, p_iv text, p_ciphertext text, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.orbita_oauth_states where expires_at <= p_now or (owner_id=p_owner_id and provider='google' and company_id=p_company_id);
  insert into public.orbita_oauth_states(state_hash,owner_id,provider,company_id,iv,ciphertext,expires_at)
    values(p_state_hash,p_owner_id,'google',p_company_id,p_iv,p_ciphertext,p_now+600000);
end;
$$;
create function public.orbita_claim_oauth_state(p_state_hash text, p_owner_id uuid, p_now bigint)
returns setof public.orbita_oauth_states language sql security invoker set search_path = '' as $$
  update public.orbita_oauth_states set consumed_at=p_now
    where state_hash=p_state_hash and owner_id=p_owner_id and provider='google' and expires_at>p_now and consumed_at is null returning *;
$$;
create function public.orbita_commit_oauth(p_state_hash text, p_owner_id uuid, p_company_id text, p_iv text, p_ciphertext text, p_now bigint)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed public.orbita_oauth_states;
begin
  select * into claimed from public.orbita_oauth_states where state_hash=p_state_hash and owner_id=p_owner_id
    and provider='google' and company_id=p_company_id and expires_at>p_now and consumed_at is not null for update;
  if not found then return false; end if;
  insert into public.orbita_integration_credentials(owner_id,provider,company_id,iv,ciphertext,updated_at)
    values(p_owner_id,'google',p_company_id,p_iv,p_ciphertext,to_timestamp(p_now/1000.0))
    on conflict(owner_id,provider,company_id) do update set iv=excluded.iv,ciphertext=excluded.ciphertext,updated_at=excluded.updated_at;
  delete from public.orbita_oauth_states where state_hash=p_state_hash and owner_id=p_owner_id;
  return true;
end;
$$;
revoke all on function public.orbita_disconnect(uuid,text,text), public.orbita_create_oauth_state(text,uuid,text,text,text,bigint), public.orbita_claim_oauth_state(text,uuid,bigint), public.orbita_commit_oauth(text,uuid,text,text,text,bigint) from public, anon, authenticated;
grant execute on function public.orbita_disconnect(uuid,text,text), public.orbita_create_oauth_state(text,uuid,text,text,text,bigint), public.orbita_claim_oauth_state(text,uuid,bigint), public.orbita_commit_oauth(text,uuid,text,text,text,bigint) to service_role;
