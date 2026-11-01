# Releasing

0. Tax rules: check `checkedUntil` in `RETURN_RULES` (src/shared/taxReturns.ts)
   and `SCHEDULE_C_YEARS` (src/shared/scheduleC.ts). If a date is near or past,
   re-check the official guidance named in `checkedAgainst` (ATO GST reporting
   and Simpler BAS pages, IRD IR375 and IR372, IRS Instructions for Schedule C).
   No change: move `checkedUntil` on and update `checkedAgainst`. A changed form
   or new line numbers: add a new rule set or year from the date it applies,
   and keep the old one so earlier returns still work out the same.
1. Bump `version` in `tinyjs.json` and `package.json`, commit, push to `main`.
2. Linux and Windows: run the **release** workflow (Actions → release → Run
   workflow, or `gh workflow run release.yml -f tinyjs_tag=v0.68.0`). It
   builds Linux x86_64 + arm64 in an ubuntu:22.04 container (glibc 2.35
   floor) and Windows x64 (smoke-tested), and uploads them to a **draft**
   release `v<version>`.
3. macOS, on the Mac (needs `TINYJS_SIGN_IDENTITY` and
   `TINYJS_NOTARY_PROFILE`):

   ```sh
   sh scripts/release-mac.sh            # arm64 and x86_64, notarized and stapled
   gh release upload v<version> release/*
   ```

4. Check the draft has all seven files (2 Linux, 1 Windows, 2 dmg + 2 zip for macOS), then publish it:
   `gh release edit v<version> --draft=false`.
5. Auto-update: `node scripts/release-manifest.mjs`. It hashes the update
   archives on the release, uploads one `manifest.json` covering every
   platform, and checks each url answers. Apps look for it at
   `releases/latest/download/manifest.json` (tinyjs.json `update.url`), so
   until this runs, installed apps simply see no update. Write the release
   notes before running it: they're shown in the app's update banner.
