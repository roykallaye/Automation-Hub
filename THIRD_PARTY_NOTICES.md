# InnPilot third-party notices

The Windows automation engine contains open-source components. Exact versions for a built installer are recorded in its bundled `worker/requirements-resolved.txt` manifest.

## PDF processing

InnPilot uses `pypdf` 6.14.2 to crop and write invoice copies. `pypdf` is provided under the BSD 3-Clause license.

- Project and license: https://github.com/py-pdf/pypdf

InnPilot uses `pypdfium2` 5.12.1 for local PDF text extraction and page rendering. The Python bindings are offered under Apache-2.0 or BSD-3-Clause; the bundled PDFium binaries use a BSD-style license. The package's build-license files are collected into the worker by the release build.

- Project and licensing: https://github.com/pypdfium2-team/pypdfium2

Pillow 12.3.0 is used only for in-memory image handling in local OCR and is provided under the HPND license.

- Project and license: https://github.com/python-pillow/Pillow

## Tesseract OCR runtime and language data

The offline OCR executable is Tesseract 5.5.3, provided under Apache License 2.0. The Windows runtime is prepared only from the exact official release asset recorded in `scripts/prepare-tesseract-runtime.mjs`; its byte size and SHA-256 are checked before extraction, its version is executed and checked, and every shipped runtime file is recorded in `runtime-manifest.json`. `TESSERACT-LICENSE.txt` is bundled beside the runtime.

- Project and license: https://github.com/tesseract-ocr/tesseract

The official Windows runtime also dynamically links third-party libraries supplied by that release, including Leptonica and image, text, compression, and C/C++ runtime libraries. Their exact DLL inventory and hashes are captured in the runtime manifest. Commercial approval still requires the release owner to preserve all applicable notices and complete formal license review of that exact pinned runtime; replacement of PyMuPDF removes the known AGPL dependency but does not waive this final review.

The Italian, English, and German `tessdata_fast` models are from the official Tesseract OCR project and are provided under Apache License 2.0. Their license is bundled beside the models at `automation/ocr/tessdata/LICENSE`.

- Language models: https://github.com/tesseract-ocr/tessdata_fast

## Build-only extraction tool

The release build uses `7zip-bin` 5.2.0 and a SHA-256-pinned official 7-Zip 26.02 executable only to extract the official Tesseract package. Neither extraction tool is included in the InnPilot installer. `7zip-bin` is MIT-licensed; 7-Zip licensing is documented by its publisher.

- 7zip-bin: https://github.com/develar/7zip-bin
- 7-Zip license: https://www.7-zip.org/license.txt

## Google client libraries

The Google API, authentication, and OAuth libraries used to create Gmail drafts are Apache-2.0 licensed. InnPilot requests compose/draft access and does not automatically send mail.

- Google API Python Client: https://github.com/googleapis/google-api-python-client
- Google Auth: https://github.com/googleapis/google-auth-library-python

## PyInstaller

The private Windows worker is packaged with PyInstaller under its GPL license plus the project's exception permitting distribution of bundled applications. This exception does not change the licenses of bundled libraries.

- Project and license: https://pyinstaller.org/en/stable/license.html

This notice is an engineering inventory, not legal advice. Release approval must include license review, the checksum manifest, and the exact dependency manifest produced by the release build.
