// /js/export-docx.js
(function () {
  // Load html-docx-js when needed
  function ensureHtmlDocx() {
    return new Promise((resolve, reject) => {
      if (window.htmlDocx) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html-docx-js@0.4.1/dist/html-docx.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load html-docx-js'));
      document.head.appendChild(s);
    });
  }

  // --- Helpers -------------------------------------------------------------

  // Safe base64 for UTF-8 strings
  function b64utf8(str) {
    return window.btoa(unescape(encodeURIComponent(str)));
  }

  // Convert an <svg> node into a PNG data URL (via <canvas>)
  async function svgToPngDataUrl(svg) {
    // Get dimensions from viewBox or fallback
    let w = 600, h = 300;
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; }

    const svgStr = new XMLSerializer().serializeToString(svg);
    const dataUrl = 'data:image/svg+xml;base64,' + b64utf8(svgStr);

    const img = new Image();
    // no crossOrigin needed for data URL
    const loaded = new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('SVG decode failed'));
    });
    img.src = dataUrl;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // white background to avoid transparent artifacts in Word
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/png');
  }

  // Replace all <svg> with <img src="data:image/png;base64,...">
  async function replaceSvgsWithPngs(root) {
    const svgs = Array.from(root.querySelectorAll('svg'));
    for (const svg of svgs) {
      try {
        const pngUrl = await svgToPngDataUrl(svg);
        const img = document.createElement('img');
        img.src = pngUrl;
        // Make it scale well in Word
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        svg.replaceWith(img);
      } catch (e) {
        console.warn('Skipping one SVG (failed to convert to PNG):', e);
        svg.remove(); // avoid crashing export
      }
    }
  }

  // Inline <img> elements as data URLs to avoid CORS fetches during Docx build
  async function inlineImages(root) {
    const imgs = Array.from(root.querySelectorAll('img'));
    for (const img of imgs) {
      const src = (img.getAttribute('src') || '').trim();
      if (!src || src.startsWith('data:')) continue;

      try {
        // Absolute URL relative to document for fetch
        const url = new URL(src, location.href).href;
        const res = await fetch(url, { mode: 'cors', cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const reader = new FileReader();
        const done = new Promise((res2) => { reader.onload = () => res2(); });
        reader.readAsDataURL(blob);
        await done;
        img.src = reader.result; // set data URL
      } catch (e) {
        console.warn('Could not inline image (will skip to prevent crash):', src, e);
        img.remove();
      }
    }
  }

  // Minimal DOCX CSS
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

  // --- Public API ----------------------------------------------------------
  window.downloadAsDocx = async function (filename) {
    try {
      // Wait for MathJax (if used) to finish typesetting
      if (window.MathJax && MathJax.typesetPromise) {
        try { await MathJax.typesetPromise(); } catch (e) { console.debug('MathJax typeset skipped:', e); }
      }

      const main = document.querySelector('main');
      if (!main) throw new Error('No <main> content to export.');

      // Work on a clone to avoid mutating the live page
      const clone = main.cloneNode(true);
      clone.querySelectorAll('script').forEach(s => s.remove());

      // Convert SVG charts → PNG images
      await replaceSvgsWithPngs(clone);

      // Inline <img> resources to data URLs (best effort); skip on failure
      await inlineImages(clone);

      // Build HTML for html-docx-js
      const title = (document.querySelector('h1')?.textContent || document.title || 'statslg').trim();
      const safeTitle = title.replace(/[^\w\-]+/g, '_');
      const name = filename || (safeTitle + '.docx');

      const html =
        '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<title>' + title + '</title>' +
        '<style>' + DOC_CSS + '</style>' +
        '</head><body>' +
        clone.innerHTML +
        '</body></html>';

      await ensureHtmlDocx();
      const blob = window.htmlDocx.asBlob(html);

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    } catch (e) {
      console.error('DOCX export failed:', e);
      alert('Sorry, the DOCX export failed.');
    }
  };
})();
