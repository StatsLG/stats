// /js/export-docx.js
(function () {
  // ---------- tiny toast ----------
  function toast(msg, ok=true){
    try{
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = `
        position:fixed;left:50%;bottom:18px;transform:translateX(-50%);
        background:${ok?'#064e3b':'#7f1d1d'};color:#fff;padding:8px 12px;border-radius:8px;
        font:600 13px/1.2 system-ui,Segoe UI,Roboto,Arial,sans-serif;z-index:99999;opacity:.98
      `;
      document.body.appendChild(t);
      setTimeout(()=>t.remove(), 2600);
    }catch{}
  }

  // ---------- load html-docx-js (multiple CDNs/globals) ----------
  async function ensureHtmlDocx() {
    const urls = [
      'https://cdn.jsdelivr.net/npm/html-docx-js@0.4.1/dist/html-docx.js',
      'https://unpkg.com/html-docx-js@0.4.1/dist/html-docx.js'
    ];
    const getApi = () => (window.htmlDocx || window.HTMLDocx) || null;
    if (getApi()) return getApi();

    for (const url of urls) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = url; s.async = true; s.onload = resolve; s.onerror = resolve;
        document.head.appendChild(s);
      });
      if (getApi()) return getApi();
    }
    return null; // will trigger .doc fallback
  }

  // ---------- helpers ----------
  const b64utf8 = (s) => window.btoa(unescape(encodeURIComponent(s)));

  async function svgToPngDataUrl(svg) {
    let w = 600, h = 300;
    const vb = (svg.getAttribute('viewBox')||'').split(/\s+/).map(Number);
    if (vb.length===4 && vb[2]>0 && vb[3]>0){ w = vb[2]; h = vb[3]; }
    const svgStr = new XMLSerializer().serializeToString(svg);
    const dataUrl = 'data:image/svg+xml;base64,' + b64utf8(svgStr);

    const img = new Image();
    await new Promise((res, rej)=>{ img.onload=res; img.onerror=()=>rej(new Error('SVG decode failed')); img.src=dataUrl; });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  async function replaceSvgsWithPngs(root){
    const svgs = Array.from(root.querySelectorAll('svg'));
    for (const svg of svgs){
      try{
        const png = await svgToPngDataUrl(svg);
        const img = document.createElement('img');
        img.src = png; img.style.maxWidth='100%'; img.style.height='auto';
        svg.replaceWith(img);
      }catch(e){
        console.warn('SVG→PNG failed, removing one SVG:', e);
        svg.remove();
      }
    }
  }

  async function inlineImages(root){
    const imgs = Array.from(root.querySelectorAll('img'));
    for (const img of imgs){
      const src = (img.getAttribute('src')||'').trim();
      if (!src || src.startsWith('data:')) continue;
      try{
        const res = await fetch(new URL(src, location.href).href, {mode:'cors', cache:'no-cache'});
        if (!res.ok) throw new Error('HTTP '+res.status);
        const blob = await res.blob();
        const reader = new FileReader();
        const done = new Promise(r=>{ reader.onload = ()=>r(); });
        reader.readAsDataURL(blob); await done;
        img.src = reader.result;
      }catch(e){
        console.warn('Could not inline img, removing to avoid crash:', src, e);
        img.remove();
      }
    }
  }

  const DOC_CSS = `
    body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#111}
    h1{font-size:22pt;margin:0 0 .2in}
    h2{font-size:16pt;margin:.2in 0 .06in}
    h3{font-size:13pt;margin:.16in 0 .04in}
    p,li{line-height:1.35}
    table{border-collapse:collapse;width:100%;margin:.08in 0}
    th,td{border:1px solid #ccc;padding:6px 8px}
    th{background:#00467f;color:#fff}
    .muted{color:#555}
    .card,.panel{border:1px solid #ddd;border-radius:6px;padding:10px;margin:.06in 0}
    img{max-width:100%;height:auto}
    .btn,.btns{display:none}
  `;

  function saveBlob(blob, name){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  function buildHtmlFrom(mainEl){
    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<style>'+DOC_CSS+'</style></head><body>'+ mainEl.innerHTML + '</body></html>';
  }

  function fallbackDoc(html, base){
    const blob = new Blob(['\ufeff', html], {type:'application/msword'});
    saveBlob(blob, (base||'document') + '.doc');
    toast('Exported as .DOC (fallback)', true);
  }

  // ---------- public API ----------
  window.downloadAsDocx = async function(filename){
    try{
      // 1) Wait for MathJax if present
      if (window.MathJax && MathJax.typesetPromise){
        try{ await MathJax.typesetPromise(); }catch(e){ console.debug('MathJax skipped', e); }
      }

      // 2) Grab and clone main
      const main = document.querySelector('main');
      if (!main){ throw new Error('No <main> found'); }
      const clone = main.cloneNode(true);
      clone.querySelectorAll('script').forEach(s=>s.remove());

      // 3) Make content Word-friendly
      await replaceSvgsWithPngs(clone);
      await inlineImages(clone);

      // 4) Build HTML once
      const title = (document.querySelector('h1')?.textContent || document.title || 'statslg').trim();
      const base = title.replace(/[^\w\-]+/g,'_') || 'statslg';
      const html = buildHtmlFrom(clone);

      // 5) Try DOCX; if not possible, auto-fallback to .DOC
      const api = await ensureHtmlDocx();
      if (api && typeof api.asBlob === 'function'){
        try{
          const blob = api.asBlob(html);
          saveBlob(blob, filename || (base+'.docx'));
          toast('Exported as .DOCX', true);
          return;
        }catch(e){
          console.error('DOCX build failed, falling back to .DOC:', e);
        }
      }else{
        console.warn('html-docx-js unavailable; using .DOC fallback');
      }

      // Fallback
      fallbackDoc(html, base);
    }catch(err){
      console.error('Export failed before build — using minimal fallback:', err);
      // last-ditch: try exporting current DOM main without conversions
      try{
        const main = document.querySelector('main');
        if (main){
          const title = (document.querySelector('h1')?.textContent || document.title || 'statslg').trim();
          const base = title.replace(/[^\w\-]+/g,'_') || 'statslg';
          fallbackDoc(buildHtmlFrom(main), base);
          return;
        }
      }catch(e){}
      toast('Export could not run on this page.', false);
    }
  };
})();
