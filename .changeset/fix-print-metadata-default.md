---
"@aubron/ankerts-cli": patch
---

Fix `print`: the automatic slicer metadata-fix never ran on a real upload. The
`uploadAndPrint` call checked a renamed/nonexistent `--fix-metadata` flag (always
false) while only the `--dry-run` report used the correct `--no-fix-metadata`
opt-out — so dry-run looked right but every actual upload skipped the `;TIME:`
injection (third-party slices showed 00:00 ETA). The value is now computed once
and used in both paths.
