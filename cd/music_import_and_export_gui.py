import os
import sqlite3
import threading
import json
from datetime import datetime
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from mutagen import File as MutagenFile

AUDIO_EXTS = {".mp3", ".flac", ".m4a", ".mp4", ".ogg", ".opus", ".wav", ".aiff", ".aif"}


# ---------- helpers ----------
def norm_tag(v):
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        return str(v[0]) if v else None
    return str(v)


def parse_int_tag(v):
    v = norm_tag(v)
    if not v:
        return None
    part = v.split("/")[0].strip()
    return int(part) if part.isdigit() else None


def safe_filename(s: str) -> str:
    keep = []
    for ch in s:
        if ch.isalnum() or ch in ("-", "_"):
            keep.append(ch)
        elif ch in (" ", ".", "/","\\"):
            keep.append("_")
    out = "".join(keep).strip("_")
    return out[:120] if out else "unknown"


def ms_to_str(ms):
    if ms is None:
        return ""
    try:
        ms = int(ms)
    except Exception:
        return ""
    sec = ms // 1000
    m = sec // 60
    s = sec % 60
    return f"{m}:{s:02d}"


def get_tags_easy(path: str) -> dict:
    audio = MutagenFile(path, easy=True)
    if not audio or not getattr(audio, "tags", None):
        return {}

    tags = audio.tags
    title = norm_tag(tags.get("title"))
    artist = norm_tag(tags.get("artist"))
    album = norm_tag(tags.get("album"))
    albumartist = norm_tag(tags.get("albumartist") or tags.get("album artist"))
    date = norm_tag(tags.get("date") or tags.get("year"))
    trackno = parse_int_tag(tags.get("tracknumber"))
    discno = parse_int_tag(tags.get("discnumber"))

    length_seconds = None
    try:
        if getattr(audio, "info", None) and getattr(audio.info, "length", None):
            length_seconds = float(audio.info.length)
    except Exception:
        length_seconds = None

    return {
        "title": title,
        "artist": artist,
        "album": album,
        "albumartist": albumartist,
        "date": date,
        "tracknumber": trackno,
        "discnumber": discno,
        "length_seconds": length_seconds,
    }


def extract_embedded_cover_bytes(audio_path: str) -> bytes | None:
    try:
        audio = MutagenFile(audio_path)
        if not audio:
            return None

        # MP3 ID3 APIC
        if hasattr(audio, "tags") and audio.tags:
            try:
                apics = list(audio.tags.getall("APIC"))
                if apics:
                    return apics[0].data
            except Exception:
                pass

        # MP4/M4A 'covr'
        try:
            covr = getattr(getattr(audio, "tags", None), "get", lambda _k: None)("covr")
            if covr:
                return bytes(covr[0])
        except Exception:
            pass

        # FLAC pictures
        pics = getattr(audio, "pictures", None)
        if pics:
            try:
                return pics[0].data
            except Exception:
                pass

    except Exception:
        return None

    return None


# ---------- db schema / migrations ----------
def ensure_column(conn: sqlite3.Connection, table: str, col: str, coltype: str):
    cur = conn.cursor()
    cols = [r[1] for r in cur.execute(f"PRAGMA table_info({table})").fetchall()]
    if col not in cols:
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {coltype}")
        conn.commit()


def init_cd_catalog_schema(db_path: str):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS albums (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode TEXT UNIQUE,
            title TEXT,
            artist TEXT,
            release_date TEXT,
            country TEXT,
            label TEXT,
            catalog_number TEXT,
            musicbrainz_release_id TEXT,
            created_at TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            album_id INTEGER NOT NULL,
            position INTEGER,
            title TEXT,
            length_ms INTEGER,
            FOREIGN KEY(album_id) REFERENCES albums(id)
        )
    """)
    conn.commit()

    ensure_column(conn, "albums", "cover_path", "TEXT")   # e.g. covers/abc.jpg
    ensure_column(conn, "albums", "source", "TEXT")       # 'cd' or 'folder'
    ensure_column(conn, "albums", "source_id", "TEXT")    # folder path
    ensure_column(conn, "tracks", "source_path", "TEXT")  # full file path

    conn.close()


def get_album_id_by_source(conn: sqlite3.Connection, source: str, source_id: str) -> int | None:
    cur = conn.cursor()
    cur.execute("SELECT id FROM albums WHERE source=? AND source_id=? LIMIT 1", (source, source_id))
    row = cur.fetchone()
    return row[0] if row else None


def upsert_folder_album(conn: sqlite3.Connection,
                        folder_path: str,
                        album_title: str,
                        album_artist: str,
                        year: str,
                        cover_rel: str | None) -> int:
    existing_id = get_album_id_by_source(conn, "folder", folder_path)
    cur = conn.cursor()

    if existing_id is None:
        cur.execute("""
            INSERT INTO albums
            (barcode, title, artist, release_date, country, label, catalog_number,
             musicbrainz_release_id, cover_path, source, source_id, created_at)
            VALUES (NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, 'folder', ?, ?)
        """, (
            album_title,
            album_artist,
            year,
            cover_rel,
            folder_path,
            datetime.now().isoformat(timespec="seconds")
        ))
        conn.commit()
        return cur.lastrowid

    cur.execute("""
        UPDATE albums SET
          title=?,
          artist=?,
          release_date=?,
          cover_path=COALESCE(?, cover_path)
        WHERE id=?
    """, (album_title, album_artist, year, cover_rel, existing_id))
    conn.commit()
    return existing_id


def replace_tracks_for_album(conn: sqlite3.Connection, album_id: int, tracks: list[dict]):
    cur = conn.cursor()
    cur.execute("DELETE FROM tracks WHERE album_id=?", (album_id,))
    for t in tracks:
        cur.execute("""
            INSERT INTO tracks (album_id, position, title, length_ms, source_path)
            VALUES (?, ?, ?, ?, ?)
        """, (album_id, t.get("position"), t.get("title"), t.get("length_ms"), t.get("source_path")))
    conn.commit()


def clear_folder_imports(conn: sqlite3.Connection):
    cur = conn.cursor()
    cur.execute("SELECT id FROM albums WHERE source='folder'")
    ids = [r[0] for r in cur.fetchall()]
    for aid in ids:
        cur.execute("DELETE FROM tracks WHERE album_id=?", (aid,))
    cur.execute("DELETE FROM albums WHERE source='folder'")
    conn.commit()
    return len(ids)


# ---------- import scan ----------
def scan_music_folder_into_cd_catalog(root_folder: str,
                                     db_path: str,
                                     site_dir: str | None,
                                     clear_first: bool,
                                     extract_covers: bool,
                                     progress_cb,
                                     log_cb,
                                     stop_flag_fn):
    init_cd_catalog_schema(db_path)

    conn = sqlite3.connect(db_path)
    try:
        if clear_first:
            n = clear_folder_imports(conn)
            log_cb(f"Cleared {n} previously imported folder albums.")

        audio_files = []
        for dirpath, _, filenames in os.walk(root_folder):
            for fn in filenames:
                if os.path.splitext(fn)[1].lower() in AUDIO_EXTS:
                    audio_files.append(os.path.join(dirpath, fn))

        total = len(audio_files)
        log_cb(f"Found {total} audio files.")
        progress_cb(0, 0, 0, "Scanning…")

        folder_tracks = {}
        folder_meta = {}
        folder_first_audio = {}

        for i, full_path in enumerate(audio_files, start=1):
            if stop_flag_fn():
                log_cb("Stopped by user.")
                break

            dirpath = os.path.dirname(full_path)
            filename = os.path.basename(full_path)

            tags = get_tags_easy(full_path)
            album_title = tags.get("album") or os.path.basename(dirpath)
            album_artist = tags.get("albumartist") or tags.get("artist") or ""
            year = (tags.get("date") or "")[:4] if tags.get("date") else ""

            track_title = tags.get("title") or os.path.splitext(filename)[0]
            track_no = tags.get("tracknumber")
            length_seconds = tags.get("length_seconds")
            length_ms = int(length_seconds * 1000) if isinstance(length_seconds, (int, float)) else None

            folder_tracks.setdefault(dirpath, []).append({
                "position": track_no,
                "title": track_title,
                "length_ms": length_ms,
                "source_path": full_path
            })

            if dirpath not in folder_meta:
                folder_meta[dirpath] = (album_title, album_artist, year)
                folder_first_audio[dirpath] = full_path

            if i % 100 == 0 or i == total:
                progress_cb(i, i, len(folder_meta), f"Scanning… {i}/{total}")

        albums_written = 0
        tracks_written = 0

        covers_dir = None
        if extract_covers and site_dir:
            covers_dir = os.path.join(site_dir, "covers")

        for folder_path, tracks in folder_tracks.items():
            if stop_flag_fn():
                break

            album_title, album_artist, year = folder_meta.get(folder_path, (os.path.basename(folder_path), "", ""))

            cover_rel = None
            if extract_covers and covers_dir:
                first_audio = folder_first_audio.get(folder_path)
                if first_audio:
                    img = extract_embedded_cover_bytes(first_audio)
                    if img:
                        os.makedirs(covers_dir, exist_ok=True)
                        base = safe_filename(f"{album_artist}_{album_title}_{abs(hash(folder_path))}")
                        out_path = os.path.join(covers_dir, f"{base}.jpg")
                        try:
                            with open(out_path, "wb") as f:
                                f.write(img)
                            cover_rel = f"covers/{os.path.basename(out_path)}"
                        except Exception as e:
                            log_cb(f"Cover save failed for {album_title}: {e}")

            album_id = upsert_folder_album(conn, folder_path, album_title, album_artist, year, cover_rel)

            def keyfn(t):
                p = t.get("position")
                return (p if isinstance(p, int) else 10**9, (t.get("title") or ""))

            tracks_sorted = sorted(tracks, key=keyfn)
            replace_tracks_for_album(conn, album_id, tracks_sorted)

            albums_written += 1
            tracks_written += len(tracks_sorted)

            if albums_written % 25 == 0:
                log_cb(f"Wrote {albums_written} albums…")
                progress_cb(total, tracks_written, albums_written, "Writing…")

        progress_cb(total, tracks_written, albums_written, "Done")
        log_cb(f"Done. Albums written: {albums_written}, Tracks written: {tracks_written}")

    finally:
        conn.close()


# ---------- export JSON for webpage ----------
def export_db_to_json(db_path: str, site_dir: str, json_name: str = "albums.json") -> tuple[str, int]:
    os.makedirs(site_dir, exist_ok=True)
    out_file = os.path.join(site_dir, json_name)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    albums = cur.execute("""
        SELECT id, barcode, title, artist, release_date, country, label,
               catalog_number, musicbrainz_release_id, cover_path, source, source_id, created_at
        FROM albums
        ORDER BY artist, title
    """).fetchall()

    tracks = cur.execute("""
        SELECT album_id, position, title, length_ms
        FROM tracks
        ORDER BY album_id, position
    """).fetchall()

    track_map = {}
    for t in tracks:
        track_map.setdefault(t["album_id"], []).append({
            "position": t["position"],
            "title": t["title"],
            "length_ms": t["length_ms"],
            "length_str": ms_to_str(t["length_ms"]),
        })

    data = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "count": len(albums),
        "albums": []
    }

    for a in albums:
        data["albums"].append({
            "id": a["id"],
            "barcode": a["barcode"],
            "title": a["title"],
            "artist": a["artist"],
            "release_date": a["release_date"],
            "country": a["country"],
            "label": a["label"],
            "catalog_number": a["catalog_number"],
            "musicbrainz_release_id": a["musicbrainz_release_id"],
            "cover_path": a["cover_path"],  # expects "covers/xxx.jpg"
            "source": a["source"],
            "source_id": a["source_id"],
            "created_at": a["created_at"],
            "tracks": track_map.get(a["id"], [])
        })

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    conn.close()
    return out_file, data["count"]


# ---------- GUI ----------
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Music Import + Export (cd_catalog.db → albums.json)")
        self.geometry("1000x700")

        # Defaults (you can change these in the GUI)
        self.music_dir = tk.StringVar(value=r"C:\Users\gcxcl\Music")
        self.db_path = tk.StringVar(value=r"C:\Users\gcxcl\OneDrive\Desktop\Python Stuff\CD Database\cd_catalog.db")
        self.site_dir = tk.StringVar(value=r"C:\Users\gcxcl\OneDrive\Documents\PaceApp\PaceApp2_0\stats\cd")

        self.extract_covers_var = tk.BooleanVar(value=True)
        self.clear_first_var = tk.BooleanVar(value=False)

        self.json_name = tk.StringVar(value="albums.json")

        self._stop_flag = False

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True)

        self.tab_import = ttk.Frame(nb, padding=12)
        self.tab_export = ttk.Frame(nb, padding=12)
        nb.add(self.tab_import, text="Import Music Folder")
        nb.add(self.tab_export, text="Export JSON")

        self._build_import_tab()
        self._build_export_tab()

    # ---- shared ui helpers ----
    def _log(self, msg: str):
        self.log.insert("end", msg + "\n")
        self.log.see("end")
        self.update_idletasks()

    def _set_status(self, msg: str):
        self.status.config(text=msg)
        self.update_idletasks()

    def _progress_cb(self, files_scanned, tracks_written, albums_written, phase):
        def u():
            self._set_status(f"{phase} | Files scanned: {files_scanned} | Tracks written: {tracks_written} | Albums written: {albums_written}")
        self.after(0, u)

    def _log_cb(self, msg: str):
        self.after(0, lambda: self._log(msg))

    def _stop_flag_fn(self) -> bool:
        return self._stop_flag

    # ---- import tab ----
    def _build_import_tab(self):
        frm = self.tab_import

        r1 = ttk.Frame(frm); r1.pack(fill="x", pady=(0, 8))
        ttk.Label(r1, text="Music folder:", width=14).pack(side="left")
        ttk.Entry(r1, textvariable=self.music_dir).pack(side="left", fill="x", expand=True)
        ttk.Button(r1, text="Browse…", command=self.pick_music_dir).pack(side="left", padx=8)

        r2 = ttk.Frame(frm); r2.pack(fill="x", pady=(0, 8))
        ttk.Label(r2, text="cd_catalog.db:", width=14).pack(side="left")
        ttk.Entry(r2, textvariable=self.db_path).pack(side="left", fill="x", expand=True)
        ttk.Button(r2, text="Browse…", command=self.pick_db).pack(side="left", padx=8)

        r3 = ttk.Frame(frm); r3.pack(fill="x", pady=(0, 8))
        ttk.Label(r3, text="Site folder:", width=14).pack(side="left")
        ttk.Entry(r3, textvariable=self.site_dir).pack(side="left", fill="x", expand=True)
        ttk.Button(r3, text="Browse…", command=self.pick_site_dir).pack(side="left", padx=8)

        opts = ttk.Frame(frm); opts.pack(fill="x", pady=(0, 10))
        ttk.Checkbutton(opts, text="Extract embedded cover art to site/covers/", variable=self.extract_covers_var).pack(side="left")
        ttk.Checkbutton(opts, text="Clear previously imported folder albums first", variable=self.clear_first_var).pack(side="left", padx=16)

        btns = ttk.Frame(frm); btns.pack(fill="x", pady=(0, 10))
        self.start_btn = ttk.Button(btns, text="Start Import", command=self.start_import)
        self.start_btn.pack(side="left")
        self.stop_btn = ttk.Button(btns, text="Stop", command=self.stop_import, state="disabled")
        self.stop_btn.pack(side="left", padx=8)

        self.status = ttk.Label(frm, text="Ready.", foreground="#555")
        self.status.pack(anchor="w", pady=(0, 6))
        self.pb = ttk.Progressbar(frm, mode="indeterminate")
        self.pb.pack(fill="x", pady=(0, 10))

        ttk.Label(frm, text="Log:").pack(anchor="w")
        self.log = tk.Text(frm, height=22, wrap="word")
        self.log.pack(fill="both", expand=True)

        self._log("Tip: Covers will be saved into <site>/covers and JSON should reference cover_path like 'covers/xxx.jpg'.")

    def pick_music_dir(self):
        d = filedialog.askdirectory(title="Select your music folder")
        if d:
            self.music_dir.set(d)

    def pick_db(self):
        p = filedialog.askopenfilename(title="Select cd_catalog.db", filetypes=[("SQLite DB", "*.db"), ("All files", "*.*")])
        if p:
            self.db_path.set(p)

    def pick_site_dir(self):
        d = filedialog.askdirectory(title="Select your site folder (contains index.html)")
        if d:
            self.site_dir.set(d)

    def start_import(self):
        root = self.music_dir.get().strip()
        db_path = self.db_path.get().strip()
        site_dir = self.site_dir.get().strip()
        extract_covers = self.extract_covers_var.get()
        clear_first = self.clear_first_var.get()

        if not root or not os.path.isdir(root):
            messagebox.showerror("Music folder", "Please choose a valid music folder.")
            return
        if not db_path:
            messagebox.showerror("Database", "Please choose a valid cd_catalog.db file.")
            return
        if not site_dir or not os.path.isdir(site_dir):
            messagebox.showerror("Site folder", "Please choose a valid site folder.")
            return

        self._stop_flag = False
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self.pb.start(10)

        self._log("-----")
        self._log(f"Starting import: {root}")
        self._log(f"DB: {db_path}")
        self._log(f"Site: {site_dir}")
        self._log(f"Extract covers: {extract_covers}")
        self._log(f"Clear first: {clear_first}")

        def worker():
            try:
                scan_music_folder_into_cd_catalog(
                    root_folder=root,
                    db_path=db_path,
                    site_dir=site_dir,
                    clear_first=clear_first,
                    extract_covers=extract_covers,
                    progress_cb=self._progress_cb,
                    log_cb=self._log_cb,
                    stop_flag_fn=self._stop_flag_fn
                )
            except Exception as e:
                self._log_cb(f"ERROR: {e}")
            finally:
                self.after(0, self._import_finished)

        threading.Thread(target=worker, daemon=True).start()

    def stop_import(self):
        self._stop_flag = True
        self._log("Stop requested…")

    def _import_finished(self):
        self.pb.stop()
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self._set_status("Ready.")
        self._log("Import finished.")

    # ---- export tab ----
    def _build_export_tab(self):
        frm = self.tab_export

        ttk.Label(frm, text="Export your cd_catalog.db into albums.json for the webpage.",
                  font=("Segoe UI", 11)).pack(anchor="w", pady=(0, 10))

        r1 = ttk.Frame(frm); r1.pack(fill="x", pady=(0, 8))
        ttk.Label(r1, text="cd_catalog.db:", width=14).pack(side="left")
        ttk.Entry(r1, textvariable=self.db_path).pack(side="left", fill="x", expand=True)
        ttk.Button(r1, text="Browse…", command=self.pick_db).pack(side="left", padx=8)

        r2 = ttk.Frame(frm); r2.pack(fill="x", pady=(0, 8))
        ttk.Label(r2, text="Site folder:", width=14).pack(side="left")
        ttk.Entry(r2, textvariable=self.site_dir).pack(side="left", fill="x", expand=True)
        ttk.Button(r2, text="Browse…", command=self.pick_site_dir).pack(side="left", padx=8)

        r3 = ttk.Frame(frm); r3.pack(fill="x", pady=(0, 8))
        ttk.Label(r3, text="JSON name:", width=14).pack(side="left")
        ttk.Entry(r3, textvariable=self.json_name).pack(side="left", fill="x", expand=True)

        btns = ttk.Frame(frm); btns.pack(fill="x", pady=(10, 6))
        ttk.Button(btns, text="Export albums.json", command=self.do_export).pack(side="left")

        self.export_status = ttk.Label(frm, text="Ready.", foreground="#555")
        self.export_status.pack(anchor="w", pady=(6, 0))

        self.export_log = tk.Text(frm, height=18, wrap="word")
        self.export_log.pack(fill="both", expand=True, pady=(10, 0))
        self.export_log.insert("end", "After exporting:\n- commit + push site/albums.json\n- commit + push site/covers/ (if covers were created)\n")

    def do_export(self):
        db_path = self.db_path.get().strip()
        site_dir = self.site_dir.get().strip()
        json_name = self.json_name.get().strip() or "albums.json"

        if not db_path or not os.path.exists(db_path):
            messagebox.showerror("Export", "Please select a valid cd_catalog.db.")
            return
        if not site_dir or not os.path.isdir(site_dir):
            messagebox.showerror("Export", "Please select a valid site folder.")
            return

        try:
            out_file, count = export_db_to_json(db_path, site_dir, json_name)
        except Exception as e:
            messagebox.showerror("Export error", str(e))
            self.export_status.config(text="Export failed.")
            return

        self.export_status.config(text=f"Exported {count} albums → {out_file}")
        self.export_log.insert("end", f"\nExported {count} albums to:\n{out_file}\n")
        self.export_log.see("end")
        messagebox.showinfo("Export complete", f"Wrote:\n{out_file}")

if __name__ == "__main__":
    App().mainloop()