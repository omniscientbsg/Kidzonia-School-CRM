# Kidzonia School CRM + SIS — Phase 1 Design (Hello Parents Parity)

**Date:** 2026-07-15
**Status:** Approved by user
**Source:** Master Build Prompt (Kidzonia School CRM + SIS). Phase 1 of 4 per Section 9.

## Decisions locked

| Decision | Choice |
|---|---|
| Stack / repo | New standalone project `School CRM/`, same pattern as Franchise Model: React 19 + Vite + Express + JWT/RBAC + JSON-file DB (repo layer swappable for Postgres later) |
| Scope | Phase 1 only — Hello Parents parity MVP (spec Section 9 Phase 1) |
| Parent experience | Parent role in same web app; mobile-first responsive parent portal (PWA-ready later) |
| Integrations | Simulated behind abstractions: mock payment gateway (initiate → pay → webhook → receipt), notification engine with in-app center + stubbed push/SMS/WhatsApp/email channels recorded in a delivery log |
| Compliance assumption | India / DPDP principles: consent tracking for media, audit logging on sensitive actions |
| Ratings/reviews | Dropped (spec 5A optional item) |

## Architecture

- **Project:** `School CRM/` sibling of `Franchise Model/`.
- **API:** Express on **:4020**. Files: `server/index.js` (routes), `server/db.js` (JSON-file repository, `server/data/db.json`, auto-seeded), `server/auth.js` (JWT sign/verify, `requireRole`, `requirePermission`, branch-scoping middleware with HQ override).
- **Web:** Vite + React 19 on :5173, proxies `/api` → :4020. State: zustand (auth) + @tanstack/react-query (server state). UI: lucide-react icons, react-hook-form + zod, react-hot-toast, recharts, @hello-pangea/dnd (lead kanban).
- **Tenancy:** every record carries `branchId`; middleware filters all queries by the caller's branch unless role is `super_admin`. Parents are scoped to their own children via guardian↔student links, not branch.
- **Auditability:** mutations on sensitive collections (fees, admissions, students, permissions, consents) append to `auditLog` (who/what/when/before/after).
- **Soft delete + stamps:** all records get `createdAt/By`, `updatedAt/By`, `deletedAt` (null = live).

## Roles (default, permission matrix editable by super_admin)

`super_admin` (HQ, all branches) · `branch_admin` · `front_desk` (CRM + admissions + admission-stage payments only) · `accountant` · `teacher` (own classes) · `parent` (own children only).

Permissions granular: view/create/edit/delete per module; role→permission map stored in DB, editable in Settings.

## Modules in scope

### Core / Settings
Branches, academic years, programs (Daycare → Sr. KG + early primary), classes & sections (capacity, class-teacher), roles & permission matrix, fee-head config, notification templates, audit log viewer.

### CRM (Module 1)
Multi-channel lead capture (walk-in, phone, website, WhatsApp, referral, ads, event, parent-app enquiry) with auto source. Configurable pipeline stages, default: New → Contacted → Visit Scheduled → Visited → Demo/Trial → Negotiation → Converted → Lost (lost reason required). Kanban + list views. Counsellor assignment (manual + round-robin). Follow-up tasks with due dates + overdue flags. Activity timeline per lead. Duplicate detection on phone/email/child name. One-click Convert → Admission application carrying all data. Funnel + counsellor analytics.

### Admissions (Module 2)
Application per program with age/cut-off eligibility check. Document checklist (birth cert, photos, ID/address proof, immunization, prior records) with received/pending/verified status. Admission/registration fee collection (ties to Finance). Waitlist with class capacity limits. Sibling linking + sibling-discount flag. On confirmation: auto-create Student + Family + Guardian records + parent logins + first invoice. Status pipeline + decision audit trail.

### Students & Family (Module 3)
Student profile: demographics, photo, program/class/section, roll no., blood group, allergies, medical notes, emergency contacts, authorised pickup persons. Families with multiple children; children with multiple guardians (own logins, relationship, per-guardian notification prefs). Attendance: bulk class marking (present/absent/late-with-reason/half-day), **absence auto-notifies guardians**, monthly %. Leave requests: parent submits → teacher/admin approves → reflected in attendance. Status lifecycle: Active → On Leave → Withdrawn → Alumni.

### Fees & Finance (Module 4)
Fee heads configurable per branch/year (admission, tuition, transport, meals, activity, uniform, books, deposit, late fee). Fee plans: one-time / monthly / quarterly / term / annual, installment schedules with due dates. Auto invoice generation per schedule; pro-rata for mid-cycle admission. Discounts (sibling, staff ward, need-based, promotional) with approval workflow + audit. Collections: **mock gateway** (UPI/card/netbanking simulated: initiate → pay → webhook → receipt) + offline (cash/cheque/POS); paperless receipts (printable). Dues dashboard + automated fee-due reminders through notification engine + late-fee rules. Refunds/adjustments with reason + approval + audit. Per-student ledger; day-book, collection, outstanding, head-wise and branch-wise reports.

### Daily / Parent Engagement (Module 9)
Diary feed: teacher posts (text/photos/videos) per class or per child; parents like/comment; teacher replies; batch + scheduled posts. Daily logs: meals (what/how much/new food), nap duration, diaper, mood/behaviour, health flags. Check-in/check-out timestamps. Albums (class/event) shareable, consent-aware. Homework posting. **Consent-gated media:** only consented guardians see their child's media; group content respects opt-outs.

### Communication (Module 10)
Announcements/notices/circulars: audience targeting (all/branch/class/individual), attachments, scheduling, read receipts, acknowledgement-required option. Chat: parent↔teacher and parent↔office threads, working-hours setting, mute/broadcast. Events & calendar / monthly planner with RSVP + auto reminders. **Notification engine:** unified service; channels = in-app (real) + push/SMS/WhatsApp/email (stubbed senders); per-user channel preferences; templates; delivery + read status in `notificationLog`.

### Worksheets (Module 8 subset)
Staff upload worksheet/resource files; publish to audience (class/branch/all) with schedule; parents see in portal. Full repository module deferred to Phase 2.

### Parent portal
Same app, `parent` role, mobile-first layout (bottom nav): Home feed · Attendance · Fees (view + pay in-app via mock gateway, receipts) · Chat · Notices · Calendar · Leave (submit/track) · Worksheets · Profile & Consents. Multi-child switcher under single login.

### Dashboards (Module 14 subset)
Principal: occupancy, dues, enquiry funnel, today's attendance. Counsellor: pipeline + tasks. Accountant: collections vs outstanding. Teacher: my class today (attendance, diary, homework). HQ: cross-branch enrolment/collections/attendance comparison.

## Out of Phase 1 (nav stubs where spec demands visibility)
Academic Planning (M5), Curriculum/Courses (M6), Milestones/Report Cards (M7), full Resource repository (M8), Audit & Observation (M11), Transport (M12), Staff HR (M13), advanced analytics, Hello Parents migration tooling, ratings/reviews.

## Data model (~38 collections)

branches, academicYears, programs, classes, sections, users, rolePermissions, leads, leadActivities, followUpTasks, applications, applicationDocuments, families, guardians, guardianStudentLinks, students, enrolments, attendanceRecords, leaveRequests, feeHeads, feeStructures, feePlans, invoices, payments, receipts, discounts, refunds, ledgerEntries, diaryPosts, diaryComments, dailyLogs (typed: meal/nap/diaper/health/mood), checkInOuts, albums, mediaAssets, homework, consents, announcements, announcementReads, chatThreads, messages, events, eventRsvps, publishedResources, notifications, notificationLog, auditLog.

Chain preserved: `lead.id ← application.leadId ← student.applicationId`.
Finance chain: feeStructure → feePlan → invoice → payment → receipt; every money movement appends ledgerEntry.

## Critical flows (acceptance tests)

1. Walk-in lead captured <60s → assigned → follow-up → converted (no re-typing) → application confirmed → Student + Guardian logins + first invoice auto-created.
2. Teacher marks child absent → each guardian receives notification (in-app + logged channels per prefs).
3. Invoice → parent pays via mock gateway → webhook → receipt issued → ledger updated → appears in day-book.
4. Teacher posts class activity with photos in ≤30s → each parent sees only consent-permitted content + today's meal/nap logs; can comment.
5. Parent submits leave request → admin approves → attendance for those dates reflects leave.

## Seed data
2 branches + HQ. Demo accounts (password `password`): superadmin@kidzonia.com, principal@kidzonia.com, frontdesk@kidzonia.com, accounts@kidzonia.com, teacher@kidzonia.com, parent@kidzonia.com (2 children). ~40 students across programs/classes, sample leads across stages, invoices in various states, diary posts, announcements, events. README includes demo script walking the full lifecycle.

## Testing
Node-based API smoke tests (`server/tests/`) covering the 5 critical flows, runnable via `npm test`.
