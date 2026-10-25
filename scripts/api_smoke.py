"""End-to-end API check: save on one browser, restore on another (Phase 5a, spec section 12).

    python3 scripts/api_smoke.py http://localhost:8080

Two independent cookie jars sign in as the same dev user (DEV_LOGIN=1). A saves two versions
with an image; B lists the project, downloads the latest version and its blobs and checks
their hashes; a stale save from A is refused; deleting the account signs B out too.
Standard library only, so it runs anywhere Python 3 does. Exits 1 on the first mismatch.
"""

import hashlib
import http.cookiejar
import json
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

CSRF = {"X-MdIt-CSRF": "1"}
MARKDOWN_V1 = b"# Smoke\n\nFirst version.\n\n![dot](images/dot.png)\n"
MARKDOWN_V2 = b"# Smoke\n\nSecond version.\n\n![dot](images/dot.png)\n"
PNG = b"\x89PNG\r\n\x1a\n" + bytes(16)


class Failed(Exception):
    pass


class LocalhostIsSecure(http.cookiejar.DefaultCookiePolicy):
    """Browsers send Secure cookies to http://localhost (a secure context); so does this."""

    def return_ok_secure(self, cookie: http.cookiejar.Cookie, request: Any) -> bool:
        host = urllib.parse.urlsplit(request.get_full_url()).hostname
        return host in ("localhost", "127.0.0.1") or super().return_ok_secure(cookie, request)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


class Browser:
    def __init__(self, base: str, name: str) -> None:
        self.base = base.rstrip("/")
        self.name = name
        jar = http.cookiejar.CookieJar(policy=LocalhostIsSecure())
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(jar), NoRedirect()
        )

    def request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        content_type: str | None = None,
        json_body: object = None,
    ) -> tuple[int, bytes]:
        headers = dict(CSRF) if method not in ("GET", "HEAD") else {}
        if json_body is not None:
            body = json.dumps(json_body).encode()
            content_type = "application/json"
        if content_type:
            headers["Content-Type"] = content_type
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=headers)
        try:
            with self.opener.open(req, timeout=30) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def expect(self, status: int, method: str, path: str, **kwargs: Any) -> Any:
        got, body = self.request(method, path, **kwargs)
        if got != status:
            raise Failed(f"{self.name}: {method} {path} → {got}, expected {status}: {body[:200]!r}")
        return json.loads(body) if body and body[:1] in (b"{", b"[") else body


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run(base: str) -> None:
    user = "smoke-" + secrets.token_hex(4)
    a, b = Browser(base, "A"), Browser(base, "B")
    for browser in (a, b):
        browser.expect(302, "GET", f"/api/auth/login/dev?name={user}")
        if browser.expect(200, "GET", "/api/me")["provider"] != "dev":
            raise Failed(f"{browser.name}: not signed in as a dev user")

    project = a.expect(201, "POST", "/api/projects", json_body={"name": "Smoke"})["id"]
    doc = a.expect(
        201, "POST", f"/api/projects/{project}/documents", json_body={"path": "notes/Smoke.md"}
    )["id"]
    for data, content_type in (
        (MARKDOWN_V1, "text/markdown"),
        (MARKDOWN_V2, "text/markdown"),
        (PNG, "image/png"),
    ):
        a.expect(201, "PUT", f"/api/blobs/{sha(data)}", body=data, content_type=content_type)
    images = [{"path": "notes/images/dot.png", "hash": sha(PNG)}]
    v1 = a.expect(
        201,
        "POST",
        f"/api/documents/{doc}/versions",
        json_body={
            "parent_version_id": None,
            "content_hash": sha(MARKDOWN_V1),
            "path": "notes/Smoke.md",
            "message": "First",
            "images": images,
        },
    )["id"]
    a.expect(
        201,
        "POST",
        f"/api/documents/{doc}/versions",
        json_body={
            "parent_version_id": v1,
            "content_hash": sha(MARKDOWN_V2),
            "path": "notes/Smoke.md",
            "message": "Second",
            "images": images,
        },
    )

    # Browser B: a new device after signing in (PRD 6.4).
    projects = [p for p in b.expect(200, "GET", "/api/projects") if p["id"] == project]
    if not projects:
        raise Failed("B: the project is not listed")
    documents = b.expect(200, "GET", f"/api/projects/{project}/documents")
    if [d["path"] for d in documents] != ["notes/Smoke.md"] or documents[0]["latest"][
        "number"
    ] != 2:
        raise Failed(f"B: unexpected documents {documents}")
    version = b.expect(200, "GET", f"/api/versions/{documents[0]['latest']['id']}")
    content = b.expect(200, "GET", f"/api/blobs/{version['content_hash']}")
    if sha(content) != sha(MARKDOWN_V2):
        raise Failed("B: the latest version's content does not match")
    for image in version["images"]:
        if sha(b.expect(200, "GET", f"/api/blobs/{image['hash']}")) != image["hash"]:
            raise Failed(f"B: image {image['path']} does not match its hash")

    conflict = a.expect(
        409,
        "POST",
        f"/api/documents/{doc}/versions",
        json_body={
            "parent_version_id": v1,
            "content_hash": sha(MARKDOWN_V1),
            "path": "notes/Smoke.md",
        },
    )
    if conflict["error"]["code"] != "version_conflict":
        raise Failed(f"A: stale save gave {conflict}")

    a.expect(204, "DELETE", "/api/me")
    b.expect(401, "GET", "/api/me")


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
    try:
        run(base)
    except (Failed, OSError, KeyError, ValueError) as error:
        print(f"API smoke failed: {error}")
        return 1
    print(f"API smoke passed against {base}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
