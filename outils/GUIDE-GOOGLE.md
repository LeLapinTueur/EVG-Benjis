# Brancher le site Photos à votre Google Drive (≈ 20 min, une seule fois)

Résultat : les invités déposent leurs photos sur le site → elles arrivent dans un dossier « Photos mariage » de **votre** Google Drive, en qualité d'origine, et s'affichent aussi dans la galerie du site.

> Les noms des menus Google changent parfois un peu ; l'idée reste la même.

## 1. Mettre à jour la base (Supabase)
Exécutez de nouveau `supabase-setup.sql` dans l'éditeur SQL de Supabase (il ajoute le bouton « Photos » sans toucher au reste).

## 2. Créer le projet Google
1. Allez sur https://console.cloud.google.com (connexion avec le compte Google dont vous voulez utiliser le Drive).
2. Menu en haut → **Nouveau projet** → nom « Photos mariage » → Créer.
3. **API et services → Bibliothèque** → cherchez **Google Drive API** → **Activer**.

## 3. Écran de consentement — important
1. **API et services → Écran de consentement OAuth** (ou « Google Auth Platform »).
2. Type d'utilisateur : **Externe**. Nom de l'appli : « Photos mariage », votre e-mail partout où il est demandé.
3. **Publier l'application** (statut « **En production** »). ⚠️ Si elle reste en « Test », Google invalide le jeton au bout de **7 jours** et les dépôts s'arrêteront en plein mariage.
   - Le droit utilisé (`drive.file`) n'est pas « sensible » : aucune validation Google n'est nécessaire. Un écran « application non vérifiée » peut s'afficher à la connexion : **Paramètres avancés → Continuer** (c'est votre propre appli).

## 4. Créer l'identifiant
1. **Identifiants → Créer des identifiants → ID client OAuth**.
2. Type : **Application de bureau**. Créer.
3. Notez l'**ID client** et le **code secret du client**.

## 5. Obtenir le jeton (sur votre ordinateur, Node 18+ installé)
Dans le dossier du projet :

```
# Mac / Linux
GOOGLE_CLIENT_ID="votre-id" GOOGLE_CLIENT_SECRET="votre-secret" node outils/get-refresh-token.js

# Windows (PowerShell)
$env:GOOGLE_CLIENT_ID="votre-id"; $env:GOOGLE_CLIENT_SECRET="votre-secret"; node outils/get-refresh-token.js
```

Le navigateur s'ouvre → choisissez votre compte → **Autoriser**. Le script crée le dossier **« Photos mariage »** dans votre Drive et affiche 4 lignes.
Le droit demandé ne permet à l'appli de voir **que** les fichiers qu'elle a créés, pas le reste de votre Drive.

## 6. Les mettre dans Vercel
Projet Vercel → **Settings → Environment Variables**, ajoutez (pour Production) :

| Nom | Valeur |
|---|---|
| `GOOGLE_CLIENT_ID` | affiché par le script |
| `GOOGLE_CLIENT_SECRET` | affiché par le script |
| `GOOGLE_REFRESH_TOKEN` | affiché par le script |
| `GOOGLE_FOLDER_ID` | affiché par le script |
| `SUPABASE_URL` | la même que dans `shared/config.js` |
| `SUPABASE_KEY` | la même clé publique que dans `shared/config.js` |

Puis **Deployments → ⋯ → Redeploy**. Ne mettez jamais ces valeurs dans GitHub.

## 7. Mots de passe et partage
1. Sur l'accueil, cliquez le bouton **Photos** : choisissez votre mot de passe **admin**.
2. ⚙️ sur la carte → définissez le mot de passe **lecteur** : c'est celui des invités (déposer + regarder).
3. Astuce : générez un QR code vers `https://votre-site/photos/` et imprimez-le sur les tables, avec le mot de passe.

## Bon à savoir
- Les invités voient des **aperçus** ; les originaux restent dans votre Drive (dossier « Photos mariage »). Les vidéos s'affichent en aperçu : vous les lisez dans Drive.
- Vous pouvez fermer les dépôts (case dans la page Photos) et supprimer une photo : elle part dans la **corbeille Drive** (récupérable 30 jours).
- Taille maximale par fichier : 500 Mo (variable `MAX_UPLOAD_MB`). Les photos sont comptées dans votre espace Google (15 Go gratuits partagés avec Gmail/Photos).
- Si un jour la page affiche « Connexion à Google impossible » : refaites l'étape 5 et remplacez `GOOGLE_REFRESH_TOKEN` dans Vercel.
