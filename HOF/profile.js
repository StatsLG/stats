const params = new URLSearchParams(window.location.search);
const id = params.get("id");

function getData(){
  if (window.INDUCTEES && window.INDUCTEES.length) {
    return Promise.resolve(window.INDUCTEES);
  }
  return fetch("data/inductees.json").then(r => r.json());
}

getData()
  .then(data => {
    const person = data.find(p => p.id === id) || data[0];
    document.title = `${person.name} | Hall of Fame`;
    renderProfile(person);
  })
  .catch(() => {
    document.getElementById("profileRoot").innerHTML = `<section class="box"><h1>Profile data could not load</h1><p>Open this site from the extracted folder, not directly inside the ZIP file.</p></section>`;
  });

function statCards(p){
  return (p.stats || []).map((s, index) => `
    <div class="stat featured-stat" style="animation-delay:${index * 90}ms">
      <strong>${s.value}</strong>
      <span>${s.label}</span>
      ${s.detail ? `<small>${s.detail}</small>` : ""}
    </div>
  `).join("");
}

function renderProfile(p){
  const root = document.getElementById("profileRoot");
  const image = p.photo
    ? `<img src="${p.photo}" alt="${p.name}">`
    : `<div class="hof-placeholder"><span class="placeholder-mark">GC</span><strong>Hall of Fame Portrait</strong><br><span>Archival photo coming soon</span></div>`;

  const highlights = (p.highlights || []).map(h => `<li>${h}</li>`).join("");
  const sourceLink = p.sourceUrl ? `<p><a class="button ghost" href="${p.sourceUrl}" target="_blank" rel="noopener">Open Official Release</a></p>` : "";

  const profileTypeClass = `profile-${(p.type || "athlete").toLowerCase().replaceAll(" ", "-")}`;

  root.innerHTML = `
    <section class="profile-hero ${profileTypeClass}">
      <div class="profile-image">${image}</div>
      <div class="profile-title">
        <p class="eyebrow">Class of ${p.inductionYear}</p>
        <h1>${p.name}${p.gradYear ? ` <span class="grad-year">'${p.gradYear.slice(-2)}</span>` : ""}</h1>
        <p class="tagline">${p.headline}</p>
        <p><span class="pill">${p.type}</span> <span class="pill">${p.sport}</span></p>
        ${sourceLink}
        <p><a class="button primary back-button" href="index.html#hall">Return to the Hall</a></p>
      </div>
    </section>

    <section class="profile-stats-row">
      ${statCards(p)}
    </section>

    <section class="profile-sections">
      <div class="box citation-box">
        <h2>Hall of Fame Citation</h2>
        <p>${p.citation}</p>

        <h2>Career Highlights</h2>
        <ul>${highlights}</ul>

        ${p.type === "Team" ? `
          <h2>Team Page Additions Coming Later</h2>
          <p>This page is ready for roster, match results, tournament bracket details, and team photos.</p>
        ` : ""}

        ${p.type === "Coach" ? `
          <h2>Coaching Legacy</h2>
          <p>This coach profile is ready for staff history, season-by-season records, championship teams, and offensive/defensive records.</p>
        ` : ""}

        ${p.type === "Trail Blazer" ? `
          <h2>Beyond Athletics</h2>
          <p>This Trail Blazer profile is ready for leadership, service, career, and community legacy sections.</p>
        ` : ""}

        <h2>Gallery</h2>
        <div class="gallery-placeholder">
          <div>Photo</div><div>Photo</div><div>Photo</div>
        </div>
      </div>

      <aside class="box">
        <h2>Profile Details</h2>
        <p><strong>Category:</strong> ${p.type}</p>
        <p><strong>Sport:</strong> ${p.sport}</p>
        <p><strong>Years:</strong> ${p.years}</p>
        <p><strong>Induction Class:</strong> ${p.inductionYear}</p>

        <h2>Videos</h2>
        <p>${p.videos.length ? "Video embeds will appear here." : "Highlight videos and archival footage will be added."}</p>
      </aside>
    </section>
  `;
}
