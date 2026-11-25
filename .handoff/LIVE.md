# Handoff (live) — Mwakete POS + Firebase

## Goal
Close EVERY capability in the user's "Mwakete POS — Master Capability & Development Reference" PDF (POS-001..172, sections M device/PWA, N optional Mwakete integration, 4 UIs, architecture). FREE only, ALL tests green ("nothing breaks 100%"), work non-stop. After that: security checks + fixes, then report + recommendations.
Full detail: .handoff/20261125-0900-capability-checklist.md (also Drive: Claude Handoffs/mwakete-pos).

## State
- Previous build complete + deployed (https://mwakete-pos.web.app), PR #1 draft, branch claude/pensive-curie-l1iir1. Tests green at last commit (unit 267, browser x10, rules 41, cloud e2e, axe 0).
- This session segment: only read PDF pp1-12 + wrote handoffs. NO code changed since 8f09b85 (+ handoff files).
- User instruction: "complete tasks 1-4 via workarounds, pay nothing, nothing may break". Not yet executed.

## Next steps
1. Read PDF pp13-37: /root/.claude/uploads/ddc10b85-12cb-5e9a-8b4e-f1f85a5d6b09/809ce4bb-Mwakete_POS_Master_Capability_Development_Reference.pdf (max 20 pages/Read; c862978a-... is same file).
2. Write docs/CAPABILITY_MATRIX.md (POS-ID -> done/partial/missing -> proof file/test). Verify in code.
3. Implement gaps free (see handoff list: hold/resume, change due, product fields, split/partial payments + EFTPOS/IB/MPaisa, receipt delivery via mailto/sms/wa.me + queue, txn search/export/audit, reports weekly/monthly/profit, device registration, barcode unknown/hardware, Micro POS UI, price history/rounding/discount authorization).
4. Tasks 1-4 workarounds: delete smoke-test account (firestore:delete + Identity Toolkit admin delete w/ CLI token); API key restriction only with tested rollback; App Check optional no-op until site key; Marketplace = disconnected adapter, no invented APIs.
5. Security review + fixes, final report.

## Decisions (why)
- No paid services (no Blaze/Functions/paid SMS-WhatsApp): use device links + local queue.
- Honest Marketplace stub: API contract unavailable; PDF itself says no invented APIs.
- Run full regression before every deploy.

## Gotchas
- Bash hook: <=10 statements, <=500 chars, no heredocs/inline scripts. Formatter rewrites after Write: Read before Edit.
- e.currentTarget null after await; Playwright waitForFunction async predicate always true.
- Cloud e2e: NODE_PATH=$(npm root -g) npx -y firebase-tools@latest emulators:exec --only auth,firestore --project mwakete-pos "node tests/e2e/firebase-cloud.e2e.js"
- Session context is huge (>800k): prefer fresh session via "continue mwakete-pos handoff".

## Open questions
- Marketplace API contract unavailable. PDF pp13-37 may add requirements (monitoring, recovery, dev rules).
