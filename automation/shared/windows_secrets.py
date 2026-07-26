from __future__ import annotations

import base64
import binascii
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
from typing import Callable

from shared.safe_files import atomic_write_bytes


SECRET_MAGIC = b"INNPILOT-DPAPI-SECRET-V1\n"
CRYPTPROTECT_UI_FORBIDDEN = 0x1
Protector = Callable[[bytes, bytes, str], bytes]
Unprotector = Callable[[bytes, bytes], bytes]


class SecretProtectionError(RuntimeError):
    """Raised when a local OAuth file cannot be safely protected or opened."""


class DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


def _validate_purpose(purpose: str) -> str:
    if not purpose or not purpose.isascii() or any(
        character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in purpose
    ):
        raise SecretProtectionError("OAuth secret purpose is invalid.")
    return purpose


def _entropy(purpose: str) -> bytes:
    return f"InnPilot:{_validate_purpose(purpose)}:v1".encode("ascii")


def encode_envelope(purpose: str, protected: bytes) -> bytes:
    validated = _validate_purpose(purpose)
    if not protected:
        raise SecretProtectionError("Windows returned an empty protected OAuth secret.")
    return (
        SECRET_MAGIC
        + validated.encode("ascii")
        + b"\n"
        + base64.urlsafe_b64encode(protected)
        + b"\n"
    )


def decode_envelope(contents: bytes, expected_purpose: str) -> bytes:
    if not contents.startswith(SECRET_MAGIC):
        raise SecretProtectionError("OAuth secret file is not protected by InnPilot.")
    lines = contents[len(SECRET_MAGIC) :].splitlines()
    if len(lines) != 2:
        raise SecretProtectionError("Protected OAuth secret file is damaged.")
    try:
        purpose = lines[0].decode("ascii")
    except UnicodeDecodeError as error:
        raise SecretProtectionError("Protected OAuth secret purpose is damaged.") from error
    if purpose != _validate_purpose(expected_purpose):
        raise SecretProtectionError("Protected OAuth secret belongs to a different purpose.")
    try:
        protected = base64.b64decode(lines[1], altchars=b"-_", validate=True)
    except (ValueError, binascii.Error) as error:
        raise SecretProtectionError("Protected OAuth secret payload is damaged.") from error
    if not protected:
        raise SecretProtectionError("Protected OAuth secret payload is empty.")
    return protected


def is_protected_secret(path: Path) -> bool:
    try:
        with path.open("rb") as source:
            return source.read(len(SECRET_MAGIC)) == SECRET_MAGIC
    except OSError:
        return False


def write_json_secret(
    path: Path,
    value: dict,
    *,
    purpose: str,
    protector: Protector | None = None,
) -> None:
    if not isinstance(value, dict):
        raise SecretProtectionError("OAuth secret must be a JSON object.")
    serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    protect = protector or protect_for_current_user
    protected = protect(serialized, _entropy(purpose), purpose)
    atomic_write_bytes(path, encode_envelope(purpose, protected))


def read_json_secret(
    path: Path,
    *,
    purpose: str,
    migrate_plaintext: bool = True,
    protector: Protector | None = None,
    unprotector: Unprotector | None = None,
) -> dict:
    try:
        contents = path.read_bytes()
    except OSError as error:
        raise SecretProtectionError("OAuth secret file could not be read.") from error

    protected_file = contents.startswith(SECRET_MAGIC)
    if protected_file:
        encrypted = decode_envelope(contents, purpose)
        unprotect = unprotector or unprotect_for_current_user
        plaintext = unprotect(encrypted, _entropy(purpose))
    else:
        plaintext = contents

    try:
        value = json.loads(plaintext.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SecretProtectionError("OAuth secret file is not a valid JSON object.") from error
    if not isinstance(value, dict):
        raise SecretProtectionError("OAuth secret file must contain a JSON object.")

    if not protected_file and migrate_plaintext:
        write_json_secret(path, value, purpose=purpose, protector=protector)
    return value


def _input_blob(value: bytes) -> tuple[DataBlob, ctypes.Array]:
    if not value:
        raise SecretProtectionError("Cannot protect an empty OAuth secret.")
    buffer = (ctypes.c_ubyte * len(value)).from_buffer_copy(value)
    return DataBlob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer


def _windows_crypt32():
    if os.name != "nt":
        raise SecretProtectionError("OAuth secret protection requires Windows.")
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    blob_pointer = ctypes.POINTER(DataBlob)
    crypt32.CryptProtectData.argtypes = [
        blob_pointer,
        wintypes.LPCWSTR,
        blob_pointer,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        blob_pointer,
    ]
    crypt32.CryptUnprotectData.argtypes = [
        blob_pointer,
        ctypes.POINTER(wintypes.LPWSTR),
        blob_pointer,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        blob_pointer,
    ]
    crypt32.CryptProtectData.restype = wintypes.BOOL
    crypt32.CryptUnprotectData.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    return crypt32, kernel32


def protect_for_current_user(value: bytes, entropy: bytes, description: str) -> bytes:
    crypt32, kernel32 = _windows_crypt32()
    input_blob, input_buffer = _input_blob(value)
    entropy_blob, entropy_buffer = _input_blob(entropy)
    output_blob = DataBlob()
    result = crypt32.CryptProtectData(
        ctypes.byref(input_blob),
        description,
        ctypes.byref(entropy_blob),
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(output_blob),
    )
    if not result:
        raise SecretProtectionError(
            f"Windows could not protect the OAuth secret (error {ctypes.get_last_error()})."
        )
    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        kernel32.LocalFree(output_blob.pbData)


def unprotect_for_current_user(value: bytes, entropy: bytes) -> bytes:
    crypt32, kernel32 = _windows_crypt32()
    input_blob, input_buffer = _input_blob(value)
    entropy_blob, entropy_buffer = _input_blob(entropy)
    output_blob = DataBlob()
    result = crypt32.CryptUnprotectData(
        ctypes.byref(input_blob),
        None,
        ctypes.byref(entropy_blob),
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(output_blob),
    )
    if not result:
        raise SecretProtectionError(
            "This OAuth secret cannot be unlocked by the current Windows user on this PC."
        )
    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        kernel32.LocalFree(output_blob.pbData)
