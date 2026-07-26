from __future__ import annotations

import hashlib
import os
import shutil
import uuid
from pathlib import Path


class FileIntegrityError(OSError):
    """Raised when a copied file does not match its source."""


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def same_file_contents(first: Path, second: Path) -> bool:
    if not first.is_file() or not second.is_file():
        return False
    if first.stat().st_size != second.stat().st_size:
        return False
    return sha256_file(first) == sha256_file(second)


def copy_verified_atomic(source: Path, destination: Path) -> str:
    """Copy without overwriting and verify bytes before publishing the result.

    Returns ``"copied"`` for a new destination or ``"existing"`` when the
    destination already contains the exact same bytes.
    """

    if not source.is_file():
        raise FileNotFoundError(f"Source file not found: {source}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if same_file_contents(source, destination):
            return "existing"
        raise FileExistsError(f"Destination already exists with different content: {destination}")

    temporary = destination.parent / f".{destination.name}.{uuid.uuid4().hex}.partial"
    source_hash = sha256_file(source)
    published = False
    try:
        with source.open("rb") as input_file, temporary.open("xb") as output_file:
            shutil.copyfileobj(input_file, output_file, length=1024 * 1024)
            output_file.flush()
            os.fsync(output_file.fileno())
        shutil.copystat(source, temporary)

        if sha256_file(temporary) != source_hash:
            raise FileIntegrityError(f"Copy verification failed before publishing: {destination}")

        if destination.exists():
            if same_file_contents(source, destination):
                return "existing"
            raise FileExistsError(
                f"Destination appeared during copy with different content: {destination}"
            )

        os.rename(temporary, destination)
        published = True
        if sha256_file(destination) != source_hash:
            destination.unlink(missing_ok=True)
            raise FileIntegrityError(f"Copy verification failed after publishing: {destination}")
        return "copied"
    finally:
        if not published:
            temporary.unlink(missing_ok=True)


def move_verified_atomic(source: Path, destination: Path) -> str:
    """Copy, verify, then remove the source.

    The source is never removed until an identical destination is durable.
    """

    result = copy_verified_atomic(source, destination)
    if not same_file_contents(source, destination):
        raise FileIntegrityError(f"Move verification failed: {destination}")
    source.unlink()
    return "moved" if result == "copied" else "deduplicated"


def atomic_write_bytes(path: Path, contents: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.partial"
    published = False
    try:
        with temporary.open("xb") as output:
            output.write(contents)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        published = True
    finally:
        if not published:
            temporary.unlink(missing_ok=True)


def atomic_write_text(path: Path, text: str, encoding: str = "utf-8") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.partial"
    published = False
    try:
        with temporary.open("x", encoding=encoding, newline="") as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        published = True
    finally:
        if not published:
            temporary.unlink(missing_ok=True)
