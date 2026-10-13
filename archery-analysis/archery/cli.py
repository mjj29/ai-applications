"""Command-line entry point: `python -m archery.cli <stage> [videos...]`.

Stages can be run individually or end-to-end with `run-all`. Each stage reads/writes
intermediate artifacts under data/, so reruns are cheap and tunable one stage at a time.

Club/indoor sessions (one folder per archer, see archery/session.py):
  python -m archery.cli spot <session> [--pick N]   choose the shooting spot to track
  python -m archery.cli watch <session> [--incoming DIR]   fast previews as each end is saved
  python -m archery.cli who <session>               pseudonyms, their ends, how alike they look
  python -m archery.cli rename|merge <session> A B  rename a pseudonym / merge A into B
  python -m archery.cli move <session> VIDEO B      give one end to a different archer
  python -m archery.cli session <session>           full-accuracy run over every archer
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import config as _config

STAGES = [
    ("extract", "Stage 1: per-frame body pose landmarks (nearest archer)"),
    ("hands", "Stage 1b: hand landmarks within shot windows (draw/bow hands)"),
    ("segment", "Stage 2: find shots + release frame (pose + clicker audio)"),
    ("normalize", "Stage 3: center/scale on body; release == t0"),
    ("clip", "Stage 4: cut single-shot segments"),
    ("compare", "Stage 5: overlay + plots + highlight deviations"),
    ("ghost", "Stage 5b: body-aligned ghost overlay of real frames"),
    ("outliers", "Pooled cross-video outlier analysis (find atypical shots)"),
    ("report", "Build the per-run report + 2-shot deltas into the output dir"),
    ("run-all", "Run the whole pipeline for all configured videos"),
]


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):    # Windows consoles/redirects default to cp1252
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(prog="archery", description="Archery shot-analysis pipeline")
    p.add_argument("-c", "--config", default=str(_config.DEFAULT_CONFIG))
    sub = p.add_subparsers(dest="stage", required=True)
    for name, help_ in STAGES:
        sp = sub.add_parser(name, help=help_)
        sp.add_argument("videos", nargs="*", help="video files (default: from config input.videos)")

    sp = sub.add_parser("session", help="Full analysis of a session folder (one subfolder per archer)")
    sp.add_argument("session", type=Path)
    sp.add_argument("--fast", action="store_true", help="use the fast profile (results in _quick/)")
    sp.add_argument("--archer", action="append", help="only these archer folder(s); repeatable")
    sp = sub.add_parser("reel", help="One video per archer: all their shots back to back")
    sp.add_argument("session", type=Path)
    sp.add_argument("--fast", action="store_true", help="from the fast results (_quick/)")
    sp.add_argument("--archer", action="append", help="only these archer folder(s); repeatable")
    sp = sub.add_parser("watch", help="Process each new end as it is saved into a session folder")
    sp.add_argument("session", type=Path)
    sp.add_argument("--full", action="store_true", help="full accuracy instead of the fast profile (slow)")
    sp.add_argument("--incoming", type=Path,
                    help="folder the recorder saves into (default: watch.incoming in config.yaml); "
                         "new recordings there are identified and moved into <session>/<archer>/")
    sp.add_argument("--interval", type=float, help="seconds between folder scans (default 10)")
    sp.add_argument("--settle", type=float,
                    help="a file must be unchanged this many seconds before it is processed (default 15)")
    sp = sub.add_parser("sort", help="Identify archers in recordings and file them into the session")
    sp.add_argument("session", type=Path)
    sp.add_argument("--incoming", type=Path, help="folder of recordings (default: watch.incoming)")
    sp.add_argument("--copy", action="store_true", help="copy instead of moving the recordings")
    sp = sub.add_parser("who", help="List each archer's ends and how alike the archers look")
    sp.add_argument("session", type=Path)
    for nm, hl in (("merge", "Merge archer SRC into DST (same person filed twice)"),
                   ("rename", "Rename an archer's pseudonym, e.g. rename <session> Kestrel Alice")):
        sp = sub.add_parser(nm, help=hl)
        sp.add_argument("session", type=Path)
        sp.add_argument("src")
        sp.add_argument("dst")
    sp = sub.add_parser("move", help="Move one end (video file name) to a different archer")
    sp.add_argument("session", type=Path)
    sp.add_argument("video", help="file name (or name without extension) of the end")
    sp.add_argument("dst", help="archer to give it to (new name = new archer)")
    sp = sub.add_parser("spot", help="Show who is in frame and save the shooting spot to track")
    sp.add_argument("target", type=Path, help="session folder (uses its first video) or a video file")
    sp.add_argument("--at", type=float, help="seconds into the video to grab the frame from")
    sp.add_argument("--pick", type=int, help="save person N's spot to <session>/session.yaml")
    sp.add_argument("--session", type=Path, help="session folder to save the spot in (when TARGET is a "
                                                 "recording outside it, e.g. in the incoming folder)")

    args = p.parse_args(argv)
    cfg = _config.load_config(args.config)
    if args.stage in ("sort", "who", "merge", "rename", "move"):
        from . import session as _session
        if args.stage == "sort":
            src = args.incoming or cfg.get("watch", {}).get("incoming")
            if not src:
                raise SystemExit("give --incoming DIR or set watch.incoming in config.yaml")
            vids = _config.list_videos(Path(src))
            print(f"{len(vids)} recording(s) in {src}")
            for v in vids:
                _session.file_recording(v, args.session.resolve(), cfg, move=not args.copy)
            _session.check_duplicates(args.session.resolve(), cfg)
        elif args.stage == "who":
            _session.who(args.session, cfg)
        elif args.stage in ("merge", "rename"):
            _session.merge(args.session, cfg, args.src, args.dst)
        else:
            _session.move_end(args.session, cfg, args.video, args.dst)
        return
    if args.stage in ("session", "watch", "spot", "reel"):
        from . import session as _session
        if args.stage == "reel":
            prof = "fast" if args.fast else "full"
            for name, vids in _session.archers(args.session).items():
                if not args.archer or name in args.archer:
                    _session._build_reel(vids, _session.archer_cfg(cfg, args.session, name, prof))
        elif args.stage == "session":
            _session.run_session(args.session, cfg, "fast" if args.fast else "full", args.archer)
        elif args.stage == "watch":
            _session.watch(args.session, cfg, "full" if args.full else "fast", args.interval, args.settle,
                           args.incoming)
        else:
            _session.spot(args.target, cfg, args.at, args.pick, args.session)
        return
    videos = _config.resolve_videos(cfg, getattr(args, "videos", None) or None)
    if not videos:
        raise SystemExit("no input videos found (check config input.videos or pass paths)")

    # run in dependency order; run-all does the lot
    stage = args.stage
    if stage in ("extract", "run-all"):
        from . import extract_pose
        extract_pose.run(videos, cfg)
    if stage in ("segment", "run-all"):
        from . import segment
        segment.run(videos, cfg)
    if stage in ("hands", "run-all"):
        from . import extract_hands
        extract_hands.run(videos, cfg)
    if stage in ("normalize", "run-all"):
        from . import normalize
        normalize.run(videos, cfg)
    if stage in ("clip", "run-all"):
        from . import clip
        clip.run(videos, cfg)
    if stage in ("compare", "run-all"):
        from . import compare
        compare.run(videos, cfg)
    if stage in ("ghost", "run-all"):
        from . import ghost
        ghost.run(videos, cfg)
    if stage in ("outliers", "run-all"):
        from . import outliers
        outliers.run(videos, cfg)
    if stage in ("report", "run-all"):
        from . import report
        report.run(videos, cfg)


if __name__ == "__main__":
    main()
