// Georgetown College CC & T&F History (static GitHub Pages version)

let ALL = [];
let META = null;

const els = {
  lastUpdated: document.getElementById("lastUpdated"),
  rowCount: document.getElementById("rowCount"),
  loadState: document.getElementById("loadState"),
  sex: document.getElementById("sex"),
  season: document.getElementById("season"),
  event: document.getElementById("event"),
  search: document.getElementById("search"),
  bestOnly: document.getElementById("bestOnly"),
  exportBtn: document.getElementById("exportBtn"),
  tbody: document.getElementById("tbody"),
  resultCount: document.getElementById("resultCount"),
  filterSummary: document.getElementById("filterSummary"),
  sortHint: document.getElementById("sortHint"),
};

const FIELD_HINTS = [
  "Long Jump","Triple Jump","High Jump","Pole Vault",
  "Shot Put","Discus","Hammer","Javelin","Weight Throw",
  "Pentathlon","Heptathlon","Decathlon"
];

const BAD_MARKS = new Set(["DQ","DNS","DNF","NH","FOUL","NO MARK","NM","NT"]);

// --- Indoor school record progression tagging ---
// For Indoor only: walk earliest -> latest per (sex,event), flag rows that were a school record at that time.
// Mark as:
//   "FSR" = former school record (record at the time, later broken)
//   "SR"  = current school record (latest/best overall)
//
// Note: requires a usable meet_date. If meet_date is missing/unparseable, row won't be considered for SR/FSR tagging.
let INDOOR_RECORD_STATUS = new Map(); // key -> "FSR" | "SR"

function rowKey(r){
  // best-effort stable key across exports
  return [
    r.athlete_url || "",
    r.athlete_name || "",
    r.season_type || "",
    r.event_name || "",
    r.meet_name || "",
    r.meet_date || "",
    r.mark || "",
    r.mark_extra || "",
    r.wind || ""
  ].join("||");
}

function parseMeetDateToTs(s){
  if(!s) return null;
  const str = String(s).trim();
  if(!str) return null;

  // Common TFRRS examples:
  //   "Feb 17, 2026"
  //   "Feb 6-7, 2026"
  //   "Feb 6- 7, 2026"
  //   "Feb 6 - 7, 2026"
  //   "Feb 6–7, 2026"  (en dash)
  // We treat ranges as the first day.
  const m = str.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:\s*[-–]\s*\d{1,2})?,\s*(\d{4})$/);
  if(m){
    const month = m[1];
    const day = m[2];
    const year = m[3];
    const d = new Date(`${month} ${day}, ${year}`);
    const ts = d.getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  // Fallback: try native parse
  const d = new Date(str);
  const ts = d.getTime();
  return Number.isFinite(ts) ? ts : null;
}

function computeIndoorRecordStatus(){
  INDOOR_RECORD_STATUS = new Map();

  // group by sex + event
  const groups = new Map(); // "m||event" -> rows
  for(const r of ALL){
    if(r.season_type !== "Indoor") continue;
    if(!r.event_name) continue;
    const ts = parseMeetDateToTs(r.meet_date);
    if(ts === null) continue;

    const bv = bestValueForRow(r);
    if(bv.value === null) continue;

    const key = `${r.sex || ""}||${r.event_name}`;
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ r, ts, bv });
  }

  for(const [gkey, arr] of groups.entries()){
    if(arr.length === 0) continue;

    // Sort earliest -> latest; within same date, put "better" first
    arr.sort((a,b) => {
      if(a.ts !== b.ts) return a.ts - b.ts;
      if(a.bv.direction === "min") return a.bv.value - b.bv.value;
      return b.bv.value - a.bv.value;
    });

    let current = null; // {value, direction}
    const recordHolders = []; // in chronological order of new records

    for(const item of arr){
      if(!current){
        current = { value: item.bv.value, direction: item.bv.direction };
        recordHolders.push(item.r);
        continue;
      }
      if(current.direction === "min"){
        if(item.bv.value < current.value){
          current.value = item.bv.value;
          recordHolders.push(item.r);
        }
      } else {
        if(item.bv.value > current.value){
          current.value = item.bv.value;
          recordHolders.push(item.r);
        }
      }
    }

    if(recordHolders.length === 0) continue;

    // last is current SR, earlier are FSR
    for(let i=0; i<recordHolders.length; i++){
      const rr = recordHolders[i];
      const k = rowKey(rr);
      INDOOR_RECORD_STATUS.set(k, (i === recordHolders.length - 1) ? "SR" : "FSR");
    }
  }
}

function isFieldEvent(eventName){
  if(!eventName) return false;
  const e = eventName.toLowerCase();
  return FIELD_HINTS.some(h => e.includes(h.toLowerCase()));
}

function parseTimeSeconds(mark){
  if(!mark) return null;
  const m = String(mark).trim();
  if(!m) return null;
  if(BAD_MARKS.has(m.toUpperCase())) return null;

  if(m.includes(":")){
    const parts = m.split(":").map(p => Number(p));
    if(parts.some(x => Number.isNaN(x))) return null;
    if(parts.length === 2) return parts[0]*60 + parts[1];
    if(parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
    return null;
  }

  const v = Number(m);
  return Number.isFinite(v) ? v : null;
}

function parseDistanceMeters(mark, markExtra){
  const m = mark ? String(mark).trim() : "";
  if(m){
    if(BAD_MARKS.has(m.toUpperCase())) return null;
    const mm = m.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*m\s*$/i);
    if(mm){
      const v = Number(mm[1]);
      return Number.isFinite(v) ? v : null;
    }
    // Sometimes stored as numeric
    if(!m.includes(":")){
      const v = Number(m);
      if(Number.isFinite(v) && v >= 0.1 && v <= 150) return v;
    }
  }

  const ex = markExtra ? String(markExtra) : "";
  const mi = ex.match(/(\d+)\s*'\s*([0-9]+(?:\.[0-9]+)?)\s*"/);
  if(mi){
    const ft = Number(mi[1]);
    const inch = Number(mi[2]);
    if(Number.isFinite(ft) && Number.isFinite(inch)){
      return ft*0.3048 + inch*0.0254;
    }
  }
  return null;
}

function bestValueForRow(row){
  const season = (row.season_type || "").toLowerCase();
  const eventName = row.event_name || "";
  const mark = row.mark || "";
  const extra = row.mark_extra || "";

  if(season === "cross country"){
    const v = parseTimeSeconds(mark);
    return { value: v, direction: "min" };
  }

  if(isFieldEvent(eventName)){
    const v = parseDistanceMeters(mark, extra);
    return { value: v, direction: "max" };
  }

  const v = parseTimeSeconds(mark);
  return { value: v, direction: "min" };
}

function normalizeWind(w){
  if(!w) return "";
  const s = String(w).trim();
  return s;
}

function buildEventOptions(){
  const sex = els.sex.value;
  const season = els.season.value;

  const events = new Set();
  for(const r of ALL){
    if(r.sex === sex && r.season_type === season && r.event_name){
      events.add(r.event_name);
    }
  }

  const sorted = Array.from(events).sort((a,b) => a.localeCompare(b));
  const current = els.event.value;

  els.event.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "All events";
  els.event.appendChild(optAll);

  for(const e of sorted){
    const opt = document.createElement("option");
    opt.value = e;
    opt.textContent = e;
    els.event.appendChild(opt);
  }

  // Try to keep selection if still valid
  if(current && events.has(current)){
    els.event.value = current;
  } else {
    els.event.value = "";
  }
}

function filterRows(){
  const sex = els.sex.value;
  const season = els.season.value;
  const event = els.event.value;
  const q = els.search.value.trim().toLowerCase();
  const bestOnly = els.bestOnly.checked;

  let rows = ALL.filter(r =>
    r.sex === sex &&
    r.season_type === season &&
    (!event || r.event_name === event)
  );

  if(q){
    rows = rows.filter(r => (r.athlete_name || "").toLowerCase().includes(q));
  }

  // Default: keep best mark per athlete (or per athlete+event when "All events")
  if(bestOnly){
    const map = new Map();
    for(const r of rows){
      const key = event ? r.athlete_url : (r.athlete_url + "||" + (r.event_name || ""));
      const bv = bestValueForRow(r);
      if(bv.value === null) continue;

      if(!map.has(key)){
        map.set(key, { row: r, bv });
      } else {
        const cur = map.get(key);
        if(cur.bv.direction === "min"){
          if(bv.value < cur.bv.value) map.set(key, { row: r, bv });
        } else {
          if(bv.value > cur.bv.value) map.set(key, { row: r, bv });
        }
      }
    }
    rows = Array.from(map.values()).map(x => x.row);
  }

  // Sorting
  let sortHint = "";
  if(event){
    // Sort by best mark for the chosen event
    rows.sort((a,b) => {
      const av = bestValueForRow(a);
      const bv = bestValueForRow(b);
      const aOk = av.value !== null;
      const bOk = bv.value !== null;
      if(aOk && bOk){
        if(av.direction === "min") return av.value - bv.value;
        return bv.value - av.value;
      }
      if(aOk) return -1;
      if(bOk) return 1;
      return (a.athlete_name||"").localeCompare(b.athlete_name||"");
    });
    sortHint = isFieldEvent(event) ? "Sorted: farthest first" : "Sorted: fastest first";
  } else {
    // Group by event then best within event
    rows.sort((a,b) => {
      const ea = a.event_name || "";
      const eb = b.event_name || "";
      const c = ea.localeCompare(eb);
      if(c !== 0) return c;

      const av = bestValueForRow(a);
      const bv = bestValueForRow(b);
      const aOk = av.value !== null;
      const bOk = bv.value !== null;
      if(aOk && bOk){
        if(av.direction === "min") return av.value - bv.value;
        return bv.value - av.value;
      }
      if(aOk) return -1;
      if(bOk) return 1;
      return (a.athlete_name||"").localeCompare(b.athlete_name||"");
    });
    sortHint = "Sorted: event, then best mark";
  }

  els.sortHint.textContent = sortHint;

  const summary = [
    sex === "m" ? "Male" : "Female",
    season === "Cross Country" ? "XC" : season,
    event ? event : "All events",
    bestOnly ? "Best marks" : "All marks",
    q ? `Search: “${q}”` : null
  ].filter(Boolean).join(" • ");

  els.filterSummary.textContent = summary;

  return rows;
}

function renderRecordBadge(r){
  if(r.season_type !== "Indoor") return "<span class='muted'>—</span>";
  const status = INDOOR_RECORD_STATUS.get(rowKey(r));
  if(!status) return "<span class='muted'>—</span>";
  return `<span class="badge">${status}</span>`;
}

function render(rows){
  els.resultCount.textContent = `${rows.length} result${rows.length === 1 ? "" : "s"}`;

  if(rows.length === 0){
    els.tbody.innerHTML = `<tr><td colspan="7" class="muted">No results for the current filters.</td></tr>`;
    return;
  }

  const html = rows.map(r => {
    const athlete = escapeHtml(r.athlete_name || "Unknown");
    const url = r.athlete_url || "";
    const mark = escapeHtml(r.mark || "");
    const wind = escapeHtml(normalizeWind(r.wind || ""));
    const meet = escapeHtml(r.meet_name || "");
    const date = escapeHtml(r.meet_date || "");
    const event = escapeHtml(r.event_name || "");

    const athleteCell = url
      ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${athlete}</a>`
      : athlete;

    const meetCell = meet ? `<div>${meet}</div>` : `<span class="muted">—</span>`;

    return `<tr>
      <td>${athleteCell}</td>
      <td><b>${mark || "—"}</b>${r.mark_extra ? `<div class="small">${escapeHtml(r.mark_extra)}</div>` : ""}</td>
      <td>${wind || "<span class='muted'>—</span>"}</td>
      <td>${renderRecordBadge(r)}</td>
      <td>${meetCell}</td>
      <td>${date || "<span class='muted'>—</span>"}</td>
      <td>${event || "<span class='muted'>—</span>"}</td>
    </tr>`;
  }).join("");

  els.tbody.innerHTML = html;
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}
function escapeAttr(s){ return escapeHtml(s); }

function toCsvValue(v){
  const s = v == null ? "" : String(v);
  if(/[",\n]/.test(s)){
    return `"${s.replaceAll('"','""')}"`;
  }
  return s;
}

function exportCsv(rows){
  const cols = ["athlete_name","sex","season_type","event_name","mark","mark_extra","wind","record_status","meet_name","meet_date","athlete_url"];
  const lines = [];
  lines.push(cols.join(","));
  for(const r0 of rows){
    const r = { ...r0, record_status: (r0.season_type === "Indoor" ? (INDOOR_RECORD_STATUS.get(rowKey(r0)) || "") : "") };
    const line = cols.map(c => toCsvValue(r[c])).join(",");
    lines.push(line);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0,19).replaceAll(":","-");
  a.href = url;
  a.download = `georgetown_tfrrs_export_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function refresh(){
  buildEventOptions();
  const rows = filterRows();
  render(rows);
  return rows;
}

async function init(){
  try{
    els.loadState.textContent = "Loading meta…";
    const metaRes = await fetch("./data/meta.json", { cache: "no-store" });
    META = await metaRes.json();
    els.lastUpdated.textContent = `Last updated: ${META.last_updated || "—"}`;
    els.rowCount.textContent = `Rows: ${META.rows ?? "—"}`;

    els.loadState.textContent = "Loading performances…";
    const perfRes = await fetch("./data/performances.json", { cache: "no-store" });
    ALL = await perfRes.json();

    // Precompute indoor school record progression tags
    computeIndoorRecordStatus();

    els.loadState.textContent = "Ready";
    buildEventOptions();
    refresh();

    // listeners
    els.sex.addEventListener("change", () => { buildEventOptions(); refresh(); });
    els.season.addEventListener("change", () => { buildEventOptions(); refresh(); });
    els.event.addEventListener("change", refresh);
    els.bestOnly.addEventListener("change", refresh);
    els.search.addEventListener("input", () => {
      // small debounce
      clearTimeout(window.__searchT);
      window.__searchT = setTimeout(refresh, 120);
    });

    els.exportBtn.addEventListener("click", () => {
      const rows = filterRows(); // export current filtered view (already sorted)
      exportCsv(rows);
    });

  } catch(err){
    console.error(err);
    els.loadState.textContent = "Error loading data";
    els.tbody.innerHTML = `<tr><td colspan="7" class="muted">Error: could not load JSON files. Make sure you are viewing via GitHub Pages (not opening index.html directly from disk), and that docs/data/*.json exists.</td></tr>`;
  }
}

init();
