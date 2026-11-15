#!/usr/bin/env python3
"""Feature Hub: config parsing, path safety, workspace indexing."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_TEXT_EXTENSIONS = [
    ".md",
    ".markdown",
    ".mdown",
    ".mkd",
    ".mdx",
    ".txt",
    ".text",
    ".json",
    ".code-workspace",
    ".yaml",
    ".yml",
    ".toml",
    ".csv",
    ".log",
    ".py",
    ".js",
    ".ts",
    ".css",
    ".html",
    ".sh",
    ".rs",
    ".go",
    ".java",
    ".c",
    ".cpp",
    ".h",
]

DEFAULT_VIEWERS: dict[str, dict[str, str]] = {
    ".md": {"type": "markdown"},
    ".markdown": {"type": "markdown"},
    ".mdown": {"type": "markdown"},
    ".mkd": {"type": "markdown"},
    ".mdx": {"type": "markdown"},
    ".json": {"type": "json"},
    ".code-workspace": {"type": "json"},
    ".yaml": {"type": "code", "language": "yaml"},
    ".yml": {"type": "code", "language": "yaml"},
    ".toml": {"type": "code", "language": "toml"},
    ".py": {"type": "code", "language": "python"},
    ".js": {"type": "code", "language": "javascript"},
    ".ts": {"type": "code", "language": "typescript"},
    ".css": {"type": "code", "language": "css"},
    ".html": {"type": "code", "language": "xml"},
    ".sh": {"type": "code", "language": "bash"},
    ".rs": {"type": "code", "language": "rust"},
    ".go": {"type": "code", "language": "go"},
    ".java": {"type": "code", "language": "java"},
    ".c": {"type": "code", "language": "c"},
    ".cpp": {"type": "code", "language": "cpp"},
    ".h": {"type": "code", "language": "c"},
    ".txt": {"type": "plain"},
    ".text": {"type": "plain"},
    ".csv": {"type": "plain"},
    ".log": {"type": "plain"},
}

ASSET_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".bmp",
    ".ico",
}

VALID_VIEWER_TYPES = {"markdown", "json", "code", "plain"}

DIR_KEYS = ("workspace", "knowledge", "archive", "tools")

DEFAULT_DIRS: dict[str, str] = {
    "workspace": "~/workspace",
    "knowledge": "~/knowledge",
    "archive": "~/archive",
    "tools": "~/toolbox",
}

DIR_LABELS: dict[str, str] = {
    "workspace": "Workspace",
    "knowledge": "领域知识",
    "archive": "归档",
    "tools": "工具",
}


def expand_path(raw: str) -> Path:
    return Path(os.path.expanduser(raw)).resolve()


def normalize_dir_raw(raw: Any) -> str:
    return str(raw or "").strip()


def validate_dir_path(raw: Any, *, require_exists: bool = False) -> dict[str, Any]:
    text = normalize_dir_raw(raw)
    if not text:
        return {
            "ok": False,
            "raw": text,
            "resolved": None,
            "exists": False,
            "error": "路径不能为空",
        }
    try:
        resolved = expand_path(text)
    except (OSError, RuntimeError) as exc:
        return {
            "ok": False,
            "raw": text,
            "resolved": None,
            "exists": False,
            "error": f"无法解析路径：{exc}",
        }

    exists = resolved.is_dir()
    if resolved.exists() and not resolved.is_dir():
        return {
            "ok": False,
            "raw": text,
            "resolved": str(resolved),
            "exists": False,
            "error": "不是目录",
        }
    if require_exists and not exists:
        return {
            "ok": False,
            "raw": text,
            "resolved": str(resolved),
            "exists": False,
            "error": "路径不存在",
        }
    return {
        "ok": True,
        "raw": text,
        "resolved": str(resolved),
        "exists": exists,
        "error": None if exists else "目录尚不存在（可先保存）",
    }


def normalize_repo_roots(raw: Any) -> list[str]:
    items: list[Any]
    if raw is None:
        items = []
    elif isinstance(raw, list):
        items = raw
    elif isinstance(raw, str):
        items = [raw]
    else:
        items = []

    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        text = normalize_dir_raw(item)
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


def validate_repo_roots(raw: Any) -> tuple[list[dict[str, Any]], list[str], bool]:
    """Return (statuses, accepted_raws, all_ok). Empty list is valid."""
    texts = normalize_repo_roots(raw)
    statuses: list[dict[str, Any]] = []
    accepted: list[str] = []
    all_ok = True
    seen_resolved: set[str] = set()
    for text in texts:
        status = validate_dir_path(text, require_exists=False)
        statuses.append(status)
        if not status["ok"]:
            all_ok = False
            continue
        resolved = str(status.get("resolved") or "")
        if resolved and resolved in seen_resolved:
            continue
        if resolved:
            seen_resolved.add(resolved)
        accepted.append(status["raw"])
    return statuses, accepted, all_ok


def public_repo_roots(config: dict[str, Any]) -> list[dict[str, Any]]:
    raws = list(config.get("repo_roots_raw") or [])
    out: list[dict[str, Any]] = []
    for raw in raws:
        status = validate_dir_path(raw, require_exists=False)
        out.append(
            {
                "raw": status["raw"],
                "resolved": status.get("resolved"),
                "ok": bool(status["ok"]),
                "exists": bool(status.get("exists")),
                "error": status.get("error"),
            }
        )
    return out


def public_config(config: dict[str, Any]) -> dict[str, Any]:
    dirs: dict[str, Any] = {}
    for key in DIR_KEYS:
        raw = str(config.get("dirs_raw", {}).get(key, DEFAULT_DIRS[key]))
        resolved = config.get(key)
        status = validate_dir_path(raw, require_exists=(key == "workspace"))
        dirs[key] = {
            "label": DIR_LABELS[key],
            "raw": raw,
            "resolved": str(resolved) if resolved is not None else status.get("resolved"),
            "ok": bool(status["ok"]),
            "exists": bool(status.get("exists")),
            "error": status.get("error"),
        }
    repo_roots = public_repo_roots(config)
    return {
        "host": config["host"],
        "port": config["port"],
        "workspace": dirs["workspace"]["raw"],
        "knowledge": dirs["knowledge"]["raw"],
        "archive": dirs["archive"]["raw"],
        "tools": dirs["tools"]["raw"],
        "repoRoots": [item["raw"] for item in repo_roots],
        "dirs": dirs,
        "repoRootEntries": repo_roots,
        "rootPattern": config["root_pattern"],
        "textExtensions": sorted(config["text_extensions"]),
        "viewers": config["viewers"],
    }


def read_config_file(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError("config root must be an object")
    return data


def write_config_file(path: Path, data: dict[str, Any]) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def update_dir_paths(
    config_path: Path,
    updates: dict[str, Any],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Validate and persist directory paths. Returns (config, error_payload)."""
    if not isinstance(updates, dict):
        return None, {"error": "body must be an object", "fields": {}}

    fields: dict[str, Any] = {}
    next_raw: dict[str, str] = {}
    for key in DIR_KEYS:
        if key not in updates:
            continue
        status = validate_dir_path(
            updates.get(key),
            require_exists=(key == "workspace"),
        )
        fields[key] = status
        if status["ok"]:
            next_raw[key] = status["raw"]

    next_repo_roots: list[str] | None = None
    if "repoRoots" in updates or "repos" in updates:
        repo_raw = updates.get("repoRoots", updates.get("repos"))
        repo_statuses, accepted, repo_ok = validate_repo_roots(repo_raw)
        fields["repoRoots"] = repo_statuses
        if not repo_ok:
            return None, {"error": "仓库集校验失败", "fields": fields}
        next_repo_roots = accepted

    if any(not fields[k]["ok"] for k in fields if k in DIR_KEYS):
        return None, {"error": "目录校验失败", "fields": fields}

    if not next_raw and next_repo_roots is None:
        return None, {"error": "未提供可更新的目录字段", "fields": {}}

    # Saving a partial update still requires a valid workspace on disk.
    data = read_config_file(config_path)
    merged = {
        key: normalize_dir_raw(data.get(key, DEFAULT_DIRS[key])) or DEFAULT_DIRS[key]
        for key in DIR_KEYS
    }
    merged.update(next_raw)
    workspace_status = validate_dir_path(merged["workspace"], require_exists=True)
    if not workspace_status["ok"]:
        fields["workspace"] = workspace_status
        return None, {"error": "Workspace 目录无效", "fields": fields}

    for key, raw in next_raw.items():
        data[key] = raw
    if next_repo_roots is not None:
        data["repoRoots"] = next_repo_roots
    write_config_file(config_path, data)
    return load_config(config_path), None


def normalize_ext(raw: str) -> str:
    ext = str(raw or "").strip().lower()
    if not ext:
        return ""
    return ext if ext.startswith(".") else f".{ext}"


def normalize_viewer(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    viewer_type = str(raw.get("type", "")).strip().lower()
    if viewer_type not in VALID_VIEWER_TYPES:
        return None
    out: dict[str, str] = {"type": viewer_type}
    language = str(raw.get("language", "")).strip()
    if language:
        out["language"] = language
    elif viewer_type == "code":
        out["language"] = "plaintext"
    return out


def merge_text_extensions(data: dict[str, Any]) -> set[str]:
    exts = {normalize_ext(x) for x in DEFAULT_TEXT_EXTENSIONS}
    custom = data.get("textExtensions")
    if isinstance(custom, list):
        for item in custom:
            ext = normalize_ext(item)
            if ext:
                exts.add(ext)
    return {e for e in exts if e}


def merge_viewers(data: dict[str, Any]) -> dict[str, dict[str, str]]:
    viewers: dict[str, dict[str, str]] = {
        ext: dict(spec) for ext, spec in DEFAULT_VIEWERS.items()
    }
    custom = data.get("viewers")
    if isinstance(custom, dict):
        for key, value in custom.items():
            ext = normalize_ext(key)
            spec = normalize_viewer(value)
            if ext and spec:
                viewers[ext] = spec
    return viewers


def resolve_viewer(
    ext: str,
    text_extensions: set[str],
    viewers: dict[str, dict[str, str]],
) -> dict[str, str] | None:
    """Return viewer spec if readable; viewers imply readable."""
    if ext in viewers:
        return dict(viewers[ext])
    if ext in text_extensions:
        return {"type": "plain"}
    return None


def load_config(path: Path) -> dict[str, Any]:
    data = read_config_file(path)

    dirs_raw: dict[str, str] = {}
    dirs_resolved: dict[str, Path] = {}
    for key in DIR_KEYS:
        raw = normalize_dir_raw(data.get(key, DEFAULT_DIRS[key])) or DEFAULT_DIRS[key]
        dirs_raw[key] = raw
        dirs_resolved[key] = expand_path(raw)

    repo_roots_raw = normalize_repo_roots(data.get("repoRoots", data.get("repos")))
    repo_roots_resolved: list[Path] = []
    for raw in repo_roots_raw:
        try:
            repo_roots_resolved.append(expand_path(raw))
        except (OSError, RuntimeError):
            continue

    pattern = str(data.get("taskPattern", r"^\d{2}-.+"))
    try:
        root_re = re.compile(pattern)
    except re.error as exc:
        raise SystemExit(f"invalid taskPattern: {exc}") from exc

    text_extensions = merge_text_extensions(data)
    viewers = merge_viewers(data)
    # Any mapped viewer is readable.
    text_extensions |= set(viewers.keys())

    cursor_bin = normalize_dir_raw(data.get("cursorBin"))

    return {
        "host": str(data.get("host", "127.0.0.1")),
        "port": int(data.get("port", 9527)),
        "config_path": path.resolve(),
        "dirs_raw": dirs_raw,
        "repo_roots_raw": repo_roots_raw,
        "workspace": dirs_resolved["workspace"],
        "knowledge": dirs_resolved["knowledge"],
        "archive": dirs_resolved["archive"],
        "tools": dirs_resolved["tools"],
        "repo_roots": repo_roots_resolved,
        "cursor_bin": cursor_bin or None,
        "root_re": root_re,
        "root_pattern": pattern,
        "text_extensions": text_extensions,
        "viewers": viewers,
    }


ROOT_KINDS = ("workspace", "archive")

ROOT_KIND_STATUS: dict[str, str] = {
    "workspace": "active",
    "archive": "done",
}


def normalize_root_kind(raw: Any) -> str | None:
    kind = str(raw or "").strip().lower()
    if kind in ROOT_KINDS:
        return kind
    return None


def base_for_kind(config: dict[str, Any], kind: str) -> Path | None:
    if kind not in ROOT_KINDS:
        return None
    base = config.get(kind)
    return base if isinstance(base, Path) else None


def find_root(
    config: dict[str, Any],
    root_id: str,
    root_kind: Any = None,
) -> tuple[Path | None, str | None]:
    """Resolve a task folder. Returns (path, kind)."""
    if not root_id or "/" in root_id or "\\" in root_id or root_id in (".", ".."):
        return None, None
    if not config["root_re"].match(root_id):
        return None, None

    kind = normalize_root_kind(root_kind)
    kinds = (kind,) if kind else ROOT_KINDS
    for candidate_kind in kinds:
        base = base_for_kind(config, candidate_kind)
        if base is None or not base.is_dir():
            continue
        candidate = (base / root_id).resolve()
        try:
            candidate.relative_to(base.resolve())
        except ValueError:
            continue
        if candidate.is_dir():
            return candidate, candidate_kind
    return None, None


def safe_join(root_path: Path, relative: str) -> Path | None:
    relative = urllib.parse.unquote(relative or "").lstrip("/")
    if not relative:
        return root_path
    candidate = (root_path / relative).resolve()
    try:
        candidate.relative_to(root_path)
    except ValueError:
        return None
    return candidate


def _visible_children(directory: Path) -> list[Path]:
    try:
        return [c for c in directory.iterdir() if not c.name.startswith(".")]
    except PermissionError:
        return []


def _dir_item_count(directory: Path) -> int:
    return len(_visible_children(directory))


def _tree_file_stats(directory: Path) -> tuple[int, int]:
    md_count = 0
    file_count = 0
    try:
        for path in directory.rglob("*"):
            try:
                rel_parts = path.relative_to(directory).parts
            except ValueError:
                continue
            if any(part.startswith(".") for part in rel_parts):
                continue
            if not path.is_file():
                continue
            file_count += 1
            if path.suffix.lower() in {".md", ".markdown"}:
                md_count += 1
    except PermissionError:
        pass
    return md_count, file_count


def entry_payload(child: Path, root_path: Path, config: dict[str, Any]) -> dict[str, Any]:
    rel = child.relative_to(root_path).as_posix()
    if child.is_dir():
        return {
            "type": "dir",
            "name": child.name,
            "path": rel,
            "itemCount": _dir_item_count(child),
        }
    suffix = child.suffix.lower()
    viewer = resolve_viewer(suffix, config["text_extensions"], config["viewers"])
    size_bytes = 0
    try:
        size_bytes = child.stat().st_size
    except OSError:
        size_bytes = 0
    payload: dict[str, Any] = {
        "type": "file",
        "name": child.name,
        "path": rel,
        "ext": suffix.lstrip("."),
        "size": size_bytes,
        "readable": viewer is not None,
        "markdown": bool(viewer and viewer.get("type") == "markdown"),
    }
    if viewer:
        payload["viewer"] = viewer
    return payload


def list_kind_roots(config: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    kind = normalize_root_kind(kind) or ""
    base = base_for_kind(config, kind)
    root_re: re.Pattern[str] = config["root_re"]
    if base is None or not base.is_dir():
        return []

    status = ROOT_KIND_STATUS.get(kind, "active")
    entries: list[dict[str, Any]] = []
    try:
        children = sorted(base.iterdir(), key=lambda p: p.name.lower())
    except PermissionError:
        return []

    for child in children:
        if not child.is_dir() or child.name.startswith("."):
            continue
        if not root_re.match(child.name):
            continue
        md_count, file_count = _tree_file_stats(child)
        entries.append(
            {
                "type": "dir",
                "name": child.name,
                "path": child.name,
                "prefix": child.name.split("-", 1)[0],
                "title": child.name.split("-", 1)[1] if "-" in child.name else child.name,
                "status": status,
                "rootKind": kind,
                "mdCount": md_count,
                "fileCount": file_count,
            }
        )
    return entries


def list_workspace_roots(config: dict[str, Any]) -> list[dict[str, Any]]:
    """All task roots: workspace (active) then archive (done)."""
    return list_kind_roots(config, "workspace") + list_kind_roots(config, "archive")


def list_dir(directory: Path, root_path: Path, config: dict[str, Any]) -> list[dict[str, Any]]:
    if not directory.is_dir():
        return []
    entries: list[dict[str, Any]] = []
    try:
        children = sorted(
            directory.iterdir(),
            key=lambda p: (not p.is_dir(), p.name.lower()),
        )
    except PermissionError:
        return []

    for child in children:
        if child.name.startswith("."):
            continue
        entries.append(entry_payload(child, root_path, config))
    return entries


def entries_to_tasks(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": e["name"],
            "name": e["name"],
            "prefix": e["prefix"],
            "title": e["title"],
            "status": e.get("status", "active"),
            "rootKind": e.get("rootKind", "workspace"),
            "mdCount": e.get("mdCount", 0),
            "fileCount": e.get("fileCount", 0),
        }
        for e in entries
    ]


TASK_WORKSPACE_NAME = "main.code-workspace"
_TASK_PREFIX_RE = re.compile(r"^(\d+)-")

# Default Cursor/VS Code settings baked into new task workspaces.
DEFAULT_WORKSPACE_SETTINGS: dict[str, Any] = {
    "git.autoRepositoryDetection": "openEditors",
    "git.repositoryScanMaxDepth": 0,
    "git.autorefresh": False,
    "git.autofetch": False,
    "search.followSymlinks": False,
    "files.watcherExclude": {
        "**/target/**": True,
        "**/vendor/**": True,
        "**/node_modules/**": True,
        "**/.git/objects/**": True,
        "**/.git/subtree-cache/**": True,
    },
    "search.exclude": {
        "**/target": True,
        "**/vendor": True,
        "**/node_modules": True,
    },
    "files.exclude": {
        "**/target": True,
    },
}


def _workspace_folder_path(dest: Path, target: Path) -> str:
    """Prefer a short relative path; fall back to absolute when too deep."""
    dest_r = Path(os.path.realpath(dest))
    target_r = Path(os.path.realpath(target))
    try:
        rel = Path(os.path.relpath(target_r, dest_r)).as_posix()
    except ValueError:
        return target_r.as_posix()
    ups = 0
    for part in Path(rel).parts:
        if part == "..":
            ups += 1
        else:
            break
    if ups > 4:
        return target_r.as_posix()
    return rel


def default_workspace_settings() -> dict[str, Any]:
    return json.loads(json.dumps(DEFAULT_WORKSPACE_SETTINGS))


def build_task_code_workspace(
    title: str,
    dest: Path,
    repo_paths: list[str] | None = None,
) -> dict[str, Any]:
    """Build a VS Code / Cursor multi-root workspace for a new task."""
    folders: list[dict[str, str]] = [
        {"name": title, "path": "."},
    ]
    for raw in repo_paths or []:
        repo = Path(raw).expanduser().resolve()
        path = _workspace_folder_path(dest, repo)
        folders.append(
            {
                "name": repo.name or path,
                "path": path,
            }
        )
    return {"folders": folders, "settings": default_workspace_settings()}


def task_title_from_id(root_id: str) -> str:
    text = str(root_id or "").strip()
    match = _TASK_PREFIX_RE.match(text)
    if match:
        return text[match.end() :] or text
    if "-" in text:
        return text.split("-", 1)[1] or text
    return text


def task_workspace_path(root_path: Path) -> Path:
    return root_path / TASK_WORKSPACE_NAME


def _normalize_workspace_folder_entry(
    raw: Any,
    *,
    dest: Path,
) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    path_text = normalize_dir_raw(raw.get("path"))
    if not path_text:
        return None
    name = str(raw.get("name") or "").strip()
    locked = path_text in {".", "./"}
    if locked:
        path_text = "."
        resolved = str(dest.resolve())
        exists = dest.is_dir()
        ok = True
        error = None
    else:
        candidate = Path(path_text)
        if not candidate.is_absolute():
            candidate = (dest / candidate).resolve()
        else:
            candidate = candidate.expanduser().resolve()
        status = validate_dir_path(str(candidate), require_exists=False)
        ok = bool(status["ok"])
        error = status.get("error")
        exists = bool(status.get("exists"))
        resolved = status.get("resolved")
        path_text = _workspace_folder_path(dest, candidate) if ok and resolved else path_text
        if not name and resolved:
            name = Path(str(resolved)).name
    if not name:
        name = Path(path_text).name or path_text
    return {
        "name": name,
        "path": path_text,
        "resolved": resolved,
        "ok": ok,
        "exists": exists,
        "locked": locked,
        "error": error,
    }


def ensure_task_workspace_doc(root_path: Path, root_id: str) -> dict[str, Any]:
    """Load main.code-workspace or synthesize a default document."""
    path = task_workspace_path(root_path)
    data: dict[str, Any] | None = None
    if path.is_file():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                data = loaded
        except (OSError, json.JSONDecodeError):
            data = None
    if data is None:
        data = build_task_code_workspace(task_title_from_id(root_id), root_path)

    folders_raw = data.get("folders")
    if not isinstance(folders_raw, list):
        folders_raw = []
    folders: list[dict[str, Any]] = []
    seen: set[str] = set()
    has_dot = False
    for item in folders_raw:
        entry = _normalize_workspace_folder_entry(item, dest=root_path)
        if entry is None:
            continue
        key = str(entry.get("resolved") or entry["path"])
        if key in seen:
            continue
        seen.add(key)
        if entry["locked"]:
            has_dot = True
        folders.append(entry)

    if not has_dot:
        folders.insert(
            0,
            {
                "name": task_title_from_id(root_id),
                "path": ".",
                "resolved": str(root_path.resolve()),
                "ok": True,
                "exists": root_path.is_dir(),
                "locked": True,
                "error": None,
            },
        )

    settings = data.get("settings")
    if not isinstance(settings, dict):
        settings = {}
    return {
        "folders": folders,
        "settings": settings,
        "exists": path.is_file(),
        "path": str(path),
    }


def public_task_workspace(
    config: dict[str, Any],
    root_id: str,
    root_kind: Any = None,
) -> dict[str, Any]:
    root_path, kind = find_root(config, root_id, root_kind)
    if root_path is None or kind is None:
        raise ValueError("unknown folder")
    doc = ensure_task_workspace_doc(root_path, root_id)
    return {
        "root": root_id,
        "rootKind": kind,
        "status": ROOT_KIND_STATUS.get(kind, "active"),
        "title": task_title_from_id(root_id),
        "workspaceFile": doc["path"],
        "exists": doc["exists"],
        "folders": doc["folders"],
        "settings": doc["settings"],
        "editable": kind != "archive",
    }


def update_task_workspace(
    config: dict[str, Any],
    root_id: str,
    folders_raw: Any,
    *,
    root_kind: Any = None,
) -> dict[str, Any]:
    root_path, kind = find_root(config, root_id, root_kind)
    if root_path is None or kind is None:
        raise ValueError("unknown folder")
    if kind == "archive":
        raise ValueError("归档任务不可编辑 Workspace")
    if not isinstance(folders_raw, list):
        raise ValueError("folders 必须是数组")

    current = ensure_task_workspace_doc(root_path, root_id)
    next_folders: list[dict[str, str]] = []
    seen: set[str] = set()
    has_dot = False

    for item in folders_raw:
        entry = _normalize_workspace_folder_entry(item, dest=root_path)
        if entry is None:
            raise ValueError("folders 项无效")
        if not entry["ok"]:
            raise ValueError(entry.get("error") or f"无效路径：{entry['path']}")
        key = str(entry.get("resolved") or entry["path"])
        if key in seen:
            continue
        seen.add(key)
        if entry["locked"]:
            has_dot = True
            next_folders.insert(
                0,
                {
                    "name": str(entry["name"] or task_title_from_id(root_id)),
                    "path": ".",
                },
            )
            continue
        # External folders should exist when saving.
        status = validate_dir_path(entry.get("resolved") or entry["path"], require_exists=True)
        if not status["ok"]:
            raise ValueError(status.get("error") or f"目录不存在：{entry['path']}")
        next_folders.append(
            {
                "name": str(entry["name"]),
                "path": _workspace_folder_path(root_path, Path(str(status["resolved"]))),
            }
        )

    if not has_dot:
        next_folders.insert(
            0,
            {"name": task_title_from_id(root_id), "path": "."},
        )

    # Keep first "." unique at front.
    deduped: list[dict[str, str]] = []
    seen_paths: set[str] = set()
    for folder in next_folders:
        path = folder["path"]
        if path in seen_paths:
            continue
        seen_paths.add(path)
        deduped.append(folder)
    if deduped and deduped[0]["path"] != ".":
        rest = [f for f in deduped if f["path"] != "."]
        head = next((f for f in deduped if f["path"] == "."), None)
        if head is None:
            head = {"name": task_title_from_id(root_id), "path": "."}
        deduped = [head, *rest]

    payload = {
        "folders": deduped,
        "settings": current.get("settings") or {},
    }
    out_path = task_workspace_path(root_path)
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return public_task_workspace(config, root_id, kind)


def resolve_cursor_bin(config: dict[str, Any] | None = None) -> str | None:
    """Find the Cursor CLI for launching classic editor windows."""
    candidates: list[str] = []
    configured = None
    if config:
        configured = config.get("cursor_bin") or config.get("cursorBin")
    if configured:
        candidates.append(str(configured))

    which = shutil.which("cursor")
    if which:
        candidates.append(which)

    home = Path.home()
    candidates.extend(
        [
            "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
            str(home / "Applications/Cursor.app/Contents/Resources/app/bin/cursor"),
            "/usr/local/bin/cursor",
            str(home / ".local/bin/cursor"),
        ]
    )

    seen: set[str] = set()
    for raw in candidates:
        text = normalize_dir_raw(raw)
        if not text or text in seen:
            continue
        seen.add(text)
        try:
            path = Path(text).expanduser()
            if not path.is_absolute():
                found = shutil.which(text)
                path = Path(found) if found else path
            path = path.resolve()
        except (OSError, RuntimeError):
            continue
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
    return None


def open_task_in_cursor(
    config: dict[str, Any],
    root_id: str,
    *,
    root_kind: Any = None,
) -> dict[str, Any]:
    root_path, kind = find_root(config, root_id, root_kind)
    if root_path is None or kind is None:
        raise ValueError("unknown folder")

    ws = task_workspace_path(root_path)
    target = ws if ws.is_file() else root_path
    target_s = str(target.resolve())

    cursor_bin = resolve_cursor_bin(config)
    if not cursor_bin:
        raise ValueError(
            "未找到 Cursor CLI。请在 Cursor 中执行 “Shell Command: Install 'cursor' command in PATH”，"
            "或在 hub.config.json 设置 cursorBin 为可执行文件路径"
            "（例如 /Applications/Cursor.app/Contents/Resources/app/bin/cursor）"
        )

    subprocess.Popen(  # noqa: S603
        [cursor_bin, "--classic", target_s],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return {
        "ok": True,
        "opened": target_s,
        "method": "cursor --classic",
        "cursorBin": cursor_bin,
        "root": root_id,
        "rootKind": kind,
    }


def _cleanup_task_dir(dest: Path) -> None:
    try:
        if not dest.exists():
            return
        for child in dest.iterdir():
            try:
                if child.is_file() or child.is_symlink():
                    child.unlink(missing_ok=True)
            except OSError:
                pass
        dest.rmdir()
    except OSError:
        pass


def next_task_info(config: dict[str, Any]) -> dict[str, Any]:
    workspace: Path = config["workspace"]
    root_re: re.Pattern[str] = config["root_re"]
    max_n = 0
    if workspace.is_dir():
        try:
            children = list(workspace.iterdir())
        except PermissionError:
            children = []
        for child in children:
            if not child.is_dir() or child.name.startswith("."):
                continue
            if not root_re.match(child.name):
                continue
            match = _TASK_PREFIX_RE.match(child.name)
            if match:
                max_n = max(max_n, int(match.group(1)))

    next_n = max_n + 1
    if next_n > 99:
        raise ValueError("任务编号已达 99，请先归档或调整编号规则")
    prefix = f"{next_n:02d}"
    return {
        "nextNumber": next_n,
        "nextPrefix": prefix,
        "preview": f"{prefix}-",
    }


def sanitize_task_title(raw: Any) -> str:
    title = str(raw or "").strip()
    if not title:
        raise ValueError("任务名不能为空")
    if title in {".", ".."} or title.startswith("."):
        raise ValueError("任务名不能以 . 开头")
    if any(ch in title for ch in ("/", "\\", "\0")):
        raise ValueError("任务名不能包含路径分隔符")
    if len(title) > 120:
        raise ValueError("任务名过长（最多 120 字）")
    return title


def _normalize_repo_inputs(repo: Any = None, repos: Any = None) -> list[str]:
    items: list[str] = []
    if isinstance(repos, list):
        items.extend(str(x) for x in repos)
    elif isinstance(repos, str) and repos.strip():
        items.append(repos)
    if repo is not None:
        if isinstance(repo, list):
            items.extend(str(x) for x in repo)
        else:
            text = normalize_dir_raw(repo)
            if text:
                items.append(text)

    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        raw = normalize_dir_raw(item)
        if not raw or raw in seen:
            continue
        seen.add(raw)
        out.append(raw)
    return out


def create_task(
    config: dict[str, Any],
    title: Any,
    repo: Any = None,
    *,
    repos: Any = None,
    index_path: Path | None = None,
) -> dict[str, Any]:
    workspace: Path = config["workspace"]
    if not workspace.is_dir():
        raise ValueError(f"Workspace 不存在：{workspace}")

    clean_title = sanitize_task_title(title)
    info = next_task_info(config)
    task_id = f"{info['nextPrefix']}-{clean_title}"
    if not config["root_re"].match(task_id):
        raise ValueError("生成的任务名不符合 taskPattern")

    dest = (workspace / task_id).resolve()
    try:
        dest.relative_to(workspace.resolve())
    except ValueError as exc:
        raise ValueError("非法任务路径") from exc
    if dest.exists():
        raise ValueError(f"任务已存在：{task_id}")

    repo_raws = _normalize_repo_inputs(repo=repo, repos=repos)
    resolved_repos: list[str] = []
    raw_repos: list[str] = []
    for raw in repo_raws:
        status = validate_dir_path(raw, require_exists=True)
        if not status["ok"]:
            raise ValueError(status.get("error") or f"代码仓库目录无效：{raw}")
        resolved = str(status["resolved"])
        if resolved in resolved_repos:
            continue
        resolved_repos.append(resolved)
        raw_repos.append(status["raw"])

    dest.mkdir(parents=False, exist_ok=False)

    workspace_doc = build_task_code_workspace(
        clean_title,
        dest,
        resolved_repos,
    )

    try:
        (dest / TASK_WORKSPACE_NAME).write_text(
            json.dumps(workspace_doc, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError:
        _cleanup_task_dir(dest)
        raise

    if index_path is not None:
        write_tasks_index(config, index_path)

    return {
        "id": task_id,
        "name": task_id,
        "prefix": info["nextPrefix"],
        "title": clean_title,
        "path": str(dest),
        "workspaceFile": str(dest / TASK_WORKSPACE_NAME),
        "repo": resolved_repos[0] if resolved_repos else None,
        "repoRaw": raw_repos[0] if raw_repos else None,
        "repos": list(resolved_repos),
        "reposRaw": list(raw_repos),
    }


def list_fs_dirs(raw_path: Any, config: dict[str, Any] | None = None) -> dict[str, Any]:
    text = normalize_dir_raw(raw_path)
    target = expand_path(text) if text else Path.home().resolve()
    if not target.exists():
        raise ValueError("路径不存在")
    if not target.is_dir():
        raise ValueError("不是目录")

    entries: list[dict[str, Any]] = []
    try:
        children = sorted(target.iterdir(), key=lambda p: p.name.lower())
    except PermissionError as exc:
        raise ValueError("无权限读取该目录") from exc

    for child in children:
        if child.name.startswith("."):
            continue
        try:
            if not child.is_dir():
                continue
        except OSError:
            continue
        entries.append(
            {
                "type": "dir",
                "name": child.name,
                "path": str(child.resolve()),
            }
        )

    parent = target.parent.resolve()
    parent_out = None if parent == target else str(parent)
    shortcuts = [
        {"label": "Home", "path": str(Path.home().resolve())},
    ]
    if config is not None:
        for key, label in (
            ("workspace", "Workspace"),
            ("knowledge", "领域知识"),
            ("archive", "归档"),
            ("tools", "工具"),
        ):
            path = config.get(key)
            if isinstance(path, Path) and path.is_dir():
                shortcuts.append({"label": label, "path": str(path.resolve())})
        for path in config.get("repo_roots") or []:
            if isinstance(path, Path) and path.is_dir():
                shortcuts.append({"label": path.name or str(path), "path": str(path.resolve())})

    return {
        "path": str(target.resolve()),
        "parent": parent_out,
        "entries": entries,
        "shortcuts": shortcuts,
    }


def build_tasks_index(config: dict[str, Any]) -> dict[str, Any]:
    entries = list_workspace_roots(config)
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "workspace": str(config["workspace"]),
        "archive": str(config["archive"]),
        "rootPattern": config["root_pattern"],
        "entries": entries,
        "tasks": entries_to_tasks(entries),
    }


def write_tasks_index(config: dict[str, Any], out_path: Path) -> dict[str, Any]:
    payload = build_tasks_index(config)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload


def read_tasks_index(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def main_build() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Rebuild Feature Hub task index")
    parser.add_argument(
        "--config",
        default=str(repo_root / "hub.config.json"),
        help="path to hub.config.json",
    )
    parser.add_argument(
        "--out",
        default=str(repo_root / "web" / "data" / "tasks.json"),
        help="output path for tasks.json",
    )
    args = parser.parse_args()

    config_path = Path(args.config).expanduser().resolve()
    if not config_path.is_file():
        raise SystemExit(f"config not found: {config_path}")

    out_path = Path(args.out).expanduser().resolve()
    config = load_config(config_path)
    payload = write_tasks_index(config, out_path)
    print(f"Wrote {out_path}", flush=True)
    print(f"  workspace: {payload['workspace']}", flush=True)
    print(f"  tasks:     {len(payload['tasks'])}", flush=True)


if __name__ == "__main__":
    main_build()
