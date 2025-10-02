// /js/export-docx.js
(function () {
  // ---- Load html-docx-js from multiple sources and accept different globals
  async function ensureHtmlDocx() {
    const urls = [
      'https://cdn.jsdelivr.net/npm/html-docx-js@0.4.1/dist/html-docx.js',
      'https://unpkg.com/html-docx-js@0.4.1/dist/html-docx.js'
    ];
    function getApi() {
      return (window.htmlDocx || window.HTMLDocx) && (window.htmlDocx || window.HTMLDocx);
    }
    if (getApi()) return getApi();

    for (const url of urls) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = url;
          s.async = true;
          s.onload = resolve;
          s.onerror = () => reject(new Error('Failed to load ' + url));
          document.head.appendChild(s);
        });
        if (getApi()) return getApi();
      } catch (e) {
        console.warn(e.message);
      }
    }
    throw new Error('html-docx-js failed to load from all sources');
  }

  // ---- Helpers
  const b64utf8 = (str) => window.btoa(unescape(encodeURIComponent(str)));

  async function svgToPngDataUrl(svg) {
    // Use viewBox if present; otherwise guess
    let w = 600, h = 300;
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; }
    // Serialize and load into an <img>
    const svgStr = new XMLSerializer().serializeToString(svg);
    const dataUrl = 'data:image/svg+xml;base64,' + b64utf8(svgStr);
    const img = new Image();
    const loaded = new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('SVG decode failed'));
    });
    img.src = dataUrl;
    await loaded;
    // Draw to canvas → PNG
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  async function replaceSvgsWithPngs(root) {
    const svgs = Array.from(root.querySelectorAll('svg'));
    for (const svg of svgs) {
      try {
        const pngUrl = await svgToPngDataUrl(svg);
        const img = document.createElement('img');
        img.src = pngUrl;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        svg.replaceWith(img);
      } catch (e) {
        console.warn('Skipping SVG (conversion failed):', e);
        svg.remove(); // avoid export crash
      }
    }
  }

  async function inlineImages(root) {
    const imgs = Array.from(root.querySelectorAll('img'));
    for (const img of imgs) {
      const src = (img.getAttribute('src') || '').trim();
      if (!src || src.startsWith('data:')) continue;
      try {
        const abs = new URL(src, location.href).href;
        const res = await fetch(abs, { mode: 'cors', cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const reader = new FileReader();
        const done = new Promise((ok) => { reader.onload = () => ok(); });
        reader.readAsDataURL(blob);
        await done;
        img.src = reader.result; // data URL
      } catch (e) {
        console.warn('Could not inline image (removed to prevent crash):', src, e);
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

  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  // Fallback: produce Word-compatible .doc (HTML) if docx fails
  function fallbackSaveAsDoc(html, filenameBase) {
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    saveBlob(blob, (filenameBase || 'document') + '.doc');
  }

  // ---- Public API
  window.downloadAsDocx = async function (filename) {
    try {
      // Wait for MathJax (if used)
      if (window.MathJax && MathJax.typesetPromise) {
        try { await MathJax.typesetPromise(); } catch (e) { console.debug('MathJax typeset skipped:', e); }
      }

      const main = document.querySelector('main');
      if (!main) throw new Error('No <main> content to export.');

      // Clone & sanitize
      const clone = main.cloneNode(true);
      clone.querySelectorAll('script').forEach(s => s.remove());

      // Images/SVG handling
      await replaceSvgsWithPngs(clone);
      await inlineImages(clone);

      // Build minimal HTML
      const title = (document.querySelector('h1')?.textContent || document.title || 'statslg').trim();
      const safeBase = title.replace(/[^\w\-]+/g, '_') || 'statslg';
      const name = filename || (safeBase + '.docx');
      const html =
        '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<title>' + title + '</title>' +
        '<style>' + DOC_CSS + '</style>' +
        '</head><body>' + clone.innerHTML + '</body></html>';

      // Try DOCX first
      try {
        const api = await ensureHtmlDocx();
        const blob = api.asBlob(html);
        saveBlob(blob, name);
      } catch (inner) {
        console.error('DOCX build failed — falling back to .doc:', inner);
        fallbackSaveAsDoc(html, safeBase);
      }
    } catch (e) {
      console.error('DOCX export failed:', e);
      alert('Sorry, the DOCX export failed.');
    }
  };
})();
