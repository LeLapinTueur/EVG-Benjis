// Relais Vercel entre le site « Photos » et Google Drive.
// - Vérifie la session du visiteur auprès de Supabase (même mots de passe que le reste du site).
// - Garde le jeton Google côté serveur (variables d'environnement Vercel) : il n'est jamais envoyé au navigateur.
// - Ne fait JAMAIS transiter les photos d'origine : le téléphone les envoie directement à Google
//   (une fonction Vercel est limitée à ~4,5 Mo par requête).
//
// Variables d'environnement requises (Vercel → Settings → Environment Variables) :
//   SUPABASE_URL, SUPABASE_KEY            (les mêmes que dans shared/config.js)
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_FOLDER_ID   (voir outils/GUIDE-GOOGLE.md)
// Facultatives : PHOTOS_SLUG (défaut « photos »), MAX_UPLOAD_MB (défaut 500)

const SLUG = process.env.PHOTOS_SLUG || 'photos';
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 500);
const DRIVE = process.env.DRIVE_BASE || 'https://www.googleapis.com';       // surchargés uniquement pour les tests
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const ID_RE = /^[A-Za-z0-9_-]{10,100}$/;

let cache = { token: null, exp: 0 };

async function accessToken() {
  if (cache.token && Date.now() < cache.exp - 60000) return cache.token;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token'
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const e = new Error('google_auth'); e.detail = j.error_description || j.error || r.status; throw e;
  }
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cache.token;
}

async function drive(path, opts) {
  const t = await accessToken();
  return fetch(DRIVE + path, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t }, (opts && opts.headers) || {}) }));
}

// Session Supabase → { role, data } ou null
async function whoami(token) {
  const key = process.env.SUPABASE_KEY;
  const h = { 'Content-Type': 'application/json', apikey: key };
  if (key && key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  const r = await fetch(process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/site_get', {
    method: 'POST', headers: h, body: JSON.stringify({ p_slug: SLUG, p_token: token || null })
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows && rows[0] ? { role: rows[0].role, data: rows[0].data || {} } : null;
}

const send = (res, code, obj) => { res.status(code).setHeader('Cache-Control', 'no-store'); res.json(obj); };
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>"\\/]/g, ' ').trim().slice(0, n);

// Le fichier appartient-il bien au dossier de l'application ? (évite de lire d'autres fichiers)
async function inFolder(id) {
  if (!ID_RE.test(id || '')) return null;
  const r = await drive('/drive/v3/files/' + id + '?fields=id,name,mimeType,size,parents,thumbnailLink,trashed&supportsAllDrives=true');
  if (!r.ok) return null;
  const f = await r.json();
  return (!f.trashed && (f.parents || []).includes(process.env.GOOGLE_FOLDER_ID)) ? f : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST uniquement' });
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    const who = await whoami(b.token);
    if (!who) return send(res, 401, { error: 'Session invalide ou expirée. Reconnectez-vous.' });
    const admin = who.role === 'admin';
    const folder = process.env.GOOGLE_FOLDER_ID;

    if (b.action === 'list') {
      const q = encodeURIComponent("'" + folder + "' in parents and trashed=false and (mimeType contains 'image/' or mimeType contains 'video/')");
      const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,appProperties,imageMediaMetadata(width,height)' + (admin ? ',webViewLink' : '') + ')');
      const pt = b.pageToken ? '&pageToken=' + encodeURIComponent(b.pageToken) : '';
      const r = await drive('/drive/v3/files?q=' + q + '&orderBy=createdTime%20desc&pageSize=60&fields=' + fields + pt + '&supportsAllDrives=true&includeItemsFromAllDrives=true');
      if (!r.ok) return send(res, 502, { error: 'Google Drive a refusé la lecture (' + r.status + ').' });
      const j = await r.json();
      return send(res, 200, {
        role: who.role, uploadsOpen: who.data.uploadsOpen !== false, nextPageToken: j.nextPageToken || null,
        folderUrl: admin ? 'https://drive.google.com/drive/folders/' + folder : null,
        items: (j.files || []).map(f => ({
          id: f.id, name: f.name, mime: f.mimeType, size: Number(f.size || 0), created: f.createdTime,
          by: (f.appProperties && f.appProperties.by) || '', w: f.imageMediaMetadata && f.imageMediaMetadata.width,
          h: f.imageMediaMetadata && f.imageMediaMetadata.height, link: f.webViewLink || null
        }))
      });
    }

    if (b.action === 'thumb') {      // aperçu (jamais l'original) — renvoie l'image en binaire
      const f = await inFolder(b.id);
      if (!f) return send(res, 404, { error: 'Introuvable' });
      const size = Math.min(Math.max(parseInt(b.size, 10) || 400, 100), 1600);
      if (f.thumbnailLink) {
        const url = f.thumbnailLink.replace(/=s\d+(-c)?$/, '') + '=s' + size;
        let r = await fetch(url, { headers: { Authorization: 'Bearer ' + (await accessToken()) } });
        if (!r.ok) r = await fetch(url);
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length < 4300000) {
            res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
            res.setHeader('Cache-Control', 'private, max-age=86400');
            return res.status(200).send(buf);
          }
        }
      }
      // Pas d'aperçu Google (pas encore généré) : petite image d'origine si elle tient dans la limite Vercel
      if (f.mimeType.startsWith('image/') && Number(f.size) < 4000000) {
        const r = await drive('/drive/v3/files/' + f.id + '?alt=media');
        if (r.ok) {
          res.setHeader('Content-Type', f.mimeType); res.setHeader('Cache-Control', 'private, max-age=3600');
          return res.status(200).send(Buffer.from(await r.arrayBuffer()));
        }
      }
      return send(res, 404, { error: 'Aperçu pas encore disponible' });
    }

    if (b.action === 'init-upload') {  // crée une session d'envoi directe navigateur → Google
      if (!admin && who.data.uploadsOpen === false) return send(res, 403, { error: 'Les dépôts sont fermés.' });
      const mime = String(b.mime || '');
      const size = Number(b.size);
      if (!/^(image|video)\/[\w.+-]+$/.test(mime)) return send(res, 400, { error: 'Seules les photos et vidéos sont acceptées.' });
      if (!(size > 0) || size > MAX_MB * 1048576) return send(res, 400, { error: 'Fichier trop volumineux (max ' + MAX_MB + ' Mo).' });
      const name = clean(b.name, 120) || 'photo';
      const by = clean(b.by, 40);
      const origin = req.headers.origin || '';
      const r = await drive('/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
        method: 'POST',
        headers: Object.assign({
          'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size)
        }, origin ? { Origin: origin } : {}),
        body: JSON.stringify({ name: (by ? by + ' - ' : '') + name, parents: [folder], appProperties: { by } })
      });
      const loc = r.headers.get('location');
      if (!r.ok || !loc) return send(res, 502, { error: 'Google Drive a refusé le dépôt (' + r.status + ').' });
      return send(res, 200, { url: loc });
    }

    if (b.action === 'delete') {       // met à la corbeille Drive (récupérable 30 jours)
      if (!admin) return send(res, 403, { error: 'Réservé à l\'administrateur.' });
      const f = await inFolder(b.id);
      if (!f) return send(res, 404, { error: 'Introuvable' });
      const r = await drive('/drive/v3/files/' + f.id + '?supportsAllDrives=true', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true })
      });
      return r.ok ? send(res, 200, { ok: true }) : send(res, 502, { error: 'Suppression refusée (' + r.status + ').' });
    }

    return send(res, 400, { error: 'Action inconnue' });
  } catch (e) {
    if (e.message === 'google_auth') {
      return send(res, 502, { error: 'Connexion à Google impossible (' + e.detail + '). Le jeton a peut-être expiré : voir outils/GUIDE-GOOGLE.md.' });
    }
    return send(res, 500, { error: 'Erreur serveur' });
  }
};
