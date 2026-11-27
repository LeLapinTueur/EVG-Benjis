// Feuille d'impression propre : ouvre une fenêtre avec le contenu fourni, puis lance l'impression.
window.PrintSheet = {
  open(opt) {
    const w = window.open('', '_blank');
    if (!w) return false;
    const css = 'body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#222} h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:18px 0 6px} .sub{margin:0 0 14px;color:#555}' +
      'table{border-collapse:collapse;width:100%} th,td{border:1px solid #bbb;padding:6px 9px;text-align:left;vertical-align:top} th{background:#eee}' +
      'td.c,th.c{text-align:center;width:28px} .gh td{background:#eef2f9;font-weight:700} tr{break-inside:avoid} small{color:#555}' +
      '.rooms{display:grid;grid-template-columns:1fr 1fr;gap:12px} .room{border:1px solid #999;border-radius:8px;padding:10px 12px;break-inside:avoid}' +
      '.room h3{margin:0 0 2px;font-size:15px} .room .meta{color:#555;font-size:12px;margin-bottom:6px} .room ol,.room ul{margin:0;padding-left:20px} .room li{padding:2px 0}' +
      '.room .free{color:#999;font-style:italic} .room .bed{margin:4px 0 0;font-size:12px;color:#555;font-weight:600} .tot{margin-top:14px;font-weight:700}' +
      '@page{margin:14mm}' + (opt.css || '');
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    w.document.write('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>' + esc(opt.title) + '</title><style>' + css + '</style></head><body><h1>' + esc(opt.title) + '</h1>' +
      (opt.subtitle ? '<p class="sub">' + esc(opt.subtitle) + '</p>' : '') + opt.body + '</body></html>');
    w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
    return true;
  }
};
