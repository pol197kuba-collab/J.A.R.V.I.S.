"""J.A.R.V.I.S. local worker — Etap 05 z planu architektury.

Jedyny proces w całym systemie, który ma prawo dotknąć realnego dysku
użytkownika. Loguje się do Supabase jako zwykły użytkownik (nie service
role), więc RLS na public.local_jobs ogranicza go dokładnie tak samo jak
przeglądarkę — widzi i zmienia wyłącznie własne wiersze.

Pętla jest celowo prosta: brak kolejki w stylu Redis, bo public.local_jobs
już jest tą kolejką (patrz supabase/migrations/20260814120000_local_worker_jobs.sql).
Uruchom: python worker.py
"""

from __future__ import annotations

import os
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
JARVIS_EMAIL = os.environ["JARVIS_EMAIL"]
JARVIS_PASSWORD = os.environ["JARVIS_PASSWORD"]

# Wszystkie akcje na plikach są zamknięte w tym katalogu — nic poza nim nie
# jest osiągalne, niezależnie od tego, co poprosi model (patrz resolve_path).
WORKDIR = Path(os.environ.get("JARVIS_WORKDIR", str(Path.home() / "Jarvis"))).resolve()

POLL_INTERVAL_SECONDS = 2
JOBS_PER_POLL = 5
MAX_READ_CHARS = 200_000
MAX_WRITE_CHARS = 200_000


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def resolve_path(raw: str) -> Path:
    """Resolve a job-supplied path against WORKDIR, refusing any escape."""
    candidate = (WORKDIR / raw).resolve()
    if candidate != WORKDIR and WORKDIR not in candidate.parents:
        raise ValueError(f"path '{raw}' escapes the local working directory")
    return candidate


def run_list_dir(args: dict) -> dict:
    target = resolve_path(str(args.get("path", ".")))
    if not target.exists():
        raise FileNotFoundError(f"'{args.get('path')}' does not exist")
    if not target.is_dir():
        raise NotADirectoryError(f"'{args.get('path')}' is not a directory")
    entries = []
    for child in sorted(target.iterdir()):
        entries.append(
            {
                "name": child.name,
                "is_dir": child.is_dir(),
                "size": child.stat().st_size if child.is_file() else None,
            }
        )
    return {"path": str(target.relative_to(WORKDIR)), "entries": entries}


def run_read_text_file(args: dict) -> dict:
    target = resolve_path(str(args.get("path", "")))
    if not target.is_file():
        raise FileNotFoundError(f"'{args.get('path')}' is not a file")
    text = target.read_text(encoding="utf-8", errors="replace")
    truncated = len(text) > MAX_READ_CHARS
    return {
        "path": str(target.relative_to(WORKDIR)),
        "content": text[:MAX_READ_CHARS],
        "truncated": truncated,
    }


def run_write_text_file(args: dict) -> dict:
    content = str(args.get("content", ""))[:MAX_WRITE_CHARS]
    target = resolve_path(str(args.get("path", "")))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return {"path": str(target.relative_to(WORKDIR)), "bytes_written": len(content.encode("utf-8"))}


ACTIONS = {
    "list_dir": run_list_dir,
    "read_text_file": run_read_text_file,
    "write_text_file": run_write_text_file,
}


def claim_job(client: Client, job: dict) -> bool:
    """Optimistic claim — fails harmlessly if another worker got there first."""
    resp = (
        client.table("local_jobs")
        .update({"status": "claimed", "claimed_at": now_iso()})
        .eq("id", job["id"])
        .eq("status", "pending")
        .execute()
    )
    return len(resp.data) > 0


def finish_job(client: Client, job_id: str, *, result: dict | None = None, error: str | None = None) -> None:
    payload = {"finished_at": now_iso()}
    if error is None:
        payload["status"] = "done"
        payload["result"] = result
    else:
        payload["status"] = "error"
        payload["error"] = error[:2000]
    client.table("local_jobs").update(payload).eq("id", job_id).execute()


def process_job(client: Client, job: dict) -> None:
    handler = ACTIONS.get(job["type"])
    if handler is None:
        finish_job(client, job["id"], error=f"unknown action '{job['type']}'")
        return
    try:
        result = handler(job.get("args") or {})
        finish_job(client, job["id"], result=result)
        print(f"[worker] {job['type']} {job.get('args', {}).get('path')} -> done")
    except Exception as exc:  # noqa: BLE001 — surface any failure back to JARVIS, never crash the loop
        finish_job(client, job["id"], error=str(exc))
        print(f"[worker] {job['type']} failed: {exc}")
        traceback.print_exc()


def main() -> None:
    WORKDIR.mkdir(parents=True, exist_ok=True)
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    session = client.auth.sign_in_with_password({"email": JARVIS_EMAIL, "password": JARVIS_PASSWORD})
    owner_id = session.user.id
    print(f"[worker] signed in as {JARVIS_EMAIL}, working directory: {WORKDIR}")

    while True:
        try:
            resp = (
                client.table("local_jobs")
                .select("id, type, args")
                .eq("owner_id", owner_id)
                .eq("status", "pending")
                .order("created_at")
                .limit(JOBS_PER_POLL)
                .execute()
            )
            for job in resp.data:
                if claim_job(client, job):
                    process_job(client, job)
        except Exception as exc:  # noqa: BLE001 — one bad poll shouldn't kill the worker
            print(f"[worker] poll error: {exc}")
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
