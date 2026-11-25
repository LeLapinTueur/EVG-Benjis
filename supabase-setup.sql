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

-- Aucun accès direct aux tables : tout passe par les fonctions ci-dessous
alter table public.sites         enable row level security;
alter table public.site_sessions enable row level security;
revoke all on public.sites, public.site_sessions from anon, authenticated;

-- ---------- Vos sites (ajoutez une ligne pour chaque nouveau bouton) -----
insert into public.sites (slug, title, emoji, description, sort_order) values
  ('evg',           'EVG',            '🎉', 'Planning et budget du week-end',        10),
  ('plan-de-table', 'Plan de table',  '💍', 'Invités, tables, menus, DJ et traiteur', 20)
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
  select ss.role from public.site_sessions ss
   where ss.token = p_token and ss.slug = p_slug and ss.expires_at > now();
$$;

-- ---------- Liste des sites (pour l'accueil) — aucune donnée sensible ----
create or replace function public.list_sites()
returns table (slug text, title text, emoji text, description text, path text, configured boolean)
language sql stable security definer set search_path = public as $$
  select s.slug, s.title, s.emoji, s.description,
         coalesce(s.path, '/' || s.slug || '/'), s.admin_hash is not null
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

-- ---------- Déconnexion ---------------------------------------------------
create or replace function public.site_logout(p_token uuid)
returns void
language sql security definer set search_path = public as $$
  delete from public.site_sessions where token = p_token;
$$;

-- ---------- Droits ---------------------------------------------------------
revoke all on function public._site_role(text, uuid) from public, anon, authenticated;
revoke all on function
  public.list_sites(), public.site_claim(text, text), public.site_login(text, text),
  public.site_get(text, uuid), public.site_save(text, uuid, jsonb),
  public.site_set_password(text, uuid, text, text), public.site_logout(uuid)
  from public;
grant execute on function
  public.list_sites(), public.site_claim(text, text), public.site_login(text, text),
  public.site_get(text, uuid), public.site_save(text, uuid, jsonb),
  public.site_set_password(text, uuid, text, text), public.site_logout(uuid)
  to anon, authenticated;

-- =====================================================================
--  Pour ajouter un nouveau bouton plus tard (exemple) :
--    insert into public.sites (slug, title, emoji, description, sort_order)
--    values ('voyage', 'Voyage', '✈️', 'Itinéraire et réservations', 30);
--  puis ajoutez un dossier /voyage/ au projet (voir _modele/).
-- =====================================================================
