# Bundled local OCR language data

InnPilot bundles the `tessdata_fast` Italian, English, and German language
models so image-only hotel PDFs can be read locally without uploading guest or
employee documents to an external OCR service.

Source repository: https://github.com/tesseract-ocr/tessdata_fast

Files downloaded from the repository's `main` branch on 2026-07-26:

| File | SHA-256 |
| --- | --- |
| `ita.traineddata` | `b8f89e1e785118dac4d51ae042c029a64edb5c3ee42ef73027a6d412748d8827` |
| `eng.traineddata` | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |
| `deu.traineddata` | `19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d` |

The accompanying `LICENSE` is the upstream Apache License 2.0. These models
contain no hotel data. Runtime OCR remains on the Windows PC where InnPilot is
installed.

Model updates must be reviewed, checksum-recorded here, tested against the fake
OCR suite, and released through a new signed InnPilot installer.
