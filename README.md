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

## Site « Chambres » (attribution des chambres aux invités)
Fichier : `chambres/index.html`. Les invités viennent du plan de table (fonctions SQL `guests_list` / `guests_add`).
Un invité ajouté dans Chambres est aussi ajouté au plan de table (sans table) ; la suppression d'un invité se fait uniquement dans le plan de table.

## Site « Invités » (liste de référence)
Fichier : `invites/index.html`. C'est ici que l'on ajoute / modifie / supprime les invités. « Plan de table » et « Chambres » en reprennent la liste
(synchronisation côté base : voir `_reconcile_plan` dans `supabase-setup.sql`). La table et le menu se choisissent dans Plan de table, la chambre dans Chambres ;
Invités les affiche. Au premier lancement du SQL, les invités déjà présents dans le plan de table sont repris automatiquement.

## Chambres : deux modes
« Avec lits » (lits dessinés, une place par couchage) et « Simple » (nom de chambre + nombre de places, on place les invités sans choisir de lit).
Le mode est enregistré avec les chambres (visible par tous) ; on passe de l'un à l'autre sans perdre les données (les lits sont conservés en mode simple).

## EVG : récap en vignettes
Par défaut, la page affiche une vignette par section (transport, hébergement, jours 1-3) : résumé, sous-total, réservations. Un clic ouvre le détail ;
« Tout afficher » rétablit l'ancienne page complète. On peut ajouter un élément depuis une vignette (« + Ajouter ») ou depuis la journée ouverte.

## Sécurité : où sont les secrets ?
- **Mots de passe des sites** : jamais dans le code. Ils sont enregistrés dans Supabase sous forme de hachage (bcrypt) ; on ne peut pas les relire, seulement les remplacer (⚙️ sur la carte, ou SQL). 8 caractères minimum pour un nouveau mot de passe.
- **`shared/config.js`** : contient seulement l'URL Supabase et la clé *publique* (prévue pour être visible). Jamais la clé « service_role » / « secret ».
- **Google (Photos)** : `GOOGLE_*` uniquement dans les variables d'environnement Vercel, jamais sur GitHub. Le fichier `client.json` téléchargé chez Google est ignoré par `.gitignore` : ne le publiez pas.
- Protection contre les essais : 5 mots de passe faux = site bloqué 10 minutes.
