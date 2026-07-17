#!/usr/bin/env python3
"""Finesse native invite service — stdlib only.

Public:
  GET  /v1/invites/<code>   validate + metadata
  POST /v1/join             create Jellyfin user from invite

Admin (Jellyfin admin token in Authorization / X-Emby-Token):
  GET    /v1/invites
  POST   /v1/invites
  DELETE /v1/invites/<id>
  GET    /v1/libraries      list Jellyfin libraries for picker
  GET    /health
"""

from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
import string
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

JELLYFIN_URL = os.environ.get("JELLYFIN_URL", "http://192.168.1.121:8096").rstrip("/")
JELLYFIN_API_KEY = os.environ.get("JELLYFIN_API_KEY", "").strip()
DB_PATH = Path(os.environ.get("INVITES_DB", "/mnt/HDDs/Applications/finesse/data/invites.db"))
LISTEN_HOST = os.environ.get("INVITE_LISTEN", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("INVITE_PORT", "30501"))

USERNAME_RE = re.compile(r"^[A-Za-z0-9._\-]{2,32}$")
PASSWORD_RE = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$")
CODE_RE = re.compile(r"^[A-Za-z0-9]{4,16}$")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------

def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init_db() -> None:
    con = db()
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS invites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE COLLATE NOCASE,
          created_at TEXT NOT NULL,
          expires_at TEXT,
          unlimited INTEGER NOT NULL DEFAULT 0,
          used INTEGER NOT NULL DEFAULT 0,
          used_at TEXT,
          used_by_username TEXT,
          allow_downloads INTEGER NOT NULL DEFAULT 1,
          allow_live_tv INTEGER NOT NULL DEFAULT 0,
          max_active_sessions INTEGER,
          label TEXT,
          created_by TEXT
        );
        CREATE TABLE IF NOT EXISTS invite_libraries (
          invite_id INTEGER NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
          library_id TEXT NOT NULL,
          name_cache TEXT,
          PRIMARY KEY (invite_id, library_id)
        );
        CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
        """
    )
    con.commit()
    con.close()


# ---------------------------------------------------------------------------
# Jellyfin admin client
# ---------------------------------------------------------------------------

def jf(path: str, method: str = "GET", body: Any | None = None, token: str | None = None) -> Any:
    url = f"{JELLYFIN_URL}{path}"
    data = None
    headers = {
        "Accept": "application/json",
        "X-Emby-Token": token or JELLYFIN_API_KEY,
        "X-Emby-Authorization": (
            'MediaBrowser Client="FinesseInvites", Device="invite-service", '
            'DeviceId="finesse-invite-1", Version="1.0"'
        ),
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw.decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="replace")
        raise JfError(e.code, err or e.reason) from e


class JfError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(f"{status}: {message}")


def require_admin_token(auth_header: str | None, emby_token: str | None) -> dict:
    """Validate caller is Jellyfin admin; return user-like dict."""
    token = None
    if emby_token:
        token = emby_token.strip()
    elif auth_header:
        # MediaBrowser Token="..." or raw token
        m = re.search(r'Token="([^"]+)"', auth_header)
        if m:
            token = m.group(1)
        elif auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
        else:
            token = auth_header.strip()
    if not token:
        raise ApiError(401, "Admin authentication required")

    # Service API key is treated as admin (for ops scripts); user tokens via /Users/Me
    if token == JELLYFIN_API_KEY:
        return {"Name": "api-key", "Policy": {"IsAdministrator": True}}

    try:
        me = jf("/Users/Me", token=token)
    except JfError as e:
        raise ApiError(401, "Invalid session") from e
    if not (me or {}).get("Policy", {}).get("IsAdministrator"):
        raise ApiError(403, "Administrator access required")
    return me


def list_libraries() -> list[dict]:
    """Return [{id, name}] for media libraries (folder GUIDs for policy)."""
    try:
        data = jf("/Library/MediaFolders")
        items = data.get("Items") if isinstance(data, dict) else data
        out = []
        for f in items or []:
            out.append({"id": str(f["Id"]), "name": f.get("Name") or "Library"})
        if out:
            return out
    except JfError:
        pass
    try:
        folders = jf("/Library/VirtualFolders")
        out = []
        for f in folders or []:
            iid = f.get("ItemId") or f.get("Guid") or f.get("Id")
            name = f.get("Name") or "Library"
            if iid:
                out.append({"id": str(iid), "name": name})
        return out
    except JfError as e:
        raise ApiError(502, f"Could not list libraries: {e.message}") from e


def create_jellyfin_user(
    username: str,
    password: str,
    library_ids: list[str],
    allow_downloads: bool,
    allow_live_tv: bool,
    max_sessions: int | None,
) -> str:
    """Create user, set password/policy/libraries. Returns user id."""
    try:
        user = jf("/Users/New", method="POST", body={"Name": username})
    except JfError as e:
        if e.status == 400:
            raise ApiError(400, "That username is already taken") from e
        raise ApiError(502, f"Jellyfin create failed: {e.message}") from e

    uid = user["Id"]
    try:
        # Set password
        jf(
            f"/Users/{uid}/Password",
            method="POST",
            body={"Id": uid, "NewPw": password},
        )
        # Policy — round-trip
        full = jf(f"/Users/{uid}")
        policy = dict(full.get("Policy") or {})
        policy.update(
            {
                "IsAdministrator": False,
                "IsHidden": False,
                "IsDisabled": False,
                "EnableContentDownloading": allow_downloads,
                "EnableLiveTvAccess": allow_live_tv,
                "EnableLiveTvManagement": False,
                "EnableContentDeletion": False,
                "EnableContentDeletionFromFolders": [],
                "EnablePublicSharing": False,
                "AllowCameraUpload": False,
                "EnableSubtitleManagement": False,
                "EnableRemoteControlOfOtherUsers": False,
                "EnableSharedDeviceControl": False,
                "EnableRemoteAccess": True,
                "EnableMediaPlayback": True,
                "EnableAudioPlaybackTranscoding": True,
                "EnableVideoPlaybackTranscoding": True,
                "EnablePlaybackRemuxing": True,
            }
        )
        if max_sessions is not None:
            policy["MaxActiveSessions"] = max_sessions
        if library_ids:
            policy["EnableAllFolders"] = False
            policy["EnabledFolders"] = library_ids
        else:
            policy["EnableAllFolders"] = True
        jf(f"/Users/{uid}/Policy", method="POST", body=policy)
    except Exception:
        # Best-effort cleanup
        try:
            jf(f"/Users/{uid}", method="DELETE")
        except Exception:
            pass
        raise
    return uid


def delete_jellyfin_user(uid: str) -> None:
    try:
        jf(f"/Users/{uid}", method="DELETE")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Business logic
# ---------------------------------------------------------------------------

class ApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(message)


def invite_status(row: sqlite3.Row) -> str:
    if row["used"] and not row["unlimited"]:
        return "used"
    exp = parse_iso(row["expires_at"])
    if exp and exp <= utcnow():
        return "expired"
    return "pending"


def row_public(row: sqlite3.Row, libs: list[dict]) -> dict:
    st = invite_status(row)
    return {
        "code": row["code"],
        "status": st,
        "label": row["label"],
        "libraries": [l["name"] for l in libs],
        "allow_downloads": bool(row["allow_downloads"]),
        "allow_live_tv": bool(row["allow_live_tv"]),
        "expires_at": row["expires_at"],
    }


def row_admin(row: sqlite3.Row, libs: list[dict]) -> dict:
    base = row_public(row, libs)
    base.update(
        {
            "id": row["id"],
            "created_at": row["created_at"],
            "unlimited": bool(row["unlimited"]),
            "used": bool(row["used"]),
            "used_at": row["used_at"],
            "used_by_username": row["used_by_username"],
            "created_by": row["created_by"],
            "library_ids": [l["id"] for l in libs],
            "max_active_sessions": row["max_active_sessions"],
        }
    )
    return base


def get_invite_libs(con: sqlite3.Connection, invite_id: int) -> list[dict]:
    return [
        {"id": r["library_id"], "name": r["name_cache"] or r["library_id"]}
        for r in con.execute(
            "SELECT library_id, name_cache FROM invite_libraries WHERE invite_id=?",
            (invite_id,),
        )
    ]


def load_invite(con: sqlite3.Connection, code: str) -> sqlite3.Row | None:
    return con.execute(
        "SELECT * FROM invites WHERE code = ? COLLATE NOCASE",
        (code.strip(),),
    ).fetchone()


def generate_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def validate_join_payload(body: dict) -> tuple[str, str, str, str | None]:
    code = (body.get("code") or "").strip()
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    email = (body.get("email") or "").strip() or None
    if not code or not CODE_RE.match(code):
        raise ApiError(400, "Invalid invite code")
    if not USERNAME_RE.match(username):
        raise ApiError(
            400,
            "Username must be 2–32 characters (letters, numbers, . _ -)",
        )
    if not PASSWORD_RE.match(password):
        raise ApiError(
            400,
            "Password must be 8+ characters with upper, lower, and a number",
        )
    return code, username, password, email


def handle_get_invite(code: str) -> dict:
    con = db()
    try:
        row = load_invite(con, code)
        if not row:
            raise ApiError(404, "Invite not found")
        libs = get_invite_libs(con, row["id"])
        return row_public(row, libs)
    finally:
        con.close()


def handle_join(body: dict) -> dict:
    code, username, password, _email = validate_join_payload(body)
    con = db()
    try:
        row = load_invite(con, code)
        if not row:
            raise ApiError(404, "Invite not found")
        st = invite_status(row)
        if st == "used":
            raise ApiError(410, "This invite has already been used")
        if st == "expired":
            raise ApiError(410, "This invite has expired")

        libs = get_invite_libs(con, row["id"])
        library_ids = [l["id"] for l in libs]

        uid = create_jellyfin_user(
            username=username,
            password=password,
            library_ids=library_ids,
            allow_downloads=bool(row["allow_downloads"]),
            allow_live_tv=bool(row["allow_live_tv"]),
            max_sessions=row["max_active_sessions"],
        )

        now = iso(utcnow())
        if not row["unlimited"]:
            con.execute(
                """
                UPDATE invites
                SET used=1, used_at=?, used_by_username=?
                WHERE id=?
                """,
                (now, username, row["id"]),
            )
        else:
            con.execute(
                """
                UPDATE invites
                SET used_at=?, used_by_username=?
                WHERE id=?
                """,
                (now, username, row["id"]),
            )
        con.commit()
        return {
            "ok": True,
            "username": username,
            "user_id": uid,
            "message": "Account created",
        }
    except ApiError:
        raise
    except JfError as e:
        raise ApiError(502, f"Jellyfin error: {e.message}") from e
    finally:
        con.close()


def handle_list_invites() -> dict:
    con = db()
    try:
        rows = con.execute("SELECT * FROM invites ORDER BY id DESC").fetchall()
        out = []
        for row in rows:
            out.append(row_admin(row, get_invite_libs(con, row["id"])))
        return {"invites": out, "count": len(out)}
    finally:
        con.close()


def handle_create_invite(body: dict, created_by: str) -> dict:
    code = (body.get("code") or "").strip().upper() or generate_code()
    if not CODE_RE.match(code):
        raise ApiError(400, "Invalid code format")

    expires_in_days = body.get("expires_in_days")  # null = never
    expires_at = None
    if expires_in_days is not None:
        try:
            days = int(expires_in_days)
            if days > 0:
                expires_at = iso(utcnow() + timedelta(days=days))
        except (TypeError, ValueError) as e:
            raise ApiError(400, "expires_in_days must be an integer") from e

    unlimited = 1 if body.get("unlimited") else 0
    allow_downloads = 0 if body.get("allow_downloads") is False else 1
    allow_live_tv = 1 if body.get("allow_live_tv") else 0
    max_sessions = body.get("max_active_sessions")
    label = (body.get("label") or "").strip() or None
    library_ids = body.get("library_ids") or []
    if not isinstance(library_ids, list):
        raise ApiError(400, "library_ids must be an array")

    # Resolve names for cache
    all_libs = {l["id"]: l["name"] for l in list_libraries()}
    resolved = []
    for lid in library_ids:
        lid = str(lid)
        resolved.append({"id": lid, "name": all_libs.get(lid, lid)})

    con = db()
    try:
        existing = load_invite(con, code)
        if existing:
            raise ApiError(409, "Invite code already exists")
        cur = con.execute(
            """
            INSERT INTO invites (
              code, created_at, expires_at, unlimited, used,
              allow_downloads, allow_live_tv, max_active_sessions, label, created_by
            ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
            """,
            (
                code,
                iso(utcnow()),
                expires_at,
                unlimited,
                allow_downloads,
                allow_live_tv,
                max_sessions,
                label,
                created_by,
            ),
        )
        iid = cur.lastrowid
        for lib in resolved:
            con.execute(
                "INSERT INTO invite_libraries (invite_id, library_id, name_cache) VALUES (?,?,?)",
                (iid, lib["id"], lib["name"]),
            )
        con.commit()
        row = con.execute("SELECT * FROM invites WHERE id=?", (iid,)).fetchone()
        return row_admin(row, resolved)
    finally:
        con.close()


def handle_delete_invite(invite_id: int) -> dict:
    con = db()
    try:
        row = con.execute("SELECT id FROM invites WHERE id=?", (invite_id,)).fetchone()
        if not row:
            raise ApiError(404, "Invite not found")
        con.execute("DELETE FROM invites WHERE id=?", (invite_id,))
        con.commit()
        return {"ok": True}
    finally:
        con.close()


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "FinesseInvite/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[invite] {self.address_string()} {fmt % args}")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode() or "{}")
        except json.JSONDecodeError as e:
            raise ApiError(400, "Invalid JSON") from e

    def _send(self, status: int, body: Any) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        # CORS not needed for same-origin; allow simple local dev if needed
        origin = self.headers.get("Origin")
        if origin and ("localhost" in origin or "127.0.0.1" in origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Emby-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def _err(self, e: Exception) -> None:
        if isinstance(e, ApiError):
            self._send(e.status, {"error": e.message})
        else:
            traceback.print_exc()
            self._send(500, {"error": "Internal server error"})

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        origin = self.headers.get("Origin") or "*"
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Emby-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        try:
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            if path == "/health":
                self._send(200, {"status": "ok"})
                return
            if path == "/v1/libraries":
                require_admin_token(
                    self.headers.get("Authorization"),
                    self.headers.get("X-Emby-Token"),
                )
                self._send(200, {"libraries": list_libraries()})
                return
            if path == "/v1/invites":
                require_admin_token(
                    self.headers.get("Authorization"),
                    self.headers.get("X-Emby-Token"),
                )
                self._send(200, handle_list_invites())
                return
            m = re.fullmatch(r"/v1/invites/([^/]+)", path)
            if m:
                code = m.group(1)
                # numeric id with admin → single admin view; else public by code
                if code.isdigit():
                    require_admin_token(
                        self.headers.get("Authorization"),
                        self.headers.get("X-Emby-Token"),
                    )
                    con = db()
                    try:
                        row = con.execute(
                            "SELECT * FROM invites WHERE id=?", (int(code),)
                        ).fetchone()
                        if not row:
                            raise ApiError(404, "Invite not found")
                        self._send(
                            200, row_admin(row, get_invite_libs(con, row["id"]))
                        )
                    finally:
                        con.close()
                    return
                self._send(200, handle_get_invite(code))
                return
            self._send(404, {"error": "Not found"})
        except Exception as e:
            self._err(e)

    def do_POST(self) -> None:  # noqa: N802
        try:
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            body = self._read_json()
            if path == "/v1/join":
                self._send(201, handle_join(body))
                return
            if path == "/v1/invites":
                me = require_admin_token(
                    self.headers.get("Authorization"),
                    self.headers.get("X-Emby-Token"),
                )
                created = handle_create_invite(body, me.get("Name") or "admin")
                self._send(201, created)
                return
            self._send(404, {"error": "Not found"})
        except Exception as e:
            self._err(e)

    def do_DELETE(self) -> None:  # noqa: N802
        try:
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            m = re.fullmatch(r"/v1/invites/(\d+)", path)
            if not m:
                self._send(404, {"error": "Not found"})
                return
            require_admin_token(
                self.headers.get("Authorization"),
                self.headers.get("X-Emby-Token"),
            )
            self._send(200, handle_delete_invite(int(m.group(1))))
        except Exception as e:
            self._err(e)


def main() -> None:
    if not JELLYFIN_API_KEY:
        raise SystemExit("JELLYFIN_API_KEY is required")
    init_db()
    httpd = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(f"Finesse invite service on {LISTEN_HOST}:{LISTEN_PORT} db={DB_PATH}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
