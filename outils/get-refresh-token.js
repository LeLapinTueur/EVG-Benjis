// À lancer UNE FOIS sur votre ordinateur (Node 18+) :  node outils/get-refresh-token.js
// Ouvre Google pour que vous autorisiez l'application, crée le dossier « Photos mariage »
// dans VOTRE Drive, puis affiche les 4 valeurs à copier dans Vercel.
// Droit demandé : « drive.file » = l'application ne voit QUE les fichiers qu'elle crée (pas le reste de votre Drive).
const http = require('http');
const { exec } = require('child_process');
const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
const folderName = process.argv[2] || 'Photos mariage';
if (!id || !secret) {
  console.log('Définissez d\'abord GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET (voir outils/GUIDE-GOOGLE.md, étape 4).');
  process.exit(1);
}
const PORT = 53682, REDIRECT = 'http://127.0.0.1:' + PORT;
const AUTH = process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const DRIVE = process.env.DRIVE_BASE || 'https://www.googleapis.com';
const url = AUTH + '?' + new URLSearchParams({
  client_id: id, redirect_uri: REDIRECT, response_type: 'code', access_type: 'offline', prompt: 'consent',
  scope: 'https://www.googleapis.com/auth/drive.file'
});
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  const code = u.searchParams.get('code');
  if (!code) { res.end('En attente…'); return; }
  try {
    const t = await (await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) })).json();
    if (!t.refresh_token) throw new Error('Pas de refresh_token : ' + JSON.stringify(t));
    const f = await (await fetch(DRIVE + '/drive/v3/files?fields=id', { method: 'POST',
      headers: { Authorization: 'Bearer ' + t.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' }) })).json();
    if (!f.id) throw new Error('Création du dossier impossible : ' + JSON.stringify(f));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<h2>C\'est fait ✅</h2><p>Retournez dans le terminal.</p>');
    console.log('\n=== À copier dans Vercel → Settings → Environment Variables ===');
    console.log('GOOGLE_CLIENT_ID=' + id);
    console.log('GOOGLE_CLIENT_SECRET=' + secret);
    console.log('GOOGLE_REFRESH_TOKEN=' + t.refresh_token);
    console.log('GOOGLE_FOLDER_ID=' + f.id);
    console.log('\nLe dossier « ' + folderName + ' » a été créé dans votre Google Drive.\n');
  } catch (e) { res.end('Erreur'); console.error(e.message); }
  srv.close(); setTimeout(() => process.exit(0), 200);
});
srv.listen(PORT, '127.0.0.1', () => {
  console.log('Ouvrez ce lien dans votre navigateur si rien ne s\'ouvre :\n' + url + '\n');
  const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(open + ' "' + url + '"', () => {});
});
