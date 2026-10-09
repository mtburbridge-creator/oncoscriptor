#!/usr/bin/env python3
"""OncoGenik poll script for Hermes.

DRAFT. The owner will tune this with Hermes.

Usage: oncogenik-poll.py <repo-path>

1. git -C <repo> pull --ff-only
2. Read every projects/*/project.json
3. Print "<slug> <task>" for each task with owner hermes and status todo
4. Print NONE if there are none

Standard library only. Exit code 0 whenever the listing ran, even if the
pull failed (the stale checkout is still listed, with a warning on stderr),
so the Hermes cron job can always act on the output. Exit code 2 only when
the argument is missing or not a repo.
"""
import json
import os
import subprocess
import sys


def main(argv):
    if len(argv) != 2:
        sys.stderr.write("usage: oncogenik-poll.py <repo-path>\n")
        return 2
    repo = os.path.abspath(argv[1])
    projects = os.path.join(repo, "projects")
    if not os.path.isdir(os.path.join(repo, ".git")) and not os.path.isdir(projects):
        sys.stderr.write("not an OncoGenik checkout: %s\n" % repo)
        return 2

    try:
        r = subprocess.run(
            ["git", "-C", repo, "pull", "--ff-only", "--quiet"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=120,
        )
        if r.returncode != 0:
            sys.stderr.write("warning: git pull failed, listing stale checkout\n%s" % r.stderr)
    except (OSError, subprocess.TimeoutExpired) as e:
        sys.stderr.write("warning: git pull did not run (%s), listing stale checkout\n" % e)

    lines = []
    if os.path.isdir(projects):
        for slug in sorted(os.listdir(projects)):
            pj = os.path.join(projects, slug, "project.json")
            if not os.path.isfile(pj):
                continue
            try:
                with open(pj, encoding="utf-8") as f:
                    p = json.load(f)
            except (OSError, ValueError) as e:
                sys.stderr.write("warning: skipping %s: %s\n" % (pj, e))
                continue
            tasks = p.get("tasks") or {}
            if not isinstance(tasks, dict):
                continue
            for name in sorted(tasks):
                t = tasks[name]
                if isinstance(t, dict) and t.get("owner") == "hermes" and t.get("status") == "todo":
                    lines.append("%s %s" % (p.get("slug", slug), name))

    if lines:
        print("\n".join(lines))
    else:
        print("NONE")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
