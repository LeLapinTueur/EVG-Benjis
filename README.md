# Hub multi-sites

```
index.html            Accueil : un bouton par site, mot de passe à l'entrée
shared/config.js      URL + clé publique Supabase (à renseigner une fois)
shared/hub.js         Connexion, rôles, enregistrement automatique, barre du haut
evg/                  Site EVG
plan-de-table/        Site Plan de table
_modele/              Modèle pour créer un nouveau site
supabase-setup.sql    À exécuter une fois dans Supabase (SQL Editor)
vercel.json, robots.txt   Empêchent l'indexation par les moteurs de recherche
```

## Mise en route
1. Supabase > SQL Editor : collez et exécutez `supabase-setup.sql`.
2. Renseignez `shared/config.js` (Project Settings > API : URL + clé publique `anon` / `publishable`).
3. Poussez le dossier sur GitHub, importez le dépôt dans Vercel (preset « Other », rien d'autre à régler).
4. Ouvrez le site, cliquez sur chaque bouton : au premier passage, choisissez le mot de passe administrateur.
   Depuis le site, « 🔑 Mots de passe » permet de créer un mot de passe lecteur.

## Ajouter un nouveau site
1. Copiez `_modele/` en `mon-site/` et remplacez `'modele'` par `'mon-site'` dans le script.
2. Dans Supabase (SQL Editor) :
   `insert into public.sites (slug, title, emoji, description, sort_order) values ('mon-site', 'Mon site', '✈️', 'Description', 30);`
3. Poussez sur GitHub : le bouton apparaît tout seul sur l'accueil.

## Réglages d'un site (⚙️ sur l'accueil, ou « ⚙️ Réglages » dans le site)
Réservés à l'administrateur du site : changer le mot de passe admin, créer / supprimer le mot de passe lecteur,
et (plan de table uniquement) activer la **consultation libre** : tout le monde voit le site en lecture seule, sans mot de passe.
La base refuse la consultation libre sur les sites où `public_read_allowed = false` (c'est le cas de l'EVG).

## Mot de passe admin perdu
Dans Supabase (SQL Editor) : le site redevient « à configurer » et vous choisissez un nouveau mot de passe à l'accueil.
```sql
update public.sites set admin_hash = null where slug = 'evg';
delete from public.site_sessions where slug = 'evg';
```

## Site « Photos » (dépôt + galerie, stockage Google Drive)
Fichiers : `photos/index.html`, `api/photos.js` (relais Vercel), `outils/get-refresh-token.js`.
Mise en route complète : `outils/GUIDE-GOOGLE.md`.
