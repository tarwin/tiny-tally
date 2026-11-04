# Releasing

0. Tax rules: check `checkedUntil` in `RETURN_RULES` (src/shared/taxReturns.ts)
   and `SCHEDULE_C_YEARS` (src/shared/scheduleC.ts). If a date is near or past,
   re-check the official guidance named in `checkedAgainst` (ATO GST reporting
   and Simpler BAS pages, IRD IR375 and IR372, IRS Instructions for Schedule C,
   CRA RC4022, HMRC VAT Notices 700/12 and 700/22).
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
   gh release upload v<version> release/tiny-tally-<version>-macos-*
   ```

   The script clears other versions' builds out of `release/` before it
   starts, so only this version's four files are there.

4. Check the draft has all seven files (2 Linux, 1 Windows, 2 dmg + 2 zip for macOS), then publish it:
   `gh release edit v<version> --draft=false`.
5. Auto-update: `node scripts/release-manifest.mjs`. It hashes the update
   archives on the release, uploads one `manifest.json` covering every
   platform, and checks each url answers. Apps look for it at
   `releases/latest/download/manifest.json` (tinyjs.json `update.url`), so
   until this runs, installed apps simply see no update. Write the release
   notes before running it: they're shown in the app's update banner.
6. Docs: `sh scripts/publish-docs.sh`. It builds the user guide (`guide/`,
   VitePress), copies it into the microsite repo (`../tarwin-apps-microsites`,
   or set `MICROSITE`) at `tiny-tally/docs/`, commits and pushes, so
   apps.tarwin.art/tiny-tally/docs/ matches this version. The app's
   Help → Tiny Tally Help opens it. The microsite must have no uncommitted
   changes. Update the guide for anything new before releasing: preview
   with `pnpm docs:dev`. New screenshots: `sh scripts/screenshots.sh`, then
   `sh scripts/web-shots.sh` (guide and microsite images), and commit both
   repos.
7. Shelf: `node scripts/shelf.mjs`. Shelf, the tinyjs app store, only
   downloads from tinyjsapp-examples' own releases (`../tinyjsapp-examples`,
   or set `EXAMPLES`), so this copies the release's dmgs, Windows zip and
   Linux tarballs to its `tiny-tally-v<version>` release with the same notes,
   writes Tiny Tally's catalog entry (marked `external`, which
   `shelf/gen-catalog.js` there keeps as is), commits and pushes. That repo
   must have no uncommitted changes. Shelf on a Mac only installs apps whose
   id starts `art.tarwin.`, hence Tiny Tally's id.

## Tax figures, once a year

### The calendar

When each one comes out, roughly. Put these in your own calendar; after each,
update the file, run `pnpm test`, and do a release so apps pick it up.

| When | What | File |
|---|---|---|
| Mid May | AU federal budget: brackets, instant asset write-off, anything announced | `auTaxYears.ts` |
| Late June – July | ATO cents per km and working from home rates for the year starting 1 July | `auTaxYears.ts` |
| June | IRD home office square metre rate | `nzTaxYears.ts` |
| June – July | IRS mid-year mileage changes, if any | `usTaxYears.ts` |
| June – July | ATO BAS and GST rules: move `checkedUntil` on | `taxReturns.ts` |
| Late Sept – Nov | IRD kilometre rates for the year just ended (31 March) | `nzTaxYears.ts` |
| October – November | IRS: Social Security wage base, 1099 threshold, new Schedule C instructions | `usTaxYears.ts`, `scheduleC.ts` |
| December | IRS standard mileage rate for the next calendar year | `usTaxYears.ts` |
| December | NZ: GST rules (IR375 / IR372): move `checkedUntil` on | `taxReturns.ts` |
| December | Canada: CRA RC4022 and the provincial GST/HST rates: move `checkedUntil` on | `taxReturns.ts`, `canada.ts` |
| March | UK: VAT Notices 700/12 and 700/22, and the rates after the Budget: move `checkedUntil` on | `taxReturns.ts`, `uk.ts` |
| Once a year | US state economic nexus thresholds | `usStates.ts` |
| When set by law | NZ Matariki dates past 2034 | `holidays.ts` |
| Any time | Depreciation figures: AU instant asset write-off, NZ low-value asset limit, US section 179 and bonus depreciation | `auTaxYears.ts`, `nzTaxYears.ts`, `depreciation.ts` |

The app tells you as well: a year it has no checked figures for says so on
the page that uses them.

### What to change

The figures change every tax year. When the IRS, ATO or IRD publishes them,
add the next year and set `checked`, and record what you checked each figure
against in `docs/TAX-SOURCES.md`:

- `src/shared/usTaxYears.ts`: 1099-NEC threshold (indexed from 2027) and due
  date, standard mileage rate (watch for mid-year changes, as in July 2026),
  Social Security wage base, 1040-ES due dates.
- `src/shared/scheduleC.ts`: line numbers from the new Instructions for
  Schedule C; move `checkedUntil` on.
- `src/shared/usStates.ts`: re-check each state's economic nexus threshold
  against its `source` page and update `NEXUS_CHECKED`.
- `src/shared/auTaxYears.ts` (each July, and after the May budget): cents per
  km rate, working from home fixed rate (`wfhSet`), instant asset write-off,
  GST threshold, resident tax brackets and Medicare levy.
- `src/shared/nzTaxYears.ts`: kilometre rates by fuel (published after the
  year ends; `kmSet`), home office square metre rate (June; `homeOfficeSet`),
  low-value asset limit, provisional tax threshold and uplifts, tax brackets.
- `src/shared/incomeReturnLines.ts`: the P8 labels (BPI schedule
  instructions) and IR10 boxes, when the forms change.
- `src/shared/dueDates.ts`: BAS, GST, PAYG, provisional tax and TPAR dates.
- `src/shared/holidays.ts`: national public holidays. NZ Matariki dates are
  in law up to 2034; add later ones when they're set.
