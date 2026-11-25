/* Hub — bibliothèque commune à l'accueil et à tous les sites.
 * Gère : appels Supabase, sessions (mot de passe -> rôle admin / lecteur),
 * enregistrement automatique, barre du haut et fenêtre « mots de passe ». */
(function () {
  const C = window.HUB_CONFIG || {};
  const KEY_PREFIX = 'hub_session_';

  const configured = () =>
    /^https?:\/\//.test(C.SUPABASE_URL || '') && !/VOTRE/.test((C.SUPABASE_URL || '') + (C.SUPABASE_KEY || ''));

  async function rpc(fn, args) {
    const headers = { 'Content-Type': 'application/json', apikey: C.SUPABASE_KEY };
    // Anciennes clés (JWT « eyJ… ») : aussi dans Authorization. Les clés « sb_publishable_… » : non.
    if ((C.SUPABASE_KEY || '').startsWith('eyJ')) headers.Authorization = 'Bearer ' + C.SUPABASE_KEY;
    const res = await fetch(C.SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(args || {}) });
    if (!res.ok) {
      let j = {};
      try { j = await res.json(); } catch (e) {}
      const err = new Error(j.message || j.hint || ('Erreur ' + res.status));
      err.status = res.status;
      throw err;
    }
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  // ---- sessions (stockées dans ce navigateur) ----
  function getSession(slug) {
    try { return JSON.parse(localStorage.getItem(KEY_PREFIX + slug)); } catch (e) { return null; }
  }
  function setSession(slug, token, role) {
    try { localStorage.setItem(KEY_PREFIX + slug, JSON.stringify({ token, role })); } catch (e) {}
  }
  function clearSession(slug) { try { localStorage.removeItem(KEY_PREFIX + slug); } catch (e) {} }
  function allSessions() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(KEY_PREFIX)) out.push(k.slice(KEY_PREFIX.length));
      }
    } catch (e) {}
    return out;
  }

  async function login(slug, password) {
    const rows = await rpc('site_login', { p_slug: slug, p_password: password });
    if (!rows || !rows.length) return null;
    setSession(slug, rows[0].token, rows[0].role);
    return rows[0];
  }
  async function claim(slug, password) {
    const rows = await rpc('site_claim', { p_slug: slug, p_password: password });
    setSession(slug, rows[0].token, rows[0].role);
    return rows[0];
  }
  async function logout(slug) {
    const s = getSession(slug);
    clearSession(slug);
    if (s && configured()) { try { await rpc('site_logout', { p_token: s.token }); } catch (e) {} }
  }

  const hubUrl = (slug, why) => '/?open=' + encodeURIComponent(slug) + (why ? '&why=' + why : '');
  const never = () => new Promise(() => {});
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- styles de la barre et des fenêtres ----
  const CSS = `
  .hubbar{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#101a2d;color:#fff;
    padding:7px 14px;font:600 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .hubbar a{color:#fff;text-decoration:none;opacity:.85}.hubbar a:hover{opacity:1}
  .hubbar .grow{flex:1}
  .hubbar .role{background:rgba(255,255,255,.14);border-radius:999px;padding:3px 10px}
  .hubbar .role.admin{background:#ffc928;color:#172238}
  .hubbar #hubStatus{font-weight:600;opacity:.85}.hubbar #hubStatus.err{color:#ffb4ab;opacity:1}
  .hubbar button{font:inherit;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:4px 10px;cursor:pointer}
  .hubbar button:hover{background:rgba(255,255,255,.24)}
  .hubovl{position:fixed;inset:0;background:rgba(16,26,45,.55);display:grid;place-items:center;padding:18px;z-index:100;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .hubovl.hidden{display:none}
  .hubovl .box{background:#fff;color:#172238;border-radius:16px;padding:22px;max-width:520px;width:100%;max-height:90vh;overflow:auto}
  .hubovl h3{margin:0 0 4px;font-size:18px}.hubovl p.d{margin:0 0 6px;color:#667085;font-size:13px}
  .hubovl .sec{border-top:1px solid #e5e8ee;margin-top:14px;padding-top:12px}
  .hubovl label{display:block;font-weight:700;font-size:13px;margin-top:8px}
  .hubovl input{display:block;width:100%;margin-top:3px;padding:9px 10px;border:1px solid #d0d5dd;border-radius:8px;font:inherit}
  .hubovl .msg{min-height:18px;font-size:13px;font-weight:700;margin-top:8px}.hubovl .msg.err{color:#b42318}.hubovl .msg.ok{color:#16794b}
  .hubovl .row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap}
  .hubovl button{font:inherit;font-weight:700;border:1px solid #d0d5dd;background:#fff;color:#172238;border-radius:10px;padding:8px 14px;cursor:pointer}
  .hubovl button.pri{background:#101a2d;border-color:#101a2d;color:#fff}
  .hubovl button:disabled{opacity:.6;cursor:default}
  .hubfatal{position:fixed;inset:0;background:#f5f6f8;color:#172238;display:grid;place-items:center;padding:24px;z-index:200;text-align:center;
    font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .hubfatal div{max-width:440px}.hubfatal a{color:#245a9a}
  `;
  function injectCss() {
    if (document.getElementById('hubCss')) return;
    const st = document.createElement('style');
    st.id = 'hubCss'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  function fatal(msg) {
    injectCss();
    const d = document.createElement('div');
    d.className = 'hubfatal';
    d.innerHTML = '<div><p style="font-size:34px;margin:0">⚠️</p><p>' + esc(msg) + '</p><p><a href="/">← Retour à l\'accueil</a></p></div>';
    document.body.appendChild(d);
  }

  // ---- connexion d'un site à la base ----
  async function connect(slug) {
    injectCss();
    if (!configured()) {
      fatal('Supabase n\'est pas configuré : renseignez l\'URL et la clé dans shared/config.js.');
      await never();
    }
    const s = getSession(slug);
    if (!s) { location.replace(hubUrl(slug)); await never(); }

    let rows;
    try { rows = await rpc('site_get', { p_slug: slug, p_token: s.token }); }
    catch (e) { fatal('Connexion à Supabase impossible (' + e.message + ').'); await never(); }
    if (!rows || !rows.length) { clearSession(slug); location.replace(hubUrl(slug, 'expired')); await never(); }

    const r = rows[0];
    const conn = {
      slug, role: r.role, title: r.title, data: r.data || {}, updatedAt: r.updated_at,
      isAdmin: r.role === 'admin'
    };
    let timer = null;

    const setStatus = (msg, isErr) => {
      const el = document.getElementById('hubStatus');
      if (!el) return;
      el.textContent = msg || '';
      el.classList.toggle('err', !!isErr);
    };
    conn.setStatus = setStatus;

    function sessionLost() {
      clearSession(slug);
      alert('Votre session a expiré ou le mot de passe a été changé. Reconnectez-vous.');
      location.replace(hubUrl(slug, 'expired'));
    }

    // Enregistrement automatique (admin) : appelé après chaque modification
    conn.save = function (getData) {
      if (!conn.isAdmin) return;
      clearTimeout(timer);
      setStatus('✏️ Modifications en attente…');
      timer = setTimeout(async () => {
        timer = null;
        setStatus('☁️ Enregistrement…');
        try {
          conn.updatedAt = await rpc('site_save', { p_slug: slug, p_token: s.token, p_data: getData() });
          setStatus('✅ Enregistré');
        } catch (e) {
          if (/Session invalide/.test(e.message)) return sessionLost();
          setStatus('⚠️ Échec de l\'enregistrement : ' + e.message, true);
        }
      }, 700);
    };
    window.addEventListener('beforeunload', (e) => { if (timer) { e.preventDefault(); e.returnValue = ''; } });

    // Mise à jour automatique pour les lecteurs
    conn.poll = function (cb, ms) {
      setInterval(async () => {
        if (document.hidden) return;
        try {
          const rs = await rpc('site_get', { p_slug: slug, p_token: s.token });
          if (!rs || !rs.length) return sessionLost();
          if (rs[0].updated_at !== conn.updatedAt) { conn.updatedAt = rs[0].updated_at; cb(rs[0].data || {}); }
        } catch (e) { /* réseau : on réessaiera */ }
      }, ms || 30000);
    };

    // Barre du haut : retour accueil, rôle, état, mots de passe, déconnexion
    conn.mountBar = function () {
      const bar = document.createElement('div');
      bar.className = 'hubbar';
      bar.innerHTML =
        '<a href="/">← Accueil</a>' +
        '<span>' + esc(r.title) + '</span>' +
        '<span class="role ' + (conn.isAdmin ? 'admin' : '') + '">' + (conn.isAdmin ? '🛠️ Administrateur' : '👀 Lecture seule') + '</span>' +
        '<span class="grow"></span><span id="hubStatus"></span>' +
        (conn.isAdmin ? '<button type="button" id="hubPwdBtn">🔑 Mots de passe</button>' : '') +
        '<button type="button" id="hubOutBtn">' + (conn.isAdmin ? '🚪 Déconnexion' : '🔐 Passer en admin') + '</button>';
      document.body.prepend(bar);
      document.getElementById('hubOutBtn').onclick = async () => { await logout(slug); location.href = hubUrl(slug); };
      if (conn.isAdmin) document.getElementById('hubPwdBtn').onclick = () => openPasswords();
    };

    // Fenêtre « mots de passe » (admin)
    function openPasswords() {
      let ovl = document.getElementById('hubPwdOvl');
      if (!ovl) {
        ovl = document.createElement('div');
        ovl.id = 'hubPwdOvl'; ovl.className = 'hubovl hidden';
        ovl.innerHTML =
          '<div class="box"><h3>🔑 Mots de passe</h3>' +
          '<p class="d">Le mot de passe saisi à l\'accueil détermine le rôle. Les deux doivent être différents.</p>' +
          '<form class="sec" data-role="admin"><b>Administrateur</b> <span class="d">(peut tout modifier)</span>' +
          '<label>Nouveau mot de passe<input type="password" autocomplete="new-password"></label>' +
          '<label>Confirmer<input type="password" autocomplete="new-password"></label>' +
          '<div class="msg"></div><div class="row"><button class="pri" type="submit">Changer</button></div></form>' +
          '<form class="sec" data-role="reader"><b>Lecteur</b> <span class="d">(consultation seule)</span>' +
          '<label>Nouveau mot de passe<input type="password" autocomplete="new-password"></label>' +
          '<label>Confirmer<input type="password" autocomplete="new-password"></label>' +
          '<div class="msg"></div><div class="row"><button type="button" data-remove>Supprimer l\'accès lecteur</button><button class="pri" type="submit">Enregistrer</button></div></form>' +
          '<div class="row"><button type="button" id="hubPwdClose">Fermer</button></div></div>';
        document.body.appendChild(ovl);
        ovl.addEventListener('click', (e) => { if (e.target === ovl) ovl.classList.add('hidden'); });
        ovl.querySelector('#hubPwdClose').onclick = () => ovl.classList.add('hidden');
        ovl.querySelectorAll('form').forEach((f) => {
          const msg = f.querySelector('.msg');
          const show = (t, cls) => { msg.textContent = t; msg.className = 'msg ' + (cls || ''); };
          const apply = async (role, pw) => {
            show('');
            try {
              await rpc('site_set_password', { p_slug: slug, p_token: s.token, p_role: role, p_password: pw });
              f.reset(); show(pw ? '✅ Mot de passe enregistré.' : '✅ Accès lecteur supprimé.', 'ok');
            } catch (err) { show(err.message, 'err'); }
          };
          f.addEventListener('submit', (e) => {
            e.preventDefault();
            show('');
            const [a, b] = f.querySelectorAll('input');
            if (a.value.length < 6) return show('6 caractères minimum.', 'err');
            if (a.value !== b.value) return show('Les deux saisies sont différentes.', 'err');
            apply(f.dataset.role, a.value);
          });
          const rm = f.querySelector('[data-remove]');
          if (rm) rm.onclick = () => { if (confirm('Supprimer l\'accès lecteur ? Plus personne ne pourra consulter sans le mot de passe admin.')) apply('reader', ''); };
        });
      }
      ovl.querySelectorAll('form').forEach((f) => { f.reset(); const m = f.querySelector('.msg'); m.textContent = ''; m.className = 'msg'; });
      ovl.classList.remove('hidden');
    }

    return conn;
  }

  window.Hub = { configured, rpc, getSession, setSession, clearSession, allSessions, login, claim, logout, connect, esc };
})();
