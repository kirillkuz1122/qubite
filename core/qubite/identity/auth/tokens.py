"""Typed 256-bit opaque values. CSRF proof reveals neither cookie nor DB digest."""
import base64
import hashlib
import hmac
import re
import secrets


def issue(prefix):
    return prefix + base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b'=').decode('ascii')


def valid_token(value, prefix):
    return isinstance(value, str) and re.fullmatch(re.escape(prefix) + r'[A-Za-z0-9_-]{43}', value) is not None


def digest(value):
    return hashlib.sha256(value.encode('ascii')).digest()


def csrf_for(cookie):
    return 'qbt_c_' + base64.urlsafe_b64encode(hmac.digest(cookie.encode('ascii'), b'qubite-csrf-v1', 'sha256')).rstrip(b'=').decode('ascii')
