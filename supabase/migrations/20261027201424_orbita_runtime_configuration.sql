-- Version mirrors the migration applied by the Supabase connector.
-- Provisioning returns void. Never SELECT orbita_runtime_configuration() in tools:
-- that service-role-only RPC returns decrypted material exclusively to the Worker.
begin;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table public.orbita_runtime_settings (
  singleton boolean primary key default true check (singleton),
  owner_id uuid not null references auth.users(id),
  allowed_origin text not null,
  app_url text not null,
  credentials_secret_id uuid not null,
  updated_at timestamptz not null default now()
);
alter table public.orbita_runtime_settings enable row level security;
alter table public.orbita_runtime_settings force row level security;
revoke all on public.orbita_runtime_settings from public, anon, authenticated;
grant select, insert, update on public.orbita_runtime_settings to service_role;

create function public.orbita_runtime_configuration()
returns table(owner_id uuid, allowed_origin text, app_url text, credentials_key text)
language sql stable security invoker set search_path = '' as $$
  select settings.owner_id, settings.allowed_origin, settings.app_url, secret.decrypted_secret
    from public.orbita_runtime_settings as settings
    join vault.decrypted_secrets as secret on secret.id = settings.credentials_secret_id
    where settings.singleton = true;
$$;
revoke all on function public.orbita_runtime_configuration() from public, anon, authenticated;
grant execute on function public.orbita_runtime_configuration() to service_role;

create function public.orbita_provision_runtime_configuration(p_owner_id uuid, p_allowed_origin text, p_app_url text)
returns void language plpgsql security invoker set search_path = '' as $$
declare existing public.orbita_runtime_settings; secret_id uuid;
begin
  if p_owner_id is null or p_allowed_origin is null or p_app_url is null then
    raise exception 'All runtime settings are required';
  end if;
  if p_allowed_origin !~ '^https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?$'
     and p_allowed_origin !~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$' then
    raise exception 'An exact HTTPS origin without a path is required';
  end if;
  if pg_catalog.left(p_app_url, pg_catalog.length(p_allowed_origin)+1) <> p_allowed_origin || '/'
     or p_app_url ~ '[?#[:space:][:cntrl:]]' or pg_catalog.strpos(p_app_url, pg_catalog.chr(92)) > 0 then
    raise exception 'App URL must use the configured origin and a fixed safe path';
  end if;

  -- Serialise first provisioning so two calls can never rotate the encryption key.
  lock table public.orbita_runtime_settings in exclusive mode;
  select * into existing from public.orbita_runtime_settings where singleton = true;
  if found then
    if existing.owner_id <> p_owner_id then raise exception 'The runtime owner is already fixed'; end if;
    if not exists(select 1 from vault.decrypted_secrets where id=existing.credentials_secret_id and decrypted_secret ~ '^[A-Za-z0-9+/]{43}=$') then
      raise exception 'Existing runtime key is unavailable; do not regenerate it';
    end if;
    update public.orbita_runtime_settings set allowed_origin=p_allowed_origin,app_url=p_app_url,updated_at=now() where singleton=true;
    return;
  end if;

  if exists(select 1 from public.orbita_integration_credentials) then
    raise exception 'Existing encrypted integrations require explicit key migration';
  end if;
  if exists(select 1 from vault.secrets where name='orbita_credentials_key_v1') then
    raise exception 'A runtime secret already exists; reconcile it without rotation';
  end if;
  -- The plaintext key never leaves this expression, appears in SQL, or becomes a result.
  secret_id := vault.create_secret(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), 'orbita_credentials_key_v1', 'Orbita AES-256-GCM credentials key; never rotate while encrypted data exists');
  insert into public.orbita_runtime_settings(singleton,owner_id,allowed_origin,app_url,credentials_secret_id)
    values(true,p_owner_id,p_allowed_origin,p_app_url,secret_id);
end;
$$;
revoke all on function public.orbita_provision_runtime_configuration(uuid,text,text) from public, anon, authenticated;
grant execute on function public.orbita_provision_runtime_configuration(uuid,text,text) to service_role;
commit;
