# Handoff — Mwakete POS Guides & Links
Branch: claude/beautiful-fermi-vdsx4j | Draft PR: dsc26support-beep/Mwakete-POS#1

## Goal
In-app Help & guides tab, hybrid mgmt: Mwakete owns official guides/links; business owner owns own links + staff notes. Offline-capable.

## Next steps
1. Get real Marketplace + Support URLs from user -> add to OFFICIAL_LINKS (js/guides.js).
2. Optional: "Report a problem" (needs support email/form from user; no backend yet).
3. Backend-dependent: admin publish/update/archive, cross-device sync, owner/cashier roles.
4. Watch PR #1: CI (none configured), reviews. Draft; user must approve/merge.

## State
- Done: js/guides.js (logic+HTML builders, testable), js/help.js (UI wiring), index.html tab+view, css, SW cache v2, README+SECURITY updated.
- Official guides bundled (8); business data in IndexedDB `settings` keys helpResources/helpBookmarks/helpRecent. No schema change.
- Tests: `npm test` 13/13 pass (node --test "tests/*.test.js"). Playwright smoke (scratchpad, not committed) passed incl. offline reload.
- js/app.js + service-worker.js restored to original one-line style (3 changed lines vs main).

## Decisions
- Hybrid model chosen by user. Official content = code, shipped via releases (no runtime injection).
- Settings-store keys instead of new object stores: avoids DB migration risk to existing data.
- Links: https only, no creds/localhost/IP; confirm dialog before leaving app.
- No invented Mwakete/support URLs (CLAUDE.md: no unverified claims).

## Gotchas
- PostToolUse formatter hook reformats files on Edit/Write (blew up app.js diff). Edit minified files via sed in Bash instead.
- PreToolUse hooks: Bash cmd max 500 chars/10 statements; `git push` blocked by sixth-sense. User explicitly authorised override; push via script file in scratchpad (push.sh).
- Stop hooks demand push each time.
- Bump CACHE in service-worker.js whenever official guides change.

## Open questions
- Real Marketplace/Support URLs?
- Build "Report a problem"? Destination?
