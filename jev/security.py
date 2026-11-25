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
from typing import Mapping

LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "[::1]")
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")
TOKEN_HEADER = "X-Jev-Token"


def new_token() -> str:
    return secrets.token_urlsafe(32)


def split_host(host_header: str) -> tuple[str, int | None]:
    """'localhost:8321' -> ('localhost', 8321); '[::1]:8321' -> ('[::1]', 8321); no port -> None; invalid -> -1."""
    host = host_header.strip(" \t")
    if not host.isascii() or not host.isprintable():
        return "", -1
    host = host.lower()
    if host.startswith("["):
        end = host.find("]")
        if end == -1:
            return "", -1
        name, rest = host[: end + 1], host[end + 1 :]
    elif host.count(":") == 1:
        name, rest = host.split(":", 1)
        rest = ":" + rest
    elif ":" in host:
        return "", -1
    else:
        name, rest = host, ""
    if not rest:
        return name, None
    digits = rest[1:].lstrip("0")
    if rest.startswith(":") and len(digits) <= 5 and digits.isascii() and digits.isdigit():
        parsed = int(digits)
        if 1 <= parsed <= 65535:
            return name, parsed
    return name, -1


def host_allowed(host_header: str | None, port: int) -> bool:
    if not host_header:
        return False
    name, host_port = split_host(host_header)
    if host_port is not None and not (1 <= host_port <= 65535):
        return False
    return name in LOOPBACK_HOSTS and (host_port is None or host_port == port)


def allowed_origins(port: int) -> tuple[str, ...]:
    origins = tuple("http://%s:%d" % (name, port) for name in LOOPBACK_HOSTS)
    if port == 80:
        return (*origins, *(f"http://{name}" for name in LOOPBACK_HOSTS))
    return origins


def _ambiguous(headers: Mapping[str, str], name: str) -> bool:
    get_all = getattr(headers, "get_all", None)
    return get_all is not None and len(get_all(name, [])) > 1


def check_request(
    method: str,
    headers: Mapping[str, str],
    token: str,
    port: int,
    has_body: bool = False,
    *,
    private_read: bool = False,
) -> str | None:
    """Return None when the request may proceed, otherwise a short reason for the 403."""
    if _ambiguous(headers, "Host") or not host_allowed(headers.get("Host"), port):
        return "host"
    safe = method in SAFE_METHODS
    if safe and not private_read:
        return None
    site = headers.get("Sec-Fetch-Site")
    if _ambiguous(headers, "Sec-Fetch-Site") or (
        site is not None and site.strip(" \t").lower() not in ("same-origin", "none")
    ):
        return "sec-fetch-site"
    origin = headers.get("Origin")
    if _ambiguous(headers, "Origin"):
        return "origin"
    if origin is not None:
        origin = origin.strip(" \t").lower()
        name, _ = split_host(headers["Host"])
        if origin != f"http://{name}:{port}" and not (port == 80 and origin == f"http://{name}"):
            return "origin"
    if safe:
        return None
    supplied = headers.get(TOKEN_HEADER) or ""
    if (
        _ambiguous(headers, TOKEN_HEADER)
        or not supplied
        or not supplied.isascii()
        or not secrets.compare_digest(supplied, token)
    ):
        return "token"
    media_type = (headers.get("Content-Type") or "").partition(";")[0].strip().lower()
    if has_body and (_ambiguous(headers, "Content-Type") or media_type != "application/json"):
        return "content-type"
    return None


REASONS = {
    "host": "Refused: this server only answers requests addressed to localhost (DNS-rebinding guard).",
    "sec-fetch-site": "Refused: cross-site request (Sec-Fetch-Site).",
    "origin": "Refused: request came from another origin.",
    "token": "Refused: missing or stale session token. Reload the page.",
    "content-type": "Refused: POST bodies must be application/json.",
}
