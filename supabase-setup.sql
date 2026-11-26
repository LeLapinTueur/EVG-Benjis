-- =====================================================================
--  Hub multi-sites — à exécuter dans Supabase : SQL Editor > New query > Run
--  Peut être relancé sans risque (ne supprime rien, ne touche pas aux données).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tables ----------------------------------------------------
create table if not exists public.sites (
  slug            text primary key check (slug ~ '^[a-z0-9-]+$'),
  title           text not null,
  emoji           text not null default '📁',
  description     text not null default '',
  path            text,                              -- par défaut : /<slug>/
  sort_order      int  not null default 100,
  data            jsonb not null default '{}'::jsonb,
  admin_hash      text,                              -- null = site pas encore configuré
  reader_hash     text,                              -- null = pas d'accès lecteur
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

create table if not exists public.site_sessions (
  token      uuid primary key default gen_random_uuid(),
  slug       text not null references public.sites(slug) on delete cascade on update cascade,
  role       text not null check (role in ('admin', 'reader')),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index if not exists site_sessions_slug_idx on public.site_sessions (slug);

-- Justificatifs (confirmations, QR codes, PDF…) rattachés à un élément d'un site
create table if not exists public.site_files (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null references public.sites(slug) on delete cascade on update cascade,
  ref        text not null,                 -- ex. 'bruxelles/bxl-tr-1' (destination/élément)
  name       text not null,
  mime       text not null,
  size       int  not null,
  content    bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists site_files_slug_ref_idx on public.site_files (slug, ref);
alter table public.site_files enable row level security;
revoke all on public.site_files from anon, authenticated;

-- Consultation libre (sans mot de passe) : réservée aux sites où public_read_allowed = true.
-- L'administrateur d'un site autorisé peut l'activer / la couper depuis l'accueil.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sites' and column_name = 'public_read_allowed') then
    alter table public.sites
      add column public_read         boolean not null default false,   -- consultation libre activée ?
      add column public_read_allowed boolean not null default false;   -- le site a-t-il le droit de l'activer ?
    alter table public.sites add constraint sites_public_needs_allowed check (not public_read or public_read_allowed);
    update public.sites set public_read_allowed = true where slug = 'plan-de-table';
  end if;
end $$;

-- Aucun accès direct aux tables : tout passe par les fonctions ci-dessous
alter table public.sites         enable row level security;
alter table public.site_sessions enable row level security;
revoke all on public.sites, public.site_sessions from anon, authenticated;

-- ---------- Vos sites (ajoutez une ligne pour chaque nouveau bouton) -----
insert into public.sites (slug, title, emoji, description, sort_order, public_read_allowed) values
  ('evg',           'EVG',            '🎉', 'Planning et budget du week-end',        10, false),
  ('plan-de-table', 'Plan de table',  '💍', 'Invités, tables, menus, DJ et traiteur', 20, true),
  ('photos',        'Photos',         '📸', 'Dépôt et galerie des photos du mariage',  30, false)
on conflict (slug) do nothing;

-- ---------- Reprise de l'ancien planning EVG (si l'ancienne table existe) --
do $$
begin
  if to_regclass('public.evg_plans') is not null then
    update public.sites s
       set data = p.data,
           admin_hash = p.password_hash
      from (select e.data, e.password_hash
              from public.evg_plans e order by e.updated_at desc limit 1) p
     where s.slug = 'evg' and s.admin_hash is null and s.data = '{}'::jsonb;
  end if;
end $$;

-- ---------- Fonction interne : rôle d'une session -------------------------
create or replace function public._site_role(p_slug text, p_token uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_token is not null then
      (select ss.role from public.site_sessions ss
        where ss.token = p_token and ss.slug = p_slug and ss.expires_at > now())
    else  -- pas de session : lecteur seulement si la consultation libre est activée
      (select 'reader' from public.sites s
        where s.slug = p_slug and s.public_read and s.public_read_allowed)
  end;
$$;

-- ---------- Liste des sites (pour l'accueil) — aucune donnée sensible ----
drop function if exists public.list_sites();
create or replace function public.list_sites()
returns table (slug text, title text, emoji text, description text, path text, configured boolean,
               public_read boolean, can_be_public boolean)
language sql stable security definer set search_path = public as $$
  select s.slug, s.title, s.emoji, s.description,
         coalesce(s.path, '/' || s.slug || '/'), s.admin_hash is not null,
         s.public_read, s.public_read_allowed
    from public.sites s
   order by s.sort_order, s.title;
$$;

-- ---------- Première configuration : choisir le mot de passe admin -------
create or replace function public.site_claim(p_slug text, p_password text)
returns table (token uuid, role text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_token uuid;
begin
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Mot de passe trop court (6 caractères minimum)';
  end if;
  update public.sites s
     set admin_hash = crypt(p_password, gen_salt('bf'))
   where s.slug = p_slug and s.admin_hash is null;
  if not found then raise exception 'Ce site est déjà configuré'; end if;
  insert into public.site_sessions (slug, role) values (p_slug, 'admin')
  returning site_sessions.token into v_token;
  return query select v_token, 'admin'::text;
end $$;

-- ---------- Connexion : le mot de passe détermine le rôle ----------------
-- Renvoie (token, role) ou aucune ligne. Blocage 10 min après 5 échecs.
create or replace function public.site_login(p_slug text, p_password text)
returns table (token uuid, role text)
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sites%rowtype; v_role text; v_token uuid;
begin
  select * into s from public.sites where sites.slug = p_slug;
  if not found then perform pg_sleep(1); return; end if;
  if s.locked_until is not null and s.locked_until > now() then return; end if;

  if s.admin_hash is not null and s.admin_hash = crypt(p_password, s.admin_hash) then
    v_role := 'admin';
  elsif s.reader_hash is not null and s.reader_hash = crypt(p_password, s.reader_hash) then
    v_role := 'reader';
  end if;

  if v_role is null then
    update public.sites
       set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
           locked_until    = case when failed_attempts + 1 >= 5 then now() + interval '10 minutes' else null end
     where sites.slug = p_slug;
    perform pg_sleep(1);
    return;
  end if;

  update public.sites set failed_attempts = 0, locked_until = null where sites.slug = p_slug;
  delete from public.site_sessions where expires_at < now();
  insert into public.site_sessions (slug, role) values (p_slug, v_role)
  returning site_sessions.token into v_token;
  return query select v_token, v_role;
end $$;

-- ---------- Lecture des données (admin ou lecteur) -----------------------
create or replace function public.site_get(p_slug text, p_token uuid)
returns table (role text, title text, data jsonb, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  v_role := public._site_role(p_slug, p_token);
  if v_role is null then return; end if;
  return query
    select v_role, s.title, s.data, s.updated_at from public.sites s where s.slug = p_slug;
end $$;

-- ---------- Enregistrement (admin uniquement) ----------------------------
create or replace function public.site_save(p_slug text, p_token uuid, p_data jsonb)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare ts timestamptz;
begin
  if public._site_role(p_slug, p_token) is distinct from 'admin' then
    raise exception 'Session invalide';
  end if;
  if pg_column_size(p_data) > 8000000 then raise exception 'Données trop volumineuses'; end if;
  update public.sites set data = p_data, updated_at = now()
   where slug = p_slug returning updated_at into ts;
  return ts;
end $$;

-- ---------- Changer un mot de passe (admin uniquement) -------------------
-- p_role = 'admin' ou 'reader'. Mot de passe vide + 'reader' = supprimer l'accès lecteur.
-- Les autres sessions de ce rôle sont déconnectées.
create or replace function public.site_set_password(p_slug text, p_token uuid, p_role text, p_password text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s public.sites%rowtype;
begin
  if public._site_role(p_slug, p_token) is distinct from 'admin' then
    raise exception 'Session invalide';
  end if;
  if p_role not in ('admin', 'reader') then raise exception 'Rôle inconnu'; end if;
  select * into s from public.sites where sites.slug = p_slug;

  if coalesce(p_password, '') = '' then
    if p_role = 'admin' then raise exception 'Le mot de passe administrateur est obligatoire'; end if;
    update public.sites set reader_hash = null where sites.slug = p_slug;
    delete from public.site_sessions where site_sessions.slug = p_slug and site_sessions.role = 'reader';
    return;
  end if;

  if length(p_password) < 6 then raise exception 'Mot de passe trop court (6 caractères minimum)'; end if;
  if p_role = 'admin' and s.reader_hash is not null and s.reader_hash = crypt(p_password, s.reader_hash) then
    raise exception 'Doit être différent du mot de passe lecteur';
  end if;
  if p_role = 'reader' and s.admin_hash is not null and s.admin_hash = crypt(p_password, s.admin_hash) then
    raise exception 'Doit être différent du mot de passe administrateur';
  end if;

  if p_role = 'admin' then
    update public.sites set admin_hash = crypt(p_password, gen_salt('bf')) where sites.slug = p_slug;
    delete from public.site_sessions
     where site_sessions.slug = p_slug and site_sessions.role = 'admin' and site_sessions.token <> p_token;
  else
    update public.sites set reader_hash = crypt(p_password, gen_salt('bf')) where sites.slug = p_slug;
    delete from public.site_sessions where site_sessions.slug = p_slug and site_sessions.role = 'reader';
  end if;
end $$;

-- ---------- Réglages d'un site (admin uniquement) -------------------------
create or replace function public.site_settings(p_slug text, p_token uuid)
returns table (has_reader boolean, public_read boolean, can_be_public boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public._site_role(p_slug, p_token) is distinct from 'admin' then
    raise exception 'Session invalide';
  end if;
  return query
    select s.reader_hash is not null, s.public_read, s.public_read_allowed
      from public.sites s where s.slug = p_slug;
end $$;

-- ---------- Consultation libre on/off (admin uniquement) ------------------
create or replace function public.site_set_public(p_slug text, p_token uuid, p_public boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public._site_role(p_slug, p_token) is distinct from 'admin' then
    raise exception 'Session invalide';
  end if;
  if p_public and not exists (select 1 from public.sites s where s.slug = p_slug and s.public_read_allowed) then
    raise exception 'Ce site ne peut pas être consulté sans mot de passe';
  end if;
  update public.sites set public_read = p_public where slug = p_slug;
end $$;

-- ---------- Justificatifs --------------------------------------------------
-- Lecture : toute personne connectée avec un mot de passe (admin ou lecteur), jamais le public.
-- Écriture / suppression : administrateur uniquement.
create or replace function public._site_member(p_slug text, p_token uuid)
returns text
language sql stable security definer set search_path = public as $$
  select ss.role from public.site_sessions ss
   where p_token is not null and ss.token = p_token and ss.slug = p_slug and ss.expires_at > now();
$$;

create or replace function public.file_list(p_slug text, p_token uuid)
returns table (id uuid, ref text, name text, mime text, size int, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if public._site_member(p_slug, p_token) is null then raise exception 'Session invalide'; end if;
  return query
    select f.id, f.ref, f.name, f.mime, f.size, f.created_at
      from public.site_files f where f.slug = p_slug order by f.created_at;
end $$;

create or replace function public.file_get(p_slug text, p_token uuid, p_id uuid)
returns table (name text, mime text, b64 text)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if public._site_member(p_slug, p_token) is null then raise exception 'Session invalide'; end if;
  return query
    select f.name, f.mime, replace(encode(f.content, 'base64'), E'\n', '')
      from public.site_files f where f.id = p_id and f.slug = p_slug;
end $$;

create or replace function public.file_add(p_slug text, p_token uuid, p_ref text, p_name text, p_mime text, p_b64 text)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_bytes bytea; v_id uuid;
begin
  if public._site_member(p_slug, p_token) is distinct from 'admin' then raise exception 'Session invalide'; end if;
  if p_mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'message/rfc822') then
    raise exception 'Type de fichier non autorisé';
  end if;
  if coalesce(p_ref, '') = '' or length(p_ref) > 200 or coalesce(p_name, '') = '' or length(p_name) > 200 then
    raise exception 'Référence ou nom invalide';
  end if;
  v_bytes := decode(p_b64, 'base64');
  if length(v_bytes) > 4000000 then raise exception 'Fichier trop lourd (4 Mo maximum)'; end if;
  if (select coalesce(sum(f.size), 0) from public.site_files f where f.slug = p_slug) + length(v_bytes) > 150000000 then
    raise exception 'Espace de stockage plein (150 Mo)';
  end if;
  insert into public.site_files (slug, ref, name, mime, size, content)
  values (p_slug, p_ref, p_name, p_mime, length(v_bytes), v_bytes)
  returning site_files.id into v_id;
  return v_id;
end $$;

create or replace function public.file_delete(p_slug text, p_token uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public._site_member(p_slug, p_token) is distinct from 'admin' then raise exception 'Session invalide'; end if;
  delete from public.site_files where id = p_id and slug = p_slug;
end $$;

-- Supprime les fichiers d'un élément (p_ref exact) ou d'une destination entière (p_ref terminé par « / »)
create or replace function public.file_delete_refs(p_slug text, p_token uuid, p_ref text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public._site_member(p_slug, p_token) is distinct from 'admin' then raise exception 'Session invalide'; end if;
  if coalesce(p_ref, '') = '' then return; end if;
  delete from public.site_files
   where slug = p_slug
     and (ref = p_ref or (right(p_ref, 1) = '/' and left(ref, length(p_ref)) = p_ref));
end $$;

-- ---------- Déconnexion ---------------------------------------------------
create or replace function public.site_logout(p_token uuid)
returns void
language sql security definer set search_path = public as $$
  delete from public.site_sessions where token = p_token;
$$;

-- ---------- Droits ---------------------------------------------------------
revoke all on function public._site_role(text, uuid), public._site_member(text, uuid) from public, anon, authenticated;
revoke all on function
  public.list_sites(), public.site_claim(text, text), public.site_login(text, text),
  public.site_get(text, uuid), public.site_save(text, uuid, jsonb),
  public.site_set_password(text, uuid, text, text), public.site_logout(uuid),
  public.site_settings(text, uuid), public.site_set_public(text, uuid, boolean),
  public.file_list(text, uuid), public.file_get(text, uuid, uuid), public.file_add(text, uuid, text, text, text, text),
  public.file_delete(text, uuid, uuid), public.file_delete_refs(text, uuid, text)
  from public;
grant execute on function
  public.list_sites(), public.site_claim(text, text), public.site_login(text, text),
  public.site_get(text, uuid), public.site_save(text, uuid, jsonb),
  public.site_set_password(text, uuid, text, text), public.site_logout(uuid),
  public.site_settings(text, uuid), public.site_set_public(text, uuid, boolean),
  public.file_list(text, uuid), public.file_get(text, uuid, uuid), public.file_add(text, uuid, text, text, text, text),
  public.file_delete(text, uuid, uuid), public.file_delete_refs(text, uuid, text)
  to anon, authenticated;

-- =====================================================================
--  Pour ajouter un nouveau bouton plus tard (exemple) :
--    insert into public.sites (slug, title, emoji, description, sort_order)
--    values ('voyage', 'Voyage', '✈️', 'Itinéraire et réservations', 30);
--  puis ajoutez un dossier /voyage/ au projet (voir _modele/).
--  Pour autoriser la consultation libre sur ce site : public_read_allowed = true.
--
--  Mot de passe admin perdu ? Rendez le site « à configurer » (vous choisirez un nouveau mot de passe) :
--    update public.sites set admin_hash = null where slug = 'evg';
--    delete from public.site_sessions where slug = 'evg';
-- =====================================================================
