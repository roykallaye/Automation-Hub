from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


AUTOMATION_ROOT = Path(__file__).resolve().parents[1]
GMAIL_ROOT = AUTOMATION_ROOT / "gmail_drafts"
for path in [str(AUTOMATION_ROOT), str(GMAIL_ROOT)]:
    if path not in sys.path:
        sys.path.insert(0, path)

import create_gmail_draft  # noqa: E402


class FakeCredentials:
    def __init__(self, *, valid: bool = True) -> None:
        self.expired = False
        self.refresh_token = "synthetic-refresh-capability"
        self.valid = valid

    def refresh(self, _request: object) -> None:
        self.expired = False
        self.valid = True

    def to_json(self) -> str:
        return '{"token":"synthetic-token"}'


class GmailSecretIntegrationTests(unittest.TestCase):
    def test_existing_oauth_files_are_loaded_only_through_protected_storage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            credentials_file = root / "gmail_credentials.json"
            token_file = root / "gmail_token.json"
            credentials_file.write_text("{}", encoding="utf-8")
            token_file.write_text("{}", encoding="utf-8")
            fake_credentials = FakeCredentials()
            service = object()

            def read_secret(path: Path, *, purpose: str):
                if path == credentials_file and purpose == "gmail-client-credentials":
                    return {"installed": {"client_id": "synthetic-client"}}
                if path == token_file and purpose == "gmail-token":
                    return {"token": "synthetic-token"}
                self.fail("Unexpected OAuth secret request")

            with (
                patch.object(create_gmail_draft, "CREDENTIALS_FILE", credentials_file),
                patch.object(create_gmail_draft, "TOKEN_FILE", token_file),
                patch.object(create_gmail_draft, "read_json_secret", side_effect=read_secret) as read,
                patch.object(create_gmail_draft, "write_json_secret") as write,
                patch(
                    "google.oauth2.credentials.Credentials.from_authorized_user_info",
                    return_value=fake_credentials,
                ) as from_info,
                patch("googleapiclient.discovery.build", return_value=service) as build,
            ):
                result = create_gmail_draft.get_service()

            self.assertIs(result, service)
            self.assertEqual(read.call_count, 2)
            from_info.assert_called_once_with({"token": "synthetic-token"}, create_gmail_draft.SCOPES)
            write.assert_not_called()
            build.assert_called_once_with(
                "gmail",
                "v1",
                credentials=fake_credentials,
                cache_discovery=False,
            )

    def test_first_authorization_writes_only_a_protected_token(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            credentials_file = root / "gmail_credentials.json"
            token_file = root / "gmail_token.json"
            credentials_file.write_text("{}", encoding="utf-8")
            new_credentials = FakeCredentials()
            flow = Mock()
            flow.run_local_server.return_value = new_credentials
            client_config = {"installed": {"client_id": "synthetic-client"}}

            with (
                patch.object(create_gmail_draft, "CREDENTIALS_FILE", credentials_file),
                patch.object(create_gmail_draft, "TOKEN_FILE", token_file),
                patch.object(
                    create_gmail_draft,
                    "read_json_secret",
                    return_value=client_config,
                ) as read,
                patch.object(create_gmail_draft, "write_json_secret") as write,
                patch(
                    "google_auth_oauthlib.flow.InstalledAppFlow.from_client_config",
                    return_value=flow,
                ) as from_config,
                patch("googleapiclient.discovery.build", return_value=object()),
            ):
                create_gmail_draft.get_service()

            read.assert_called_once_with(
                credentials_file,
                purpose="gmail-client-credentials",
            )
            from_config.assert_called_once_with(client_config, create_gmail_draft.SCOPES)
            flow.run_local_server.assert_called_once_with(port=0)
            write.assert_called_once_with(
                token_file,
                {"token": "synthetic-token"},
                purpose="gmail-token",
            )
            self.assertFalse(token_file.exists())


if __name__ == "__main__":
    unittest.main()
