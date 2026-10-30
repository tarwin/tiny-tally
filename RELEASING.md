# Releasing

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
