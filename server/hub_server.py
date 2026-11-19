#!/usr/bin/env python3
"""Feature Hub HTTP server: API + static web root."""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from hub_lib import (
    ASSET_EXTENSIONS,
    ROOT_KIND_STATUS,
    create_task,
    entries_to_tasks,
    find_root,
    list_dir,
    list_fs_dirs,
    list_workspace_roots,
    load_config,
    next_task_info,
    open_task_in_cursor,
    public_config,
    public_task_workspace,
    read_tasks_index,
    resolve_viewer,
    safe_join,
    task_git_checkout,
    task_git_status,
    update_dir_paths,
    update_task_workspace,
    validate_dir_path,
    validate_repo_roots,
    write_tasks_index,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_ROOT / "web"
TASKS_INDEX = WEB_DIR / "data" / "tasks.json"


class Handler(BaseHTTPRequestHandler):
    config: dict[str, Any] = {}
    config_path: Path = REPO_ROOT / "hub.config.json"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[feature-hub] {self.address_string()} - {fmt % args}", file=sys.stderr)

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _send_error_json(self, status: int, message: str, extra: dict[str, Any] | None = None) -> None:
        payload: dict[str, Any] = {"error": message}
        if extra:
            payload.update(extra)
        self._send_json(payload, status)

    def _read_json(self) -> Any:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _indexed_entries(self) -> list[dict[str, Any]] | None:
        index = read_tasks_index(TASKS_INDEX)
        if not index:
            return None
        indexed_ws = str(index.get("workspace") or "")
        if indexed_ws and indexed_ws != str(self.config["workspace"]):
            return None
        indexed_archive = str(index.get("archive") or "")
        if indexed_archive and indexed_archive != str(self.config["archive"]):
            return None
        entries = index.get("entries")
        if isinstance(entries, list):
            return entries
        tasks = index.get("tasks")
        if isinstance(tasks, list):
            return [
                {
                    "type": "dir",
                    "name": t.get("name") or t.get("id"),
                    "path": t.get("name") or t.get("id"),
                    "prefix": t.get("prefix", ""),
                    "title": t.get("title", ""),
                    "status": t.get("status", "active"),
                    "rootKind": t.get("rootKind", "workspace"),
                    "mdCount": t.get("mdCount", 0),
                    "fileCount": t.get("fileCount", 0),
                }
                for t in tasks
                if isinstance(t, dict) and (t.get("name") or t.get("id"))
            ]
        return None

    def _resolve_root(self, query: dict[str, list[str]]) -> tuple[str, Path | None, str | None]:
        root_id = (query.get("root") or query.get("task") or [""])[0]
        kind = (query.get("kind") or query.get("rootKind") or [""])[0]
        root_path, resolved_kind = find_root(self.config, root_id, kind or None)
        return root_id, root_path, resolved_kind

    def _serve_static(self, rel_path: str) -> None:
        if rel_path in ("", "/"):
            rel_path = "/index.html"
        rel_path = urllib.parse.unquote(rel_path.lstrip("/"))
        target = (WEB_DIR / rel_path).resolve()
        try:
            target.relative_to(WEB_DIR.resolve())
        except ValueError:
            self._send_error_json(HTTPStatus.FORBIDDEN, "forbidden")
            return
        if not target.is_file():
            self._send_error_json(HTTPStatus.NOT_FOUND, "not found")
            return
        mime, _ = mimetypes.guess_type(str(target))
        self._send(HTTPStatus.OK, target.read_bytes(), mime or "application/octet-stream")

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/config":
            self._send_json(public_config(self.config))
            return

        if path == "/api/roots":
            indexed = self._indexed_entries()
            entries = indexed if indexed is not None else list_workspace_roots(self.config)
            self._send_json({"entries": entries})
            return

        if path == "/api/tasks":
            indexed = self._indexed_entries()
            if indexed is not None:
                self._send_json({"tasks": entries_to_tasks(indexed)})
                return
            roots = list_workspace_roots(self.config)
            self._send_json({"tasks": entries_to_tasks(roots)})
            return

        if path == "/api/tasks/next-id":
            try:
                self._send_json(next_task_info(self.config))
            except ValueError as exc:
                self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return

        if path == "/api/fs/ls":
            raw = (query.get("path") or [""])[0]
            try:
                self._send_json(list_fs_dirs(raw, self.config))
            except ValueError as exc:
                self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return

        if path == "/api/task/workspace":
            root_id, _, root_kind = self._resolve_root(query)
            try:
                self._send_json(
                    public_task_workspace(self.config, root_id, root_kind or None)
                )
            except ValueError as exc:
                self._send_error_json(HTTPStatus.NOT_FOUND, str(exc))
            return

        if path == "/api/task/git-status":
            root_id, _, root_kind = self._resolve_root(query)
            try:
                self._send_json(
                    task_git_status(self.config, root_id, root_kind or None)
                )
            except ValueError as exc:
                self._send_error_json(HTTPStatus.NOT_FOUND, str(exc))
            return

        if path == "/api/ls":
            root_id, root_path, root_kind = self._resolve_root(query)
            rel = (query.get("path") or [""])[0]
            if not root_path or not root_kind:
                self._send_error_json(HTTPStatus.NOT_FOUND, "unknown folder")
                return
            target = safe_join(root_path, rel)
            if target is None or not target.is_dir():
                self._send_error_json(HTTPStatus.NOT_FOUND, "directory not found")
                return
            rel_out = (
                ""
                if target == root_path
                else target.relative_to(root_path).as_posix()
            )
            self._send_json(
                {
                    "root": root_id,
                    "rootKind": root_kind,
                    "status": ROOT_KIND_STATUS.get(root_kind, "active"),
                    "path": rel_out,
                    "entries": list_dir(target, root_path, self.config),
                }
            )
            return

        if path == "/api/file":
            root_id, root_path, root_kind = self._resolve_root(query)
            rel = (query.get("path") or [""])[0]
            if not root_path or not root_kind:
                self._send_error_json(HTTPStatus.NOT_FOUND, "unknown folder")
                return
            target = safe_join(root_path, rel)
            if target is None or not target.is_file():
                self._send_error_json(HTTPStatus.NOT_FOUND, "file not found")
                return
            suffix = target.suffix.lower()
            viewer = resolve_viewer(
                suffix, self.config["text_extensions"], self.config["viewers"]
            )
            if viewer is None:
                self._send_error_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "not a text file")
                return
            text = target.read_text(encoding="utf-8", errors="replace")
            st = target.stat()
            self._send_json(
                {
                    "root": root_id,
                    "rootKind": root_kind,
                    "status": ROOT_KIND_STATUS.get(root_kind, "active"),
                    "path": target.relative_to(root_path).as_posix(),
                    "name": target.name,
                    "ext": suffix.lstrip("."),
                    "viewer": viewer,
                    "markdown": viewer.get("type") == "markdown",
                    "mtimeNs": getattr(st, "st_mtime_ns", int(st.st_mtime * 1_000_000_000)),
                    "content": text,
                }
            )
            return

        if path == "/api/asset":
            root_id, root_path, root_kind = self._resolve_root(query)
            rel = (query.get("path") or [""])[0]
            if not root_path:
                self._send_error_json(HTTPStatus.NOT_FOUND, "unknown folder")
                return
            target = safe_join(root_path, rel)
            if target is None or not target.is_file():
                self._send_error_json(HTTPStatus.NOT_FOUND, "asset not found")
                return
            if target.suffix.lower() not in ASSET_EXTENSIONS:
                self._send_error_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "not an asset")
                return
            mime, _ = mimetypes.guess_type(str(target))
            self._send(
                HTTPStatus.OK,
                target.read_bytes(),
                mime or "application/octet-stream",
            )
            return

        self._serve_static(path)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            body = self._read_json()
        except json.JSONDecodeError:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "invalid JSON")
            return
        if not isinstance(body, dict):
            self._send_error_json(HTTPStatus.BAD_REQUEST, "body must be an object")
            return

        if path == "/api/tasks":
            try:
                task = create_task(
                    self.config,
                    body.get("title"),
                    body.get("repo"),
                    repos=body.get("repos"),
                    index_path=TASKS_INDEX,
                )
            except ValueError as exc:
                self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
                return
            self._send_json({"task": task})
            return

        if path == "/api/tasks/rebuild":
            try:
                payload = write_tasks_index(self.config, TASKS_INDEX)
            except OSError as exc:
                self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))
                return
            self._send_json(
                {
                    "ok": True,
                    "generatedAt": payload.get("generatedAt"),
                    "workspace": payload.get("workspace"),
                    "archive": payload.get("archive"),
                    "taskCount": len(payload.get("tasks") or []),
                    "entryCount": len(payload.get("entries") or []),
                }
            )
            return

        if path == "/api/task/open-cursor":
            try:
                result = open_task_in_cursor(
                    self.config,
                    str(body.get("root") or body.get("task") or ""),
                    root_kind=body.get("kind") or body.get("rootKind"),
                )
            except ValueError as exc:
                self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
                return
            self._send_json(result)
            return

        if path == "/api/task/git-checkout":
            try:
                result = task_git_checkout(
                    self.config,
                    str(body.get("root") or body.get("task") or ""),
                    str(body.get("path") or ""),
                    str(body.get("branch") or ""),
                    root_kind=body.get("kind") or body.get("rootKind"),
                )
            except ValueError as exc:
                self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
                return
            self._send_json(result)
            return

        if path == "/api/config/validate":
            if "path" in body:
                require_exists = bool(body.get("requireExists"))
                key = str(body.get("key") or "")
                if key == "workspace":
                    require_exists = True
                self._send_json(
                    validate_dir_path(body.get("path"), require_exists=require_exists)
                )
                return

            fields: dict[str, Any] = {}
            for key in ("workspace", "knowledge", "archive", "tools"):
                if key in body:
                    fields[key] = validate_dir_path(
                        body.get(key),
                        require_exists=(key == "workspace"),
                    )
            if "repoRoots" in body or "repos" in body:
                repo_statuses, _, repo_ok = validate_repo_roots(
                    body.get("repoRoots", body.get("repos"))
                )
                fields["repoRoots"] = repo_statuses
                # Empty list is ok; mark aggregate for callers that expect bool.
                if not repo_ok:
                    fields["repoRootsOk"] = False
            if not fields:
                self._send_error_json(HTTPStatus.BAD_REQUEST, "no paths to validate")
                return
            ok = True
            for key, value in fields.items():
                if key == "repoRoots":
                    if isinstance(value, list) and any(
                        isinstance(item, dict) and not item.get("ok") for item in value
                    ):
                        ok = False
                    continue
                if key == "repoRootsOk":
                    continue
                if isinstance(value, dict) and not value.get("ok"):
                    ok = False
            self._send_json({"ok": ok, "fields": fields})
            return

        self._send_error_json(HTTPStatus.NOT_FOUND, "not found")

    def do_PUT(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            body = self._read_json()
        except json.JSONDecodeError:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "invalid JSON")
            return
        if not isinstance(body, dict):
            self._send_error_json(HTTPStatus.BAD_REQUEST, "body must be an object")
            return

        if path == "/api/task/workspace":
            try:
                payload = update_task_workspace(
                    self.config,
                    str(body.get("root") or body.get("task") or ""),
                    body.get("folders"),
                    root_kind=body.get("kind") or body.get("rootKind"),
                )
            except ValueError as exc:
                self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
                return
            except OSError as exc:
                self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))
                return
            self._send_json(payload)
            return

        if path != "/api/config":
            self._send_error_json(HTTPStatus.NOT_FOUND, "not found")
            return

        prev_workspace = str(self.config.get("workspace"))
        config, err = update_dir_paths(self.config_path, body)
        if err is not None:
            self._send_error_json(HTTPStatus.BAD_REQUEST, err.get("error", "invalid"), err)
            return
        assert config is not None
        Handler.config = config
        self.config = config

        rebuilt = False
        if str(config["workspace"]) != prev_workspace:
            write_tasks_index(config, TASKS_INDEX)
            rebuilt = True
        elif not TASKS_INDEX.is_file():
            write_tasks_index(config, TASKS_INDEX)
            rebuilt = True

        payload = public_config(config)
        payload["rebuiltIndex"] = rebuilt
        self._send_json(payload)


def main() -> None:
    parser = argparse.ArgumentParser(description="Feature Hub local reader")
    parser.add_argument(
        "--config",
        default=str(REPO_ROOT / "hub.config.json"),
        help="path to hub.config.json",
    )
    args = parser.parse_args()

    config_path = Path(args.config).expanduser().resolve()
    if not config_path.is_file():
        raise SystemExit(f"config not found: {config_path}")

    config = load_config(config_path)
    Handler.config = config
    Handler.config_path = config_path

    host = config["host"]
    port = config["port"]
    server = ThreadingHTTPServer((host, port), Handler)

    indexed = read_tasks_index(TASKS_INDEX)
    index_fresh = (
        indexed
        and isinstance(indexed.get("entries"), list)
        and str(indexed.get("workspace") or "") == str(config["workspace"])
        and (
            not indexed.get("archive")
            or str(indexed.get("archive") or "") == str(config["archive"])
        )
    )
    roots = indexed.get("entries") if index_fresh else list_workspace_roots(config)
    print(f"Feature Hub listening on http://{host}:{port}", flush=True)
    print(f"  workspace: {config['workspace']}", flush=True)
    print(f"  knowledge: {config['knowledge']}", flush=True)
    print(f"  archive:   {config['archive']}", flush=True)
    print(f"  tools:     {config['tools']}", flush=True)
    print(f"  roots:     {len(roots)}", flush=True)
    print(f"  index:     {TASKS_INDEX if indexed else '(live scan)'}", flush=True)
    print(f"  viewers:   {len(config['viewers'])}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
