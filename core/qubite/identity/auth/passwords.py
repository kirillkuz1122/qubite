"""Exact UTF-8 passwords; bounded Argon2id cost, never arbitrary PHC parameters."""
from threading import BoundedSemaphore

from argon2 import PasswordHasher, extract_parameters
from argon2.exceptions import Argon2Error
from argon2.low_level import Type

HASHER = PasswordHasher(memory_cost=19456, time_cost=2, parallelism=1,
                        hash_len=32, salt_len=16, type=Type.ID)
# Public synthetic dummy only, never stored for any subject. No hash work at startup.
DUMMY = '$argon2id$v=19$m=19456,t=2,p=1$bw+Fhf9qt3Acpqun1fu2Ag$O8a+FTOa+R47MCZjOKgLmKJxdKRLNu0v2rW4PNml9F8'
SLOTS = BoundedSemaphore(2)  # Per process: at most ~38MiB Argon2 working memory.


class HashBusy(RuntimeError):
    pass


def valid_password(value):
    if not isinstance(value, str) or not 12 <= len(value) <= 256:
        return False
    try:
        return len(value.encode('utf-8')) <= 1024
    except UnicodeError:
        return False


def supported_hash(value):
    if not isinstance(value, str) or not 80 <= len(value) <= 200:
        return False
    try:
        p = extract_parameters(value)
        return (p.type, p.version, p.memory_cost, p.time_cost, p.parallelism,
                p.hash_len, p.salt_len) == (Type.ID, 19, 19456, 2, 1, 32, 16)
    except (Argon2Error, ValueError):
        return False


def hash_password(password):
    if not valid_password(password):
        raise ValueError('Password must be 12..256 codepoints and at most 1024 UTF-8 bytes')
    if not SLOTS.acquire(blocking=False):
        raise HashBusy('Password check capacity exhausted')
    try:
        return HASHER.hash(password)
    finally:
        SLOTS.release()


def verify_password(phc, password):
    supported = supported_hash(phc)
    valid = valid_password(password)
    if not SLOTS.acquire(blocking=False):
        raise HashBusy('Password check capacity exhausted')
    try:
        try:
            HASHER.verify(phc if supported else DUMMY, password if valid else 'synthetic-invalid-password')
            return supported and valid
        except Argon2Error:
            return False
    finally:
        SLOTS.release()
