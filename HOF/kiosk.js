let data = window.INDUCTEES || [];
let index = 0;

function start(){
  if (data.length) {
    show();
    setInterval(() => {
      index = (index + 1) % data.length;
      show();
    }, 6500);
    return;
  }

  fetch("data/inductees.json")
    .then(r => r.json())
    .then(d => {
      data = d;
      show();
      setInterval(() => {
        index = (index + 1) % data.length;
        show();
      }, 6500);
    });
}

function show(){
  const p = data[index];
  document.getElementById("kioskName").textContent = p.name;
  document.getElementById("kioskMeta").textContent = `${p.type} · ${p.sport} · Class of ${p.inductionYear}`;
  document.getElementById("kioskHighlights").innerHTML = (p.highlights || []).slice(0,3).map(h => `<p>${h}</p>`).join("");
}

document.addEventListener("DOMContentLoaded", start);
