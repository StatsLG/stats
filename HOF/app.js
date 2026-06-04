let inductees = window.INDUCTEES || [];
let currentFilter = "All";

const cards = document.getElementById("cards");
const legacyTiles = document.getElementById("legacyTiles");
const search = document.getElementById("search");

function loadInductees(){
  if (window.INDUCTEES && window.INDUCTEES.length) {
    inductees = window.INDUCTEES;
    renderCards();
    renderLegacy();
    return;
  }

  fetch("data/inductees.json")
    .then(r => r.json())
    .then(data => {
      inductees = data;
      renderCards();
      renderLegacy();
    })
    .catch(() => {
      cards.innerHTML = `<div class="box">Profile data could not be loaded. Open this site from the extracted folder, not directly inside the ZIP file.</div>`;
    });
}

function matches(person){
  const q = search.value.trim().toLowerCase();
  const haystack = `${person.name} ${person.gradYear || ""} ${person.type} ${person.sport} ${person.inductionYear} ${person.years} ${person.citation}`.toLowerCase();
  let filterOK = currentFilter === "All" || person.type === currentFilter;
  if (currentFilter === "Athlete") filterOK = person.type === "Athlete" || person.type === "Trail Blazer";
  return filterOK && haystack.includes(q);
}

function photoBlock(person){
  if(person.photo){
    return `<div class="card-photo"><img src="${person.photo}" alt="${person.name}"></div>`;
  }
  return `<div class="card-photo">Photo Coming Soon</div>`;
}

function renderCards(){
  const people = inductees.filter(matches);
  cards.innerHTML = people.map((p,i) => `
    <a class="inductee-card profile-link" 
       style="animation-delay:${i*60}ms" 
       href="profile.html?id=${p.id}"
       data-name="${p.name.replace(/"/g, '&quot;')}"
       data-meta="${p.type} · ${p.sport} · Class of ${p.inductionYear}">
      ${photoBlock(p)}
      <span class="pill">${p.type}</span>
      <h3>${p.name}${p.gradYear ? ` <small>'${p.gradYear.slice(-2)}</small>` : ""}</h3>
      <p>${p.sport}</p>
      <p>Class of ${p.inductionYear}</p>
    </a>
  `).join("");
  setupProfileTransitions();
}

function renderLegacy(){
  legacyTiles.innerHTML = inductees.map(p => `
    <a class="legacy-tile" href="profile.html?id=${p.id}">
      <span class="pill">${p.inductionYear}</span>
      <h3>${p.name}</h3>
      <p>${p.type} · ${p.sport}</p>
    </a>
  `).join("");
}


function setupProfileTransitions(){
  document.querySelectorAll(".profile-link").forEach(card => {
    card.addEventListener("click", event => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      event.preventDefault();

      const overlay = document.getElementById("profileTransition");
      const name = document.getElementById("transitionName");
      const meta = document.getElementById("transitionMeta");

      name.textContent = card.dataset.name || "Hall of Fame";
      meta.textContent = card.dataset.meta || "Opening profile";

      document.body.classList.add("profile-launching");
      card.classList.add("launching");

      overlay.classList.remove("active");
      void overlay.offsetWidth;
      overlay.classList.add("active");

      setTimeout(() => {
        window.location.href = card.href;
      }, 900);
    });
  });
}

function enterHall(){
  const doors = document.getElementById("museumDoors");
  const hall = document.getElementById("announcement") || document.getElementById("hall");

  hall.classList.remove("arrived", "arrived-v5");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    hall.scrollIntoView({ behavior: "auto", block: "start" });
    hall.classList.add("arrived-v5");
    return;
  }

  document.body.classList.add("entering-v5");

  doors.classList.remove("active");
  void doors.offsetWidth;
  doors.classList.add("active");

  setTimeout(() => {
    hall.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 1250);

  setTimeout(() => {
    hall.classList.add("arrived-v5");
    document.body.classList.remove("entering-v5");
  }, 1750);

  setTimeout(() => {
    doors.classList.remove("active");
  }, 2700);
}

document.addEventListener("DOMContentLoaded", () => {
  loadInductees();

  document.querySelectorAll(".enter-hall").forEach(button => {
    button.addEventListener("click", enterHall);
  });

  search.addEventListener("input", renderCards);

  document.querySelectorAll(".filters button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filters button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderCards();
    });
  });
});
