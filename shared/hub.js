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
  .hubovl input[type=checkbox]{display:inline;width:auto;margin:0 8px 0 0;vertical-align:middle}
  .hubovl .chk{display:block;font-weight:400;line-height:1.45;cursor:pointer}
  .hubovl .st{font-weight:600;color:#667085;font-size:12px}
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

  // ---- fenêtre « Réglages » d'un site (réservée à l'administrateur) ----
  // site = { slug, title }. Depuis l'accueil comme depuis le site lui-même.
  function manage(site, onClose) {
    injectCss();
    const slug = site.slug;
    const old = document.getElementById('hubMgOvl'); if (old) old.remove();
    const ovl = document.createElement('div');
    ovl.id = 'hubMgOvl'; ovl.className = 'hubovl';
    document.body.appendChild(ovl);
    let changed = false;
    const close = () => { ovl.remove(); if (onClose) onClose(changed); };
    ovl.addEventListener('click', (e) => { if (e.target === ovl) close(); });
    const render = (html) => { ovl.innerHTML = '<div class="box">' + html + '</div>'; return ovl.firstChild; };
    const msgOf = (root) => {
      const m = root.querySelector('.msg');
      return (t, cls) => { m.textContent = t || ''; m.className = 'msg ' + (cls || ''); };
    };
    const head = '<h3>⚙️ ' + esc(site.title) + '</h3>';

    async function start() {
      render(head + '<p class="d">Chargement…</p>');
      const ses = getSession(slug);
      if (ses && ses.role === 'admin') {
        try {
          const r = await rpc('site_settings', { p_slug: slug, p_token: ses.token });
          if (r && r.length) return panel(ses, r[0]);
        } catch (e) {
          if (!/Session invalide/.test(e.message)) return fail(e.message);
        }
        clearSession(slug);
      }
      loginStep();
    }
    function fail(m) {
      const b = render(head + '<div class="msg err">' + esc(m) + '</div><div class="row"><button type="button" id="mgClose">Fermer</button></div>');
      b.querySelector('#mgClose').onclick = close;
    }

    function loginStep(note) {
      const b = render(head +
        '<p class="d">Pour modifier les réglages de ce site, saisissez son mot de passe <b>administrateur</b>.</p>' +
        '<form><label>Mot de passe administrateur<input type="password" autocomplete="current-password"></label>' +
        '<div class="msg"></div><div class="row"><button type="button" id="mgClose">Annuler</button><button class="pri" type="submit">Continuer</button></div></form>');
      b.querySelector('#mgClose').onclick = close;
      const show = msgOf(b); if (note) show(note, 'err');
      const input = b.querySelector('input'); input.focus();
      b.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!input.value) return show('Saisissez le mot de passe.', 'err');
        const btn = b.querySelector('button[type=submit]'); btn.disabled = true; show('');
        try {
          const rows = await rpc('site_login', { p_slug: slug, p_password: input.value });
          if (!rows || !rows.length) { show('Mot de passe incorrect (après 5 erreurs, patientez 10 minutes).', 'err'); return; }
          if (rows[0].role !== 'admin') {
            try { await rpc('site_logout', { p_token: rows[0].token }); } catch (x) {}
            show('Ce mot de passe ne donne qu\'un accès lecteur : il faut le mot de passe administrateur.', 'err'); return;
          }
          setSession(slug, rows[0].token, 'admin'); changed = true;
          start();
        } catch (err) { show(err.message, 'err'); }
        finally { btn.disabled = false; }
      });
    }

    function panel(ses, st) {
      const pwForm = (role, label, hint, extra) =>
        '<form class="sec" data-role="' + role + '"><b>' + label + '</b> <span class="d">' + hint + '</span>' + extra +
        '<label>Nouveau mot de passe<input type="password" autocomplete="new-password"></label>' +
        '<label>Confirmer<input type="password" autocomplete="new-password"></label>' +
        '<div class="msg"></div><div class="row">' +
        (role === 'reader' ? '<button type="button" data-remove' + (st.has_reader ? '' : ' hidden') + '>Supprimer l\'accès lecteur</button>' : '') +
        '<button class="pri" type="submit">' + (role === 'admin' ? 'Changer' : 'Enregistrer') + '</button></div></form>';
      const b = render(head +
        '<p class="d">Réglages réservés à l\'administrateur de ce site.</p>' +
        pwForm('admin', 'Mot de passe administrateur', '(peut tout modifier)', '') +
        pwForm('reader', 'Mot de passe lecteur', '(consultation seule)', '<div class="st" id="mgReaderState">' + (st.has_reader ? 'Un mot de passe lecteur est défini.' : 'Aucun mot de passe lecteur défini.') + '</div>') +
        (st.can_be_public
          ? '<div class="sec"><label class="chk"><input type="checkbox" id="mgPublic"' + (st.public_read ? ' checked' : '') + '><b>Consultation libre</b> : tout le monde peut voir ce site en lecture seule, sans mot de passe. La modification reste réservée à l\'administrateur.</label><div class="msg" id="mgPubMsg"></div></div>'
          : '') +
        '<div class="row"><button type="button" id="mgClose">Fermer</button></div>');
      b.querySelector('#mgClose').onclick = close;

      b.querySelectorAll('form[data-role]').forEach((f) => {
        const show = msgOf(f);
        const apply = async (role, pw) => {
          show('');
          try {
            await rpc('site_set_password', { p_slug: slug, p_token: ses.token, p_role: role, p_password: pw });
            f.reset(); changed = true;
            show(pw ? '✅ Mot de passe enregistré.' : '✅ Accès lecteur supprimé.', 'ok');
            if (role === 'reader') {
              b.querySelector('#mgReaderState').textContent = pw ? 'Un mot de passe lecteur est défini.' : 'Aucun mot de passe lecteur défini.';
              f.querySelector('[data-remove]').hidden = !pw;
            }
          } catch (err) {
            if (/Session invalide/.test(err.message)) { clearSession(slug); return loginStep('Votre session a expiré, reconnectez-vous.'); }
            show(err.message, 'err');
          }
        };
        f.addEventListener('submit', (e) => {
          e.preventDefault(); show('');
          const [a, c] = f.querySelectorAll('input');
          if (a.value.length < 6) return show('6 caractères minimum.', 'err');
          if (a.value !== c.value) return show('Les deux saisies sont différentes.', 'err');
          apply(f.dataset.role, a.value);
        });
        const rm = f.querySelector('[data-remove]');
        if (rm) rm.onclick = () => { if (confirm('Supprimer l\'accès lecteur ?')) apply('reader', ''); };
      });

      const pub = b.querySelector('#mgPublic');
      if (pub) {
        const show = msgOf(b.querySelector('#mgPubMsg').parentNode);
        pub.addEventListener('change', async () => {
          const want = pub.checked;
          if (want && !confirm('Activer la consultation libre ? Toute personne ayant le lien pourra voir le contenu de ce site (sans pouvoir le modifier).')) { pub.checked = false; return; }
          pub.disabled = true; show('');
          try {
            await rpc('site_set_public', { p_slug: slug, p_token: ses.token, p_public: want });
            changed = true;
            show(want ? '✅ Consultation libre activée.' : '✅ Consultation libre désactivée : le mot de passe est de nouveau demandé.', 'ok');
          } catch (err) {
            pub.checked = !want;
            if (/Session invalide/.test(err.message)) { clearSession(slug); return loginStep('Votre session a expiré, reconnectez-vous.'); }
            show(err.message, 'err');
          } finally { pub.disabled = false; }
        });
      }
    }
    start();
  }

  // ---- connexion d'un site à la base ----
  async function connect(slug) {
    injectCss();
    if (!configured()) {
      fatal('Supabase n\'est pas configuré : renseignez l\'URL et la clé dans shared/config.js.');
      await never();
    }
    const fetchSite = (tok) => rpc('site_get', { p_slug: slug, p_token: tok });
    let ses = getSession(slug);
    let token = ses ? ses.token : null;   // null = visiteur sans mot de passe (site en consultation libre)
    let rows;
    try {
      rows = await fetchSite(token);
      if ((!rows || !rows.length) && token) { clearSession(slug); token = null; rows = await fetchSite(null); }
    } catch (e) { fatal('Connexion à Supabase impossible (' + e.message + ').'); await never(); }
    if (!rows || !rows.length) { location.replace(hubUrl(slug, ses ? 'expired' : '')); await never(); }

    const r = rows[0];
    const conn = {
      slug, role: r.role, title: r.title, data: r.data || {}, updatedAt: r.updated_at,
      isAdmin: r.role === 'admin', guest: token === null
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
          conn.updatedAt = await rpc('site_save', { p_slug: slug, p_token: token, p_data: getData() });
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
          const rs = await fetchSite(token);
          if (!rs || !rs.length) {                 // session expirée, ou consultation libre coupée
            if (token) return sessionLost();
            return location.replace(hubUrl(slug));
          }
          if (rs[0].updated_at !== conn.updatedAt) { conn.updatedAt = rs[0].updated_at; cb(rs[0].data || {}); }
        } catch (e) { /* réseau : on réessaiera */ }
      }, ms || 30000);
    };

    // Barre du haut : retour accueil, rôle, état, réglages, déconnexion
    conn.mountBar = function () {
      const label = conn.isAdmin ? '🛠️ Administrateur' : (conn.guest ? '👀 Consultation libre' : '👀 Lecture seule');
      const bar = document.createElement('div');
      bar.className = 'hubbar';
      bar.innerHTML =
        '<a href="/">← Accueil</a>' +
        '<span>' + esc(r.title) + '</span>' +
        '<span class="role ' + (conn.isAdmin ? 'admin' : '') + '">' + label + '</span>' +
        '<span class="grow"></span><span id="hubStatus"></span>' +
        (conn.isAdmin ? '<button type="button" id="hubPwdBtn">⚙️ Réglages</button>' : '') +
        '<button type="button" id="hubOutBtn">' + (conn.isAdmin ? '🚪 Déconnexion' : '🔐 Passer en admin') + '</button>';
      document.body.prepend(bar);
      document.getElementById('hubOutBtn').onclick = async () => { await logout(slug); location.href = hubUrl(slug); };
      if (conn.isAdmin) document.getElementById('hubPwdBtn').onclick = () => manage({ slug, title: r.title });
    };

    return conn;
  }

  window.Hub = { configured, rpc, getSession, setSession, clearSession, allSessions, login, claim, logout, connect, manage, esc };
})();
