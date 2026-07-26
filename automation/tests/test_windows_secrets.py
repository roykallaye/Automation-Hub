from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path


AUTOMATION_ROOT = Path(__file__).resolve().parents[1]
if str(AUTOMATION_ROOT) not in sys.path:
    sys.path.insert(0, str(AUTOMATION_ROOT))

from shared.windows_secrets import (  # noqa: E402
    SECRET_MAGIC,
    SecretProtectionError,
    decode_envelope,
    encode_envelope,
    is_protected_secret,
    read_json_secret,
    write_json_secret,
)


def fake_protect(value: bytes, entropy: bytes, description: str) -> bytes:
    return len(entropy).to_bytes(2, "big") + entropy + description.encode("ascii") + b"\0" + value[::-1]


def fake_unprotect(value: bytes, entropy: bytes) -> bytes:
    entropy_size = int.from_bytes(value[:2], "big")
    stored_entropy = value[2 : 2 + entropy_size]
    if stored_entropy != entropy:
        raise SecretProtectionError("Synthetic entropy mismatch.")
    payload = value[2 + entropy_size :]
    _, reversed_plaintext = payload.split(b"\0", 1)
    return reversed_plaintext[::-1]


class WindowsSecretsTests(unittest.TestCase):
    def test_plaintext_json_is_migrated_atomically_without_a_readable_backup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            secret = root / "gmail_token.json"
            marker = "synthetic-oauth-value"
            secret.write_text(f'{{"token":"{marker}"}}', encoding="utf-8")

            loaded = read_json_secret(
                secret,
                purpose="gmail-token",
                protector=fake_protect,
                unprotector=fake_unprotect,
            )

            self.assertEqual(loaded["token"], marker)
            protected_bytes = secret.read_bytes()
            self.assertTrue(protected_bytes.startswith(SECRET_MAGIC))
            self.assertNotIn(marker.encode("utf-8"), protected_bytes)
            self.assertEqual(list(root.glob("*.bak")), [])
            self.assertEqual(list(root.glob("*.partial")), [])
            self.assertEqual(
                read_json_secret(
                    secret,
                    purpose="gmail-token",
                    protector=fake_protect,
                    unprotector=fake_unprotect,
                ),
                loaded,
            )

    def test_invalid_plaintext_is_never_replaced(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            secret = Path(temporary) / "invalid.json"
            original = b"not-json"
            secret.write_bytes(original)

            with self.assertRaisesRegex(SecretProtectionError, "valid JSON"):
                read_json_secret(
                    secret,
                    purpose="gmail-token",
                    protector=fake_protect,
                    unprotector=fake_unprotect,
                )

            self.assertEqual(secret.read_bytes(), original)

    def test_envelope_cannot_be_swapped_between_token_and_client_credentials(self) -> None:
        envelope = encode_envelope("gmail-token", b"protected-fixture")

        with self.assertRaisesRegex(SecretProtectionError, "different purpose"):
            decode_envelope(envelope, "gmail-client-credentials")

    def test_is_protected_secret_reads_only_the_format_marker(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            secret = Path(temporary) / "oauth.dpapi"
            secret.write_bytes(encode_envelope("gmail-token", b"protected-fixture"))

            self.assertTrue(is_protected_secret(secret))

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI is available only on Windows")
    def test_real_dpapi_round_trip_is_bound_to_the_current_windows_user(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            secret = Path(temporary) / "oauth.dpapi"
            marker = "synthetic-current-user-secret"

            write_json_secret(secret, {"token": marker}, purpose="gmail-token")

            self.assertTrue(is_protected_secret(secret))
            self.assertNotIn(marker.encode("utf-8"), secret.read_bytes())
            self.assertEqual(
                read_json_secret(secret, purpose="gmail-token")["token"],
                marker,
            )


if __name__ == "__main__":
    unittest.main()
