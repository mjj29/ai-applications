"""Club/indoor sessions: several archers taking turns on one camera-facing shooting spot.

Folder layout (one folder per archer; one video file = one end):

  <session>/
    session.yaml        optional overrides for the whole session (shooting spot, arrows per end, ...)
    Alice/
      archer.yaml       optional per-archer overrides (e.g. archer: {handedness: left})
      WIN_20261011_19_30_12_Pro.mp4
      ...
    Bob/ ...
    _analysis/          full-accuracy results  (`session` command)
      index.md          one row per archer, linking their report
      Alice/report.md   that archer's report + images/videos (data/ holds intermediates)
    _quick/             fast previews written while capturing (`watch` command), same shape

Each archer is analysed on their own: outliers and "typical" are judged against that
archer's own shots, never pooled across archers. Folders starting with '_' or '.' are ignored.
Settings layer as: config.yaml <- session.yaml <- <archer>/archer.yaml <- profile (fast).
"""
from __future__ import annotations

import time
import traceback
from pathlib import Path

import yaml

from . import config as _config

RESULT_DIRS = {"full": "_analysis", "fast": "_quick"}


# ---------------------------------------------------------------- layout + config
def archers(session: Path) -> dict[str, list[Path]]:
    """{archer name: [videos]} for every archer folder that contains at least one video."""
    out = {}
    for d in sorted(p for p in Path(session).iterdir() if p.is_dir()):
        if d.name.startswith(("_", ".")):
            continue
        vids = _config.list_videos(d)
        if vids:
            out[d.name] = vids
    return out


def _read_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def results_dir(session: Path, profile: str) -> Path:
    return Path(session).resolve() / RESULT_DIRS.get(profile, f"_{profile}")


def archer_cfg(base: dict, session: Path, archer: str, profile: str) -> dict:
    """Effective config for one archer in one session, with output/data dirs inside the session."""
    session = Path(session).resolve()
    cfg = _config.merge(base, _read_yaml(session / "session.yaml"))
    cfg = _config.merge(cfg, _read_yaml(session / archer / "archer.yaml"))
    cfg = _config.apply_profile(cfg, profile)
    odir = results_dir(session, profile) / archer
    cfg.setdefault("output", {})
    cfg["output"]["dir"] = str(odir)          # absolute, so PROJECT_ROOT / dir == dir
    cfg["output"]["data_dir"] = str(odir / "data")
    return cfg


# ---------------------------------------------------------------- per-video / per-archer work
def _shots_count(stem: str, cfg: dict) -> int:
    import pandas as pd
    f = _config.data_dir(cfg) / f"{stem}.shots.parquet"
    return len(pd.read_parquet(f)) if f.exists() else 0


def _refresh_shots_page(video: Path, cfg: dict):
    from . import gallery
    try:
        page = gallery.archer_page(video.parent.name, _config.list_videos(video.parent), cfg)
        if page:
            print(f"   -> {page}", flush=True)
    except OSError as e:     # e.g. the page is open somewhere that locks it; next end retries
        print(f"   (couldn't refresh the shots page: {e})", flush=True)


def process_video(video: Path, cfg: dict, *, overwrite=False) -> int:
    """Run every per-video stage on one end. Returns the number of shots found.

    Ordered so what an archer wants to see first lands first: the cut shots (then the
    archer's shots.html page), then the aligned ghost overlay, then the charts."""
    from . import clip, compare, extract_hands, extract_pose, ghost, normalize, segment
    vids = [video]
    extract_pose.run(vids, cfg, overwrite=overwrite)
    segment.run(vids, cfg)
    n = _shots_count(video.stem, cfg)
    if n == 0:
        print(f"{video.stem}: no shots detected - check {video.stem}.segment.png "
              f"(is the archer inside the shooting spot?)")
        return 0
    extract_hands.run(vids, cfg, overwrite=overwrite)
    normalize.run(vids, cfg)
    clip.run(vids, cfg)
    _refresh_shots_page(video, cfg)
    ghost.run(vids, cfg)
    _refresh_shots_page(video, cfg)
    compare.run(vids, cfg)
    return n


def summarise_archer(videos: list[Path], cfg: dict) -> bool:
    """Pooled outliers + report over this archer's ends that produced shots."""
    from . import outliers, report
    usable = [v for v in videos if (_config.data_dir(cfg) / f"{v.stem}.normalized.npz").exists()
              and _shots_count(v.stem, cfg) > 0]
    total = sum(_shots_count(v.stem, cfg) for v in usable)
    if total < 2:
        print(f"  (only {total} shot(s) so far - report needs at least 2)")
        return False
    outliers.run(usable, cfg)
    report.run(usable, cfg)
    return True


def write_index(session: Path, base: dict, profile: str) -> Path:
    """<results>/index.md: one row per archer with ends/shots and a link to their report
    (plus index.html linking each archer's shots page)."""
    session = Path(session).resolve()
    rdir = results_dir(session, profile)
    rdir.mkdir(parents=True, exist_ok=True)
    from . import gallery
    rows = ["| archer | ends | shots | report |", "|---|---|---|---|"]
    html_rows = []
    for name, vids in archers(session).items():
        cfg = archer_cfg(base, session, name, profile)
        shots = [_shots_count(v.stem, cfg) for v in vids]
        rep = Path(cfg["output"]["dir"]) / "report.md"
        link = f"[{name}/report.md]({name}/report.md)" if rep.exists() else "_not yet_"
        rows.append(f"| {name} | {len(vids)} | {sum(shots)} | {link} |")
        html_rows.append((name, len(vids), sum(shots)))
    kind = "quick previews (fast model)" if profile == "fast" else "full analysis"
    gallery.session_page(rdir, f"Session {session.name} - {kind}", html_rows)
    text = (f"# Session {session.name} - {kind}\n\n" + "\n".join(rows) + "\n\n"
            "Open each report in VS Code's Markdown preview (or any Markdown viewer) so the "
            "images show. Check each end's `segment.png` before trusting the comparisons.\n")
    out = rdir / "index.md"
    out.write_text(text, encoding="utf-8")
    return out


def _warn_no_spot(cfg):
    from .extract_pose import spot_of
    if spot_of(cfg) is None:
        print("NOTE: no shooting spot set - tracking the LARGEST person in frame. With other\n"
              "      archers around, set the spot first:  python -m archery.cli spot <session>")


# ---------------------------------------------------------------- batch
def run_session(session: Path, base: dict, profile: str = "full", only: list[str] | None = None):
    session = Path(session).resolve()
    found = archers(session)
    if only:
        found = {k: v for k, v in found.items() if k in only}
    if not found:
        raise SystemExit(f"no archer folders with videos under {session}")
    print(f"Session {session.name}: {', '.join(f'{k} ({len(v)})' for k, v in found.items())}  [{profile}]")
    _warn_no_spot(archer_cfg(base, session, next(iter(found)), profile))
    for name, vids in found.items():
        cfg = archer_cfg(base, session, name, profile)
        print(f"\n===== {name}: {len(vids)} end(s) -> {cfg['output']['dir']}")
        for v in vids:
            try:
                process_video(v, cfg)
            except Exception:  # noqa: BLE001 - one bad file must not stop the session
                print(f"!! {name}/{v.name} failed:\n{traceback.format_exc()}")
        try:
            summarise_archer(vids, cfg)
        except Exception:  # noqa: BLE001
            print(f"!! {name}: report failed:\n{traceback.format_exc()}")
    idx = write_index(session, base, profile)
    print(f"\nDone. Start at {idx}")


# ---------------------------------------------------------------- watch (in-session)
def _ready(video: Path, seen: dict, settle_s: float) -> bool:
    """True once the file has stopped growing for settle_s and opens as a video."""
    import cv2
    st = video.stat()
    sig = (st.st_size, st.st_mtime_ns)
    prev = seen.get(video)
    seen[video] = sig
    if prev != sig or time.time() - st.st_mtime < settle_s or st.st_size == 0:
        return False
    cap = cv2.VideoCapture(str(video))
    ok = cap.isOpened() and cap.get(cv2.CAP_PROP_FRAME_COUNT) > 0
    cap.release()
    return ok


def _marker(video: Path, cfg: dict) -> Path:
    return _config.data_dir(cfg) / f"{video.stem}.done"


def valid_name(name: str) -> bool:
    return bool(name) and not name.startswith(("_", ".")) and not any(c in name for c in '\\/:*?"<>|')


def session_cfg(base: dict, session: Path) -> dict:
    """config.yaml + session.yaml (no archer layer): what identification runs with."""
    return _config.merge(base, _read_yaml(Path(session) / "session.yaml"))


def file_recording(video: Path, session: Path, base: dict, *, move=True) -> tuple[str, Path]:
    """Identify who is on the spot in `video`, put it in <session>/<archer>/, save its signature."""
    import json
    import shutil

    from . import identify
    name, sig = identify.identify(video, session, session_cfg(base, session))
    dest_dir = Path(session) / name
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / video.name
    if dest.resolve() != video.resolve():
        (shutil.move if move else shutil.copy2)(str(video), str(dest))
    (identify.ids_dir(session) / f"{video.stem}.json").write_text(json.dumps(sig), encoding="utf-8")
    print(f"   {video.name} -> {name}/", flush=True)
    return name, dest


class _Incoming:
    """New recordings in the folder the recorder saves into. Each finished file is identified by
    appearance (who's on the spot) and moved into <session>/<archer>/. Files already in the folder
    when watching starts are left alone (use the `sort` command for those)."""

    def __init__(self, folder: Path, session: Path, base: dict):
        self.folder, self.session, self.base = Path(folder).resolve(), session, base
        self.folder.mkdir(parents=True, exist_ok=True)
        self.ignore = set(self._scan())
        self.failed: dict[Path, int] = {}

    def _scan(self):
        try:
            return _config.list_videos(self.folder)
        except OSError:
            return []

    def collect(self, seen: dict, settle_s: float) -> set[str]:
        """File every finished new recording. Returns the archers that received one."""
        got = set()
        for f in self._scan():
            if f in self.ignore or not _ready(f, seen, settle_s):
                continue
            try:
                name, _ = file_recording(f, self.session, self.base)
                got.add(name)
            except OSError as e:     # still locked by the recorder, etc. - retry next scan
                self.failed[f] = self.failed.get(f, 0) + 1
                print(f"   (can't file {f.name} yet: {e})", flush=True)
                if self.failed[f] >= 10:
                    self.ignore.add(f)
        return got


def check_duplicates(session: Path, base: dict):
    """Warn about pseudonyms that look like the same person (e.g. after a lighting change)."""
    from . import identify
    known = identify.known_archers(session)
    thr = float(session_cfg(base, session).get("identify", {}).get("match_threshold", 0.42))
    names = sorted(known)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            d = identify.distance(known[a], known[b])
            if d < thr * 1.4:
                print(f"   ?? {a} and {b} look alike ({d:.2f}) - if they're the same archer:  "
                      f"python -m archery.cli merge <session> {b} {a}", flush=True)


def watch(session: Path, base: dict, profile: str = "fast", interval_s: float | None = None,
          settle_s: float | None = None, incoming: Path | None = None):
    """Process each new end as soon as its file is complete, then refresh that archer's report."""
    session = Path(session).resolve()
    session.mkdir(parents=True, exist_ok=True)
    wc = base.get("watch", {})
    interval_s = float(interval_s or wc.get("interval_s", 10))
    settle_s = float(settle_s or wc.get("settle_s", 15))
    incoming = incoming or wc.get("incoming")
    print(f"Watching {session}  [{profile} profile; results in {results_dir(session, profile)}]")
    inc = None
    if incoming:
        inc = _Incoming(Path(incoming), session, base)
        print(f"New recordings in {inc.folder} are identified by appearance and moved into\n"
              f"<session>/<pseudonym>/ (rename pseudonyms later with the rename command). Ctrl+C to stop.\n")
    else:
        print("Put each archer's videos in their own subfolder. Ctrl+C to stop.\n")
    _warn_no_spot(_config.apply_profile(_config.merge(base, _read_yaml(session / "session.yaml")), profile))
    seen: dict[Path, tuple] = {}
    waiting_msg = True
    stale: dict[str, dict] = {}     # archers with new ends whose report hasn't been rebuilt yet
    try:
        while True:
            if inc and inc.collect(seen, settle_s):
                check_duplicates(session, base)
            todo = []
            for name, vids in archers(session).items():
                cfg = archer_cfg(base, session, name, profile)
                for v in vids:
                    sig = f"{v.stat().st_size}:{v.stat().st_mtime_ns}"
                    mk = _marker(v, cfg)
                    if mk.exists() and mk.read_text(encoding="utf-8").split("\n")[0] == sig:
                        continue
                    if _ready(v, seen, settle_s):
                        todo.append((name, v, cfg, sig, mk.exists()))
            if todo:
                # One end per pass, oldest recording first, then look for new recordings again:
                # every waiting end gets its shots cut and aligned before any archer's slower report.
                waiting_msg = True
                name, v, cfg, sig, changed = min(todo, key=lambda r: r[1].stat().st_mtime)
                t0 = time.time()
                print(f"\n[{time.strftime('%H:%M:%S')}] ===== {name}/{v.name}"
                      + (f"  ({len(todo) - 1} more waiting)" if len(todo) > 1 else ""), flush=True)
                try:
                    n = process_video(v, cfg, overwrite=changed)
                    status = f"{n} shots"
                except Exception:  # noqa: BLE001
                    status = "FAILED"
                    print(traceback.format_exc())
                _marker(v, cfg).write_text(f"{sig}\n{status}\n", encoding="utf-8")
                print(f"[{time.strftime('%H:%M:%S')}] {name}/{v.name}: {status} "
                      f"({(time.time() - t0) / 60:.1f} min)", flush=True)
                stale[name] = cfg
                write_index(session, base, profile)
                continue
            if stale:
                for name, cfg in stale.items():
                    try:
                        if summarise_archer(archers(session).get(name, []), cfg):
                            print(f"   -> {Path(cfg['output']['dir']) / 'report.md'}")
                    except Exception:  # noqa: BLE001 - e.g. a result video open in a player on Windows
                        print(f"!! {name}: report refresh failed (will retry after the next end):\n"
                              f"{traceback.format_exc()}")
                stale.clear()
                write_index(session, base, profile)
                continue
            if waiting_msg:
                print(f"[{time.strftime('%H:%M:%S')}] waiting for new videos...", flush=True)
                waiting_msg = False
            time.sleep(interval_s)
    except KeyboardInterrupt:
        print("\nStopped watching.")


# ---------------------------------------------------------------- choose the shooting spot
def spot(target: Path, base: dict, at_s: float | None = None, pick: int | None = None,
         session: Path | None = None):
    """Detect everyone in one frame, save a numbered picture, and (with pick) save the spot.

    target: a session folder (uses its first video) or a single video file; the spot is saved to
    `session` (default: the session folder / the video's archer folder's parent).
    """
    import cv2
    import mediapipe as mp
    import numpy as np
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    from . import landmarks as L
    from .extract_pose import torso_centre

    target = Path(target).resolve()
    if target.is_dir():
        found = archers(target)
        if not found:
            raise SystemExit(f"no archer folders with videos under {target}")
        video, session = next(iter(found.values()))[0], Path(session).resolve() if session else target
    else:
        video = target
        session = Path(session).resolve() if session else target.parent.parent

    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fi = int(at_s * fps) if at_s is not None else int(n * 0.3)
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, min(fi, n - 1)))
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise SystemExit(f"could not read a frame from {video}")
    H, W = frame.shape[:2]

    model = str((_config.PROJECT_ROOT / base["pose"]["model"]).resolve())
    opts = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model),
        running_mode=vision.RunningMode.IMAGE, num_poses=6,
        min_pose_detection_confidence=0.4, min_pose_presence_confidence=0.4)
    with vision.PoseLandmarker.create_from_options(opts) as lm:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))

    img = frame.copy()
    for g in range(1, 10):                      # 0.1 grid so boxes can also be set by eye
        x, y = int(W * g / 10), int(H * g / 10)
        cv2.line(img, (x, 0), (x, H), (90, 90, 90), 1)
        cv2.line(img, (0, y), (W, y), (90, 90, 90), 1)
        for pos in ((x + 4, 22), (4, y - 6)):
            cv2.putText(img, f"{g / 10:.1f}", pos, cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4)
            cv2.putText(img, f"{g / 10:.1f}", pos, cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

    boxes = []
    for i, p in enumerate(res.pose_landmarks, start=1):
        xs, ys = [q.x for q in p], [q.y for q in p]
        hx = (p[L.LEFT_HIP].x + p[L.RIGHT_HIP].x) / 2
        hy = (p[L.LEFT_HIP].y + p[L.RIGHT_HIP].y) / 2
        sx = (p[L.LEFT_SHOULDER].x + p[L.RIGHT_SHOULDER].x) / 2
        sy = (p[L.LEFT_SHOULDER].y + p[L.RIGHT_SHOULDER].y) / 2
        cx, cy = torso_centre(p)
        # spot = torso centre +/- ~0.8 torso length across, 0.5 down/up: keeps this archer
        # through lean/draw, excludes neighbours on adjacent targets and people behind the line.
        torso = max(float(np.hypot((sx - hx) * W, (sy - hy) * H)), 0.03 * H)
        dx, dy = 0.8 * torso / W, 0.5 * torso / H
        hx, hy = cx, cy
        box = [round(max(0.0, hx - dx), 3), round(max(0.0, hy - dy), 3),
               round(min(1.0, hx + dx), 3), round(min(1.0, hy + dy), 3)]
        boxes.append(box)
        col = (0, 200, 255)
        cv2.rectangle(img, (int(min(xs) * W), int(min(ys) * H)), (int(max(xs) * W), int(max(ys) * H)), col, 2)
        cv2.rectangle(img, (int(box[0] * W), int(box[1] * H)), (int(box[2] * W), int(box[3] * H)), (0, 255, 0), 2)
        cv2.circle(img, (int(hx * W), int(hy * H)), 6, (0, 0, 255), -1)
        cv2.putText(img, str(i), (int(min(xs) * W), max(30, int(min(ys) * H) - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.4, col, 3)

    rdir = results_dir(session, "full")
    rdir.mkdir(parents=True, exist_ok=True)
    out = rdir / "spot.png"
    cv2.imwrite(str(out), img)
    print(f"frame {fi} of {video.name}  ->  {out}")
    if not boxes:
        print("nobody detected in this frame - try another moment with --at SECONDS")
        return
    for i, b in enumerate(boxes, start=1):
        print(f"  person {i}: spot [{b[0]:.3f}, {b[1]:.3f}, {b[2]:.3f}, {b[3]:.3f}]")

    if pick is None:
        print("\nOpen the picture; the green box around each person's torso is their suggested spot.\nRe-run with "
              "--pick N for the archer on the shooting spot to save it to session.yaml.")
        return
    if not 1 <= pick <= len(boxes):
        raise SystemExit(f"--pick must be 1..{len(boxes)}")
    sy_path = session / "session.yaml"
    data = _read_yaml(sy_path)
    data = _config.merge(data, {"archer": {"select": "spot", "spot": boxes[pick - 1]}})
    with open(sy_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False)
    print(f"saved spot {boxes[pick - 1]} to {sy_path}")


# ---------------------------------------------------------------- fixing up who's who
def _relocate(session: Path, stems: list[str], src: str, dst: str):
    """Move the results of these ends from archer src to dst in every results folder."""
    import json
    import shutil
    for rdir in (results_dir(session, p) for p in RESULT_DIRS):
        for sub in ("", "data"):
            a, b = rdir / src / sub, rdir / dst / sub
            if not a.is_dir():
                continue
            b.mkdir(parents=True, exist_ok=True)
            for f in list(a.iterdir()):
                if any(f.name == st or f.name.startswith(st + ".") for st in stems):
                    target = b / f.name
                    if target.exists():
                        shutil.rmtree(target) if target.is_dir() else target.unlink()
                    shutil.move(str(f), str(target))
                    if f.name.endswith(".meta.json"):     # the source video moved too
                        meta = json.loads(target.read_text(encoding="utf-8"))
                        meta["video"] = str(Path(session) / dst / Path(meta["video"]).name)
                        target.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def _refresh(session: Path, base: dict, names: list[str]):
    """Rebuild reports for these archers (in whichever results folders exist) + the indexes."""
    import shutil
    found = archers(session)
    for profile in RESULT_DIRS:
        rdir = results_dir(session, profile)
        if not rdir.is_dir():
            continue
        for n in names:
            if n not in found:
                shutil.rmtree(rdir / n, ignore_errors=True)
                continue
            if (rdir / n).is_dir():
                cfg = archer_cfg(base, session, n, profile)
                for st in [v.stem for v in found[n]]:   # ends never processed in this profile
                    if not (_config.data_dir(cfg) / f"{st}.normalized.npz").exists():
                        print(f"   ({n}/{st} has no {profile} results yet - run `session`"
                              f"{' --fast' if profile == 'fast' else ''} to fill them in)")
                try:
                    summarise_archer(found[n], cfg)
                except Exception:  # noqa: BLE001
                    print(f"!! {n}: report refresh failed:\n{traceback.format_exc()}")
        write_index(session, base, profile)


def move_end(session: Path, base: dict, video_name: str, dst: str):
    """Move one end (a video, by file name or stem) to another archer, keeping its results."""
    session = Path(session).resolve()
    if not valid_name(dst):
        raise SystemExit(f"not a usable folder name: {dst!r}")
    for name, vids in archers(session).items():
        for v in vids:
            if video_name in (v.name, v.stem):
                if name == dst:
                    print(f"{v.name} is already {dst}'s")
                    return
                (session / dst).mkdir(exist_ok=True)
                v.rename(session / dst / v.name)
                _relocate(session, [v.stem], name, dst)
                if not _config.list_videos(session / name):
                    _remove_archer_dir(session, name)
                print(f"moved {v.name}: {name} -> {dst}")
                _refresh(session, base, [name, dst])
                return
    raise SystemExit(f"no end called {video_name!r} in {session}")


def _remove_archer_dir(session: Path, name: str):
    d = Path(session) / name
    for f in d.iterdir():
        if f.name == "archer.yaml":
            f.unlink()
    try:
        d.rmdir()
    except OSError:
        print(f"   (left {d} in place: it still has other files in it)")


def merge(session: Path, base: dict, src: str, dst: str):
    """Rename archer src to dst; if dst exists already, src's ends join dst's."""
    session = Path(session).resolve()
    if not valid_name(dst):
        raise SystemExit(f"not a usable folder name: {dst!r}")
    vids = _config.list_videos(session / src) if (session / src).is_dir() else []
    if not vids:
        raise SystemExit(f"no archer folder {src!r} with videos in {session}")
    (session / dst).mkdir(exist_ok=True)
    if (session / src / "archer.yaml").exists() and not (session / dst / "archer.yaml").exists():
        (session / src / "archer.yaml").rename(session / dst / "archer.yaml")
    for v in vids:
        v.rename(session / dst / v.name)
    _relocate(session, [v.stem for v in vids], src, dst)
    _remove_archer_dir(session, src)
    print(f"{src} -> {dst}: {len(vids)} end(s)")
    _refresh(session, base, [src, dst])


def who(session: Path, base: dict):
    """Print every archer's ends and how alike each pair of archers looks."""
    from . import identify
    session = Path(session).resolve()
    known = identify.known_archers(session)
    found = archers(session)
    thr = float(session_cfg(base, session).get("identify", {}).get("match_threshold", 0.42))
    for n, vids in found.items():
        print(f"{n}: {', '.join(v.name for v in vids)}")
    names = sorted(known)
    if len(names) > 1:
        print(f"\nappearance distance between archers (same person if < {thr:.2f}):")
        w = max(len(n) for n in names)
        print(" " * (w + 2) + "  ".join(f"{n[:7]:>7}" for n in names))
        for a in names:
            row = "  ".join("      -" if a == b else f"{identify.distance(known[a], known[b]):7.2f}" for b in names)
            print(f"{a:>{w}}  {row}")
