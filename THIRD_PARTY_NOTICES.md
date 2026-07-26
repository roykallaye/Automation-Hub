# InnPilot third-party notices

The Windows automation engine contains open-source components. Exact versions for a built installer are recorded in its bundled `worker/requirements-resolved.txt` manifest.

## PDF and local OCR engine

InnPilot currently uses PyMuPDF 1.28.0 for PDF cropping, embedded-text extraction, rendering, and local OCR integration. PyMuPDF is offered under GNU AGPL v3 or a commercial Artifex license. The current build is suitable for internal evaluation only until the distributor has deliberately selected and documented one of those licensing paths, or replaced this dependency with an approved permissive alternative. Do not treat a successful technical build as commercial-distribution approval.

- Project: https://pymupdf.readthedocs.io/
- License information: https://pymupdf.readthedocs.io/en/latest/about.html#license

## Tesseract language data

The Italian, English, and German `tessdata_fast` models are from the official Tesseract OCR project and are provided under Apache License 2.0. Their license is bundled beside the models at `automation/ocr/tessdata/LICENSE`.

- Project: https://github.com/tesseract-ocr/tessdata_fast

## Google client libraries

The Google API, authentication, and OAuth libraries used to create Gmail drafts are Apache-2.0 licensed. InnPilot requests compose/draft access and does not automatically send mail.

- Google API Python Client: https://github.com/googleapis/google-api-python-client
- Google Auth: https://github.com/googleapis/google-auth-library-python

## PyInstaller

The private Windows worker is packaged with PyInstaller under its GPL license plus the project's exception permitting distribution of bundled applications. This exception does not change the licenses of bundled libraries.

- Project and license: https://pyinstaller.org/en/stable/license.html

This notice is an engineering inventory, not legal advice. Release approval must include license review, the checksum manifest, and the exact dependency manifest produced by the release build.
