"""Request checks that keep the local server private to the browser on this machine.

Threat model: the server holds a paid API key and runs on 127.0.0.1. The attacks that reach a
loopback server are web pages you happen to visit (CSRF) and DNS rebinding (a hostile site whose
DNS record points at 127.0.0.1). Defences, in the order they run:

1. Host allow-list. Only loopback names on our port are served, which defeats DNS rebinding.
2. Fetch Metadata. Browsers send `Sec-Fetch-Site`; anything but `same-origin` / `none` is refused.
3. Origin check. When an `Origin` header is present it must be one of ours.
4. Session token. Every state-changing request must carry `X-Jev-Token`, a random value that only
   pages served by this process contain. It is a custom header, so browsers preflight it, and a
   cross-origin page can neither read the token nor pass the preflight.
5. JSON only. Request bodies must be `application/json`, which rules out plain HTML form posts.

This mirrors Go 1.25's `http.CrossOriginProtection` plus the token as belt-and-braces.
"""

from __future__ import annotations

import secrets
from typing import Mapping, Optional

LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "[::1]")
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")
TOKEN_HEADER = "X-Jev-Token"


def new_token() -> str:
    return secrets.token_urlsafe(32)


def split_host(host_header: str) -> tuple:
    """'localhost:8321' -> ('localhost', 8321); '[::1]:8321' -> ('[::1]', 8321); no port -> None."""
    host = (host_header or "").strip().lower()
    if host.startswith("["):
        end = host.find("]")
        name, rest = host[: end + 1], host[end + 1:]
    elif host.count(":") == 1:
        name, rest = host.split(":", 1)
        rest = ":" + rest
    else:
        name, rest = host, ""
    port = None
    if rest.startswith(":") and rest[1:].isdigit():
        port = int(rest[1:])
    return name, port


def host_allowed(host_header: Optional[str], port: int) -> bool:
    if not host_header:
        return False
    name, host_port = split_host(host_header)
    return name in LOOPBACK_HOSTS and (host_port is None or host_port == port)


def allowed_origins(port: int) -> tuple:
    return tuple("http://%s:%d" % (name, port) for name in LOOPBACK_HOSTS)


def check_request(method: str, headers: Mapping[str, str], token: str, port: int,
                  has_body: bool = False) -> Optional[str]:
    """Return None when the request may proceed, otherwise a short reason for the 403."""
    if not host_allowed(headers.get("Host"), port):
        return "host"
    if method in SAFE_METHODS:
        return None
    site = (headers.get("Sec-Fetch-Site") or "").strip().lower()
    if site and site not in ("same-origin", "none"):
        return "sec-fetch-site"
    origin = (headers.get("Origin") or "").strip().lower()
    if origin and origin != "null" and origin not in allowed_origins(port):
        return "origin"
    if origin == "null":
        return "origin"
    supplied = headers.get(TOKEN_HEADER) or ""
    if not supplied or not secrets.compare_digest(supplied, token):
        return "token"
    if has_body and not (headers.get("Content-Type") or "").lower().startswith("application/json"):
        return "content-type"
    return None


REASONS = {
    "host": "Refused: this server only answers requests addressed to localhost (DNS-rebinding guard).",
    "sec-fetch-site": "Refused: cross-site request (Sec-Fetch-Site).",
    "origin": "Refused: request came from another origin.",
    "token": "Refused: missing or stale session token. Reload the page.",
    "content-type": "Refused: POST bodies must be application/json.",
}
