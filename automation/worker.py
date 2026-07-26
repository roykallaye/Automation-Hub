from __future__ import annotations

import importlib
import os
from pathlib import Path
import sys


WORKER_VERSION = "0.1.0"
WORKFLOWS = {
    "process_fatture.py": ("invoices.process_fatture", "main"),
    "create_gmail_draft.py": ("gmail_drafts.create_gmail_draft", "main"),
    "copy_scans.py": ("scans.copy_scans", "run"),
    "extract_scan_text.py": ("ocr.extract_scan_text", "run"),
    "process_contratti.py": ("contracts.process_contratti", "process"),
}
REQUIRED_MODULES = ("PIL", "pypdf", "pypdfium2", "googleapiclient", "google_auth_oauthlib")


def health_check() -> int:
    missing: list[str] = []
    for module_name in REQUIRED_MODULES:
        try:
            importlib.import_module(module_name)
        except ImportError:
            missing.append(module_name)
    if missing:
        print("Missing bundled modules: " + ", ".join(missing), file=sys.stderr)
        return 2
    try:
        from ocr.extract_scan_text import tesseract_version

        tesseract_version()
    except (ImportError, OSError, RuntimeError):
        print("The bundled local OCR engine failed its health check.", file=sys.stderr)
        return 2
    print(f"InnPilot automation worker {WORKER_VERSION} ready")
    return 0


def run_workflow(script_argument: str, workflow_args: list[str]) -> int:
    script_path = Path(script_argument).resolve()
    workflow = WORKFLOWS.get(script_path.name.casefold())
    if workflow is None:
        print("This automation is not included in the InnPilot worker allowlist.", file=sys.stderr)
        return 2
    if not script_path.is_file():
        print("The selected managed automation script is missing.", file=sys.stderr)
        return 2

    automation_root = script_path.parent.parent
    os.environ["INNPILOT_AUTOMATION_ROOT"] = str(automation_root)
    sys.argv = [str(script_path), *workflow_args]
    module_name, entrypoint = workflow

    try:
        module = importlib.import_module(module_name)
        if entrypoint == "main":
            result = module.main()
        elif entrypoint == "run":
            result = module.run(module.parse_args())
        else:
            result = module.process(module.parse_args())
        return int(result or 0)
    except SystemExit as error:
        return int(error.code or 0) if isinstance(error.code, int) else 2
    except KeyboardInterrupt:
        print("Automation cancelled by the operator.", file=sys.stderr)
        return 130
    except Exception as error:
        print(
            f"{script_path.stem} needs attention: {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        return 2


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == "--version":
        print(f"InnPilot automation worker {WORKER_VERSION}")
        return 0
    if len(sys.argv) == 2 and sys.argv[1] == "--health-check":
        return health_check()
    if len(sys.argv) == 3 and sys.argv[1] == "--ocr-self-test":
        from ocr.extract_scan_text import run_ocr_self_test

        if run_ocr_self_test(Path(sys.argv[2]).resolve()):
            print("InnPilot local OCR self-test passed")
            return 0
        print("InnPilot local OCR self-test failed.", file=sys.stderr)
        return 2
    if len(sys.argv) < 2:
        print("A managed InnPilot automation must be selected.", file=sys.stderr)
        return 2
    if sys.argv[1] == "-c":
        print("The InnPilot worker does not execute arbitrary Python code.", file=sys.stderr)
        return 2
    return run_workflow(sys.argv[1], sys.argv[2:])


if __name__ == "__main__":
    raise SystemExit(main())
