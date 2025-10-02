// /js/export-docx.js
(function () {
  // Load html-docx-js from CDN on demand
  function ensureHtmlDocx() {
    return new Promise((resolve, reject) => {
      if (window.htmlDocx) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html-docx-js@0.4.1/dist/html-docx.js';
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Convert inline <svg> to <img src="data:image/svg+xml;base64,...">
  async function svgToImgDataUrl(svgNode) {
    const svgStr = new XMLSerializer().serializeToString(svgNode);
    const encoded = window.btoa(unescape(encodeURIComponent(svgStr)));
    return 'data:image/svg+xml;base64,' + encoded;
  }

  async function replaceSvgsWithImages(root) {
    const svgs = Array.from(root.querySelectorAll('svg'));
    for (const svg of svgs) {
      const dataUrl = await svgToImgDataUrl(svg);
      const img = document.createElement('img');
      // keep approximate size
      const vb = (svg.getAttribute('viewBox') || '').split(' ');
      if (vb.length === 4) {
        const w = parseFloat(vb[2]), h = parseFloat(vb[3]);
        if (w && h) {
          img.style.width = '100%';
          img.style.maxWidth = w + 'px';
          img.style.height = 'auto';
        }
      }
      img.src = dataUrl;
      svg.replaceWith(img);
    }
  }

  // Minimal styles embedded into the .docx
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
    img,svg{max-width:100%}
    .btn,.btns{display:none}
  `;

  // Public API
  window.downloadAsDocx = async function (filename) {
    try {
      // Wait for MathJax (if used) so formulas are rendered into the DOM first
      if (window.MathJax && MathJax.typesetPromise) {
        try { await MathJax.typesetPromise(); } catch {}
      }

      const main = document.querySelector('main');
      if (!main) {
        alert('No main content found to export.');
        return;
      }

      // Clone content so we can tweak it for export
      const clone = main.cloneNode(true);

      // Remove any elements you don’t want in the doc (buttons already hidden by CSS)
      clone.querySelectorAll('script').forEach(s => s.remove());

      // Convert inline SVGs (charts) to images so they survive DOCX conversion
      await replaceSvgsWithImages(clone);

      const title = (document.querySelector('h1')?.textContent || document.title || 'statslg').trim();
      const safeTitle = title.replace(/[^\w\-]+/g, '_');
      const name = filename || (safeTitle + '.docx');

      // Build full HTML for html-docx-js
      const html =
        '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<style>' + DOC_CSS + '</style>' +
        '<title>' + title + '</title></head><body>' +
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
      console.error(e);
      alert('Sorry, the DOCX export failed.');
    }
  };
})();
