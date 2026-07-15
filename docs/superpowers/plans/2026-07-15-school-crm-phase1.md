# Kidzonia School CRM Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 1 Hello Parents–parity MVP: CRM leads → admissions → students/attendance/leave → fees (mock gateway) → daily diary/logs → communication → worksheets → parent portal → role dashboards, on the Franchise Model stack.

**Architecture:** Express API (:4020) with JSON-file repository (`server/data/db.json`), JWT auth + granular RBAC + branch-scoped tenancy; React 19 + Vite (:5173) staff app with role-based left nav plus a mobile-first parent portal in the same app. All external channels (payment gateway, SMS/WhatsApp/push/email) simulated behind service abstractions.

**Tech Stack:** Node 20+ (`node --test` for API tests), Express 4, jsonwebtoken, bcryptjs, multer (media upload), React 19, Vite, react-router-dom 7, zustand, @tanstack/react-query, react-hook-form + zod, @hello-pangea/dnd, recharts, lucide-react, react-hot-toast.

**Spec:** `docs/superpowers/specs/2026-07-15-school-crm-phase1-design.md`

---

## File map

```
School CRM/
├─ package.json, vite.config.js, index.html, eslint.config.js, .gitignore
├─ server/
│  ├─ index.js            # express bootstrap, mounts routers
│  ├─ db.js               # JSON repository: load/save, CRUD w/ stamps + soft delete
│  ├─ auth.js             # JWT, requireAuth, requirePermission, branchScope
│  ├─ audit.js            # audit(userId, action, collection, id, before, after)
│  ├─ seed.js             # full demo dataset (idempotent, runs when db.json missing)
│  ├─ notify.js           # notification engine (in-app real, other channels stubbed→log)
│  ├─ routes/
│  │  ├─ auth.routes.js  core.routes.js  crm.routes.js  admissions.routes.js
│  │  ├─ students.routes.js  fees.routes.js  daily.routes.js  comms.routes.js
│  │  └─ media.routes.js  dashboards.routes.js
│  ├─ uploads/            # media files (gitignored)
│  └─ tests/flows.test.js # node --test smoke tests, 5 critical flows
└─ src/
   ├─ main.jsx, App.jsx (router), index.css
   ├─ api/client.js       # fetch wrapper, JWT header, 401 logout
   ├─ store/useStore.js   # zustand auth store (persisted)
   ├─ components/         # Layout.jsx (staff shell), ParentLayout.jsx, ProtectedRoute.jsx,
   │                      # DataTable.jsx, Modal.jsx, StatCard.jsx, Badge.jsx, EmptyState.jsx
   └─ pages/
      ├─ Login.jsx  Dashboard.jsx
      ├─ crm/Leads.jsx (kanban+list)  crm/LeadDetail.jsx
      ├─ admissions/Applications.jsx  admissions/ApplicationDetail.jsx
      ├─ students/Students.jsx  StudentDetail.jsx  Attendance.jsx  LeaveRequests.jsx  ClassesSections.jsx
      ├─ fees/FeeSetup.jsx  Invoices.jsx  Collections.jsx  FeeReports.jsx
      ├─ daily/DiaryFeed.jsx  DailyLogs.jsx  CheckInOut.jsx  Albums.jsx  HomeworkPage.jsx
      ├─ comms/Announcements.jsx  Chat.jsx  CalendarEvents.jsx  Worksheets.jsx
      ├─ settings/Settings.jsx (branches, years, programs, classes, feeHeads, users, permissions, auditLog)
      └─ parent/ParentHome.jsx  ParentAttendance.jsx  ParentFees.jsx  ParentChat.jsx
         ParentNotices.jsx  ParentCalendar.jsx  ParentLeave.jsx  ParentWorksheets.jsx  ParentProfile.jsx
```

## Data shapes (contract — all records also get `id`, `createdAt/By`, `updatedAt/By`, `deletedAt:null`)

- **users** `{name,email,phone,passwordHash,role,branchId|null,guardianId?,active}` roles: `super_admin|branch_admin|front_desk|accountant|teacher|parent`
- **rolePermissions** `{role,permissions:{[module]:{view,create,edit,delete}}}` modules: `crm,admissions,students,attendance,fees,daily,comms,worksheets,settings,dashboards`
- **branches** `{name,code,address,phone}` · **academicYears** `{branchId,name,startDate,endDate,active}` · **programs** `{branchId,name,ageMinMonths,ageMaxMonths}` · **classes** `{branchId,academicYearId,programId,name,capacity}` · **sections** `{classId,name,capacity,teacherId}`
- **leads** `{branchId,childName,childDob,programId,parentName,phone,email,source,stage,counsellorId,expectedStart,feeBracket,lostReason,convertedApplicationId}` stages: `new,contacted,visit_scheduled,visited,demo,negotiation,converted,lost`; sources: `walk_in,phone,website,whatsapp,referral,ads,event,parent_app`
- **leadActivities** `{leadId,type,note,byId}` · **followUpTasks** `{leadId,dueDate,channel,note,status:open|done,assigneeId}`
- **applications** `{branchId,leadId,programId,childName,childDob,gender,guardiansDraft:[{name,relationship,phone,email}],siblingStudentIds,status:draft|submitted|waitlisted|offered|confirmed|rejected,decisions:[{status,byId,at,note}]}`
- **applicationDocuments** `{applicationId,type,status:pending|received|verified,mediaId}`
- **families** `{branchId,name,address}` · **guardians** `{familyId,name,relationship,phone,email,userId,notificationPrefs:{inApp,push,sms,whatsapp,email}}` · **guardianStudentLinks** `{guardianId,studentId,relationship,isPrimary}`
- **students** `{branchId,familyId,applicationId,firstName,lastName,dob,gender,photoId,bloodGroup,allergies,medicalNotes,emergencyContacts:[],authorisedPickups:[],rollNo,status:active|on_leave|withdrawn|alumni}`
- **enrolments** `{studentId,academicYearId,classId,sectionId,joinedAt,leftAt}`
- **attendanceRecords** `{branchId,sectionId,studentId,date,status:present|absent|late|half_day|leave,reason,markedBy}` (unique per student+date)
- **leaveRequests** `{studentId,fromDate,toDate,reason,status:pending|approved|rejected,decidedBy}`
- **feeHeads** `{branchId,name,code}` · **feeStructures** `{branchId,academicYearId,programId,name,lines:[{feeHeadId,amount,cycle:one_time|monthly|quarterly|term|annual}]}`
- **invoices** `{branchId,studentId,number:INV-<branchCode>-<seq>,dueDate,lines:[{feeHeadId,description,amount}],discountTotal,total,paidAmount,status:pending|partial|paid|overdue|cancelled}`
- **payments** `{branchId,invoiceId,studentId,amount,mode:gateway|cash|cheque|pos,gatewayRef,status:initiated|success|failed}` · **receipts** `{paymentId,number:RCP-<branchCode>-<seq>}`
- **discounts** `{branchId,studentId,invoiceId?,name,amount,reason,status:pending|approved|rejected,approvedBy}` · **refunds** same shape + `paymentId`
- **ledgerEntries** `{branchId,studentId,type:charge|payment|refund|adjustment,refId,amount,balanceAfter}` (charge positive, payment negative)
- **diaryPosts** `{branchId,sectionId,studentIds:[]|null,text,mediaIds,authorId,publishedAt,likes:[guardianUserId]}` (`studentIds:null` = whole section) · **diaryComments** `{postId,byId,text}`
- **dailyLogs** `{branchId,studentId,date,type:meal|nap|diaper|mood|health,data:{...},byId}`
- **checkInOuts** `{branchId,studentId,date,inAt,outAt,pickupPerson}`
- **albums** `{branchId,sectionId,title,mediaIds}` · **mediaAssets** `{branchId,filename,mimetype,size,path,studentIds:[]}` · **homework** `{branchId,sectionId,title,description,dueDate,mediaIds}`
- **consents** `{guardianId,studentId,type:'media_share',granted}`
- **announcements** `{branchId|null,audience:{type:all|branch|class|users,ids:[]},title,body,mediaIds,requiresAck,publishedAt}` · **announcementReads** `{announcementId,userId,readAt,ackAt}`
- **chatThreads** `{branchId,type:parent_teacher|parent_office,studentId,participantIds}` · **messages** `{threadId,byId,text,readBy:[]}`
- **events** `{branchId,title,date,type:holiday|ptm|function|other,description,rsvpEnabled}` · **eventRsvps** `{eventId,guardianUserId,response:yes|no|maybe}`
- **publishedResources** `{branchId,title,description,mediaId,audience:{type,ids},publishedAt,publishedBy}`
- **notifications** `{userId,title,body,type,refType,refId,readAt}` · **notificationLog** `{notificationId,channel,status:sent|stubbed}`
- **auditLog** `{branchId,userId,action,collection,recordId,before,after}`

## API surface (all under `/api`, JWT required except login/webhook)

| Area | Routes |
|---|---|
| auth | `POST /auth/login` → `{token,user}` · `GET /me` · `GET/PUT /me/notification-prefs` |
| core | CRUD `/branches /academic-years /programs /classes /sections /fee-heads /users /role-permissions` · `GET /audit-log` |
| crm | CRUD `/leads` (+`?stage=&counsellorId=`) · `POST /leads/:id/stage` · `POST /leads/:id/activities` · CRUD `/follow-ups` · `GET /leads/check-duplicate?phone=&email=&childName=` · `POST /leads/:id/convert` → creates application · `GET /crm/analytics` |
| admissions | CRUD `/applications` · `POST /applications/:id/status` (waitlist/offer/reject) · CRUD `/applications/:id/documents` · `POST /applications/:id/confirm` `{sectionId, feeStructureId}` → family+guardians+users+student+enrolment+first invoice |
| students | CRUD `/students` · `GET /students/:id/full` (profile+guardians+enrolment+ledger+attendance%) · `GET/POST /attendance?sectionId=&date=` (bulk upsert; absent/late → notify guardians) · CRUD `/leave-requests` · `POST /leave-requests/:id/decide` (approve → write `leave` attendance rows) |
| fees | CRUD `/fee-structures` · `POST /invoices/generate` `{studentId,feeStructureId,months}` (pro-rata by joinedAt) · CRUD `/invoices` · CRUD `/discounts` + `POST /discounts/:id/decide` · `POST /payments/offline` · `POST /payments/initiate` → `{paymentId,gatewayRef}` · `POST /payments/mock-gateway/complete` `{gatewayRef,outcome}` → calls webhook internally · `POST /payments/webhook` (idempotent: success → receipt + ledger + invoice status + notify) · `GET /fees/reports/daybook|outstanding|collections` · `POST /fees/send-reminders` |
| daily | CRUD `/diary-posts` (+likes/comments) — parent GET filtered by children + media consent · CRUD `/daily-logs?studentId=&date=` · `GET/POST /check-in-out` · CRUD `/albums` · CRUD `/homework` · `GET/PUT /consents` |
| comms | CRUD `/announcements` · `POST /announcements/:id/read|ack` · `GET/POST /chat/threads` + `GET/POST /chat/threads/:id/messages` · CRUD `/events` + `POST /events/:id/rsvp` · CRUD `/published-resources` |
| media | `POST /media` (multer, multipart) · `GET /media/:id/file` (consent-checked for parents) |
| notifications | `GET /notifications` · `POST /notifications/:id/read` |
| dashboards | `GET /dashboards/summary` (role-shaped payload) |

## Cross-cutting rules

- **Branch scope:** middleware sets `req.scope = {branchId}` for non-`super_admin` staff; every repo list call filters by it. Parents: `req.scope = {studentIds}` derived from guardianStudentLinks; parent-facing endpoints filter by those.
- **Notify helper:** `notifyGuardiansOfStudent(db, studentId, payload)` → resolve guardians → their userIds → create `notifications` + one `notificationLog` row per enabled channel pref (`inApp`→`sent`, others→`stubbed`).
- **Audit:** wrap create/update/delete on `students, applications, invoices, payments, discounts, refunds, rolePermissions, consents`.
- **Money:** integers (paise not needed — whole rupees fine for demo), `total = sum(lines) - discountTotal`, invoice status derived from `paidAmount`.

---

### Task 1: Scaffold project

**Files:** Create `package.json`, `vite.config.js`, `index.html`, `eslint.config.js`, `.gitignore`, `src/main.jsx`, `src/App.jsx`, `src/index.css`, `server/index.js` (health route only).

- [ ] Copy dependency set from Franchise Model `package.json`; add `multer`; name `school-crm`; scripts: `dev`, `server`, `start` (concurrently), `build`, `lint`, `test": "node --test server/tests/"`.
- [ ] `vite.config.js`: react plugin + proxy `/api` → `http://localhost:4020`.
- [ ] `server/index.js`: express + cors + json({limit:'10mb'}) + `GET /api/health` → `{ok:true}` + listen 4020.
- [ ] `.gitignore`: `node_modules dist server/data/db.json server/uploads`.
- [ ] Run `npm install`; verify `npm run server` then `curl :4020/api/health` returns `{"ok":true}`.
- [ ] Commit `chore: scaffold school-crm project`.

### Task 2: Repository, auth, audit, notify core

**Files:** Create `server/db.js`, `server/auth.js`, `server/audit.js`, `server/notify.js`, `server/tests/helpers.js`, `server/tests/core.test.js`. Modify `server/index.js`.

- [ ] `db.js`: singleton loading `server/data/db.json` (call `seed()` if missing); export `getDb()`, `save()`, and repo helpers: `list(coll, filter)` (excludes soft-deleted, applies branch scope object), `find(coll,id)`, `insert(coll, data, userId)` (uuid id + stamps), `update(coll,id,patch,userId)`, `softDelete(coll,id,userId)`, `nextNumber(key)` for invoice/receipt sequences.
- [ ] `auth.js`: `signToken(user)`, `requireAuth` (Bearer JWT → `req.user`, load fresh user, attach scope), `requirePermission(module, action)` reading `rolePermissions` (super_admin bypass), `parentOnly`, `staffOnly`.
- [ ] `audit.js` + `notify.js` per contracts above.
- [ ] Test: login with seeded super admin returns token; scoped list hides other branch. Run `npm test` → PASS. Commit `feat: repository, auth, rbac, audit, notification core`.

### Task 3: Seed data + core/settings routes

**Files:** Create `server/seed.js`, `server/routes/auth.routes.js`, `server/routes/core.routes.js`. Modify `server/index.js`.

- [ ] Seed: HQ + 2 branches (Jubilee Hills `JH`, Gachibowli `GB`); AY 2026-27 active; programs Daycare/Playgroup/Nursery/Jr KG/Sr KG per branch; classes + sections A/B; fee heads (admission, tuition, transport, meals, activity, uniform, books, deposit, late_fee); fee structures per program; users one per role (emails per spec, bcrypt `password`); default rolePermissions matrix; ~40 students in families (some multi-child) w/ guardians+links+parent users+consents; enrolments; sample leads across all stages w/ activities+tasks; applications in various states; invoices (paid/partial/pending/overdue) w/ payments+receipts+ledger; diary posts+comments+likes; daily logs today; check-ins; albums; homework; announcements(+reads); chat threads+messages; events; published worksheets; notifications.
- [ ] Routes: login + `/me` + prefs; CRUD for all core collections with `requirePermission('settings',…)`; audit-log list (super/branch admin).
- [ ] Test: seeded parent login sees own children only. `npm test` PASS. Commit `feat: seed data and core settings API`.

### Task 4: CRM API

**Files:** Create `server/routes/crm.routes.js`, `server/tests/crm.test.js`. Modify `server/index.js`.

- [ ] Leads CRUD + stage transition (stamps activity, lost requires `lostReason`) + activities + follow-ups (+overdue computed) + duplicate check + round-robin assign endpoint + analytics (counts by stage/source/counsellor, conversion %, avg days-to-convert).
- [ ] `POST /leads/:id/convert`: guard already-converted; create application copying child/parent/program; set stage `converted`, link ids; audit.
- [ ] Test: create lead → convert → application has copied fields, lead linked. PASS. Commit `feat: CRM leads module`.

### Task 5: Admissions API (critical flow 1)

**Files:** Create `server/routes/admissions.routes.js`, `server/tests/admissions.test.js`. Modify `server/index.js`.

- [ ] Applications CRUD + status transitions w/ decision log + documents checklist CRUD + waitlist (auto when section at capacity).
- [ ] `POST /applications/:id/confirm {sectionId, feeStructureId}`: transactionally create family → guardians (+parent users w/ temp password `password`, notificationPrefs default all-on) → student (+rollNo next in section) → guardianStudentLinks → media consents (granted default, per guardian) → enrolment → first invoice from structure's one_time + first-cycle lines → ledger charge → welcome notification. Audit each.
- [ ] Test (flow 1): lead→convert→confirm → assert student exists, parent user login works, invoice + ledger exist. PASS. Commit `feat: admissions module with confirm pipeline`.

### Task 6: Students, attendance, leave API (flows 2, 5)

**Files:** Create `server/routes/students.routes.js`, `server/tests/students.test.js`. Modify `server/index.js`.

- [ ] Students CRUD + `/full` composite; guardians/links management; status lifecycle.
- [ ] Attendance: `GET ?sectionId&date` roster w/ existing marks; `POST` bulk upsert array `[{studentId,status,reason}]`; on `absent|late` → `notifyGuardiansOfStudent` ("Aarav marked absent today"); monthly % endpoint.
- [ ] Leave: parent create (own child only), staff list, decide → approved writes `leave` attendance rows for each date in range + notify parent.
- [ ] Tests: absent mark creates guardian notification (+log rows per pref); approved leave reflects in attendance GET. PASS. Commit `feat: students, attendance with absence alerts, leave workflow`.

### Task 7: Fees API (flow 3)

**Files:** Create `server/routes/fees.routes.js`, `server/tests/fees.test.js`. Modify `server/index.js`.

- [ ] Fee structures CRUD; invoice generation (monthly cycle → 1 invoice per month requested, pro-rata first month by joinedAt day); invoices CRUD/list w/ filters + auto `overdue` flagging on read.
- [ ] Discounts CRUD + approve/reject (approved & linked to unpaid invoice → recompute discountTotal/total, audit).
- [ ] Payments: offline (immediate success path); `initiate` → payment `initiated` + `gatewayRef:'MOCKPAY-'+uuid`; `mock-gateway/complete` simulates gateway → invokes webhook logic; `webhook` idempotent by gatewayRef: success → payment success, receipt w/ number, invoice paidAmount/status, ledger payment entry, notify guardians w/ receipt no. Refunds w/ approval → ledger + audit.
- [ ] Reports: daybook (payments by date), outstanding (per student w/ aging), collections (by head/branch/mode). `send-reminders`: notify guardians of all pending/overdue invoices.
- [ ] Test (flow 3): generate → initiate → complete → webhook → assert receipt, invoice paid, ledger balance, notification; replay webhook → no duplicate. PASS. Commit `feat: fees module with mock gateway, receipts, ledger, reports`.

### Task 8: Daily engagement + media API (flow 4)

**Files:** Create `server/routes/daily.routes.js`, `server/routes/media.routes.js`, `server/tests/daily.test.js`. Modify `server/index.js`.

- [ ] Media: multer disk storage to `server/uploads`; POST returns asset; GET streams file — parent access requires child tagged + `media_share` consent granted (group/untagged section media allowed).
- [ ] Diary: posts CRUD (teacher: own sections), likes toggle, comments; parent feed endpoint: posts for children's sections or tagging child, media filtered per consent; notify guardians on publish.
- [ ] Daily logs CRUD (typed data validated per type: meal `{meal,items,ate:'all|some|none',newFood}`, nap `{start,end}`, diaper `{time,kind}`, mood `{mood,note}`, health `{flag,note}`); check-in/out upsert per day; albums CRUD; homework CRUD (+notify); consents GET/PUT (parent edits own).
- [ ] Test (flow 4): teacher posts w/ media to section; consented parent feed shows post+today logs; revoked-consent guardian gets post but media blocked. PASS. Commit `feat: daily diary, logs, checkin, albums, homework, consent-gated media`.

### Task 9: Communication + worksheets API

**Files:** Create `server/routes/comms.routes.js`, `server/routes/dashboards.routes.js`, `server/tests/comms.test.js`. Modify `server/index.js`.

- [ ] Announcements: audience resolution → notify resolved users; read/ack endpoints; read-stats for author. Chat: find-or-create thread (parent↔class teacher / office), messages + readBy, unread counts. Events CRUD + RSVP + reminder notify. Published resources CRUD, parent list filtered by audience. Notifications list/read.
- [ ] Dashboards summary per role (principal/counsellor/accountant/teacher/HQ payloads per spec).
- [ ] Test: class-targeted announcement notifies exactly that class's guardians; parent sends chat message, teacher unread count increments. PASS. Commit `feat: communication, events, worksheets, dashboards API`.

### Task 10: Frontend foundation

**Files:** Create `src/api/client.js`, `src/api/api.js`, `src/store/useStore.js`, `src/components/{Layout,ParentLayout,ProtectedRoute,DataTable,Modal,StatCard,Badge,EmptyState}.jsx`, `src/pages/Login.jsx`, `src/pages/Dashboard.jsx`, `src/index.css`. Modify `src/App.jsx`.

- [ ] client.js: JWT from store, JSON + FormData support, 401 → logout. api.js: typed methods per API table. Store: persisted `{token,user}`.
- [ ] Layout: left nav from Section 4 IA (Phase-1 items live; Academics/Audit/Transport/Staff = disabled "Phase 2/3" stubs), branch switcher (super_admin), notification bell w/ unread dropdown, role-filtered items via permissions. ParentLayout: mobile-first, bottom nav, child switcher.
- [ ] Router: `/login`, staff routes under Layout, `/parent/*` under ParentLayout; ProtectedRoute redirects by role (parent → `/parent`).
- [ ] Design system in index.css: CSS vars, Inter-ish system stack, sidebar, cards, tables, badges, forms — visually consistent, clean, Kidzonia accent (warm orange `#f97316` + slate).
- [ ] Dashboard page renders role-shaped summary w/ StatCards + recharts. Verify login→dashboard for super_admin + parent. Commit `feat: app shell, auth flow, role dashboards`.

### Task 11: CRM + Admissions pages

**Files:** Create `src/pages/crm/Leads.jsx`, `src/pages/crm/LeadDetail.jsx`, `src/pages/admissions/Applications.jsx`, `src/pages/admissions/ApplicationDetail.jsx`. Modify `src/App.jsx`.

- [ ] Leads: kanban (dnd across stages; drop→stage API; lost prompts reason) + list toggle + quick-add modal (<60s: child, parent, phone, source, program) + duplicate warning inline + filters + analytics strip (funnel, source, counsellor conversion).
- [ ] LeadDetail: profile, timeline, activity composer, follow-up tasks (overdue red), Convert button → navigates to created application.
- [ ] Applications: pipeline list w/ status chips + capacity/waitlist indicators. ApplicationDetail: form, documents checklist (upload/mark received/verified), status actions, **Confirm modal** (pick section + fee structure) → success shows created student + invoice links.
- [ ] Manual check: walk-in→convert→confirm end-to-end in browser. Commit `feat: CRM and admissions UI`.

### Task 12: Students, attendance, leave, fees pages

**Files:** Create `src/pages/students/{Students,StudentDetail,Attendance,LeaveRequests,ClassesSections}.jsx`, `src/pages/fees/{FeeSetup,Invoices,Collections,FeeReports}.jsx`. Modify `src/App.jsx`.

- [ ] Students directory (search/filter/status); StudentDetail tabs: profile+medical+pickups / guardians / attendance % / fee ledger / daily logs.
- [ ] Attendance: pick section+date → roster w/ one-tap P/A/L/H cycle, bulk "all present", late-reason inline, save → toast "guardians notified".
- [ ] LeaveRequests approve/reject; ClassesSections manage capacity+teacher.
- [ ] FeeSetup: heads + structure builder (lines w/ head, amount, cycle). Invoices: list w/ status filters + generate modal + detail drawer (lines, discounts, payments, receipt print view). Collections: record offline payment; dues dashboard + "Send reminders". FeeReports: daybook/outstanding/collections tables + CSV export.
- [ ] Commit `feat: students, attendance, leave, fees UI`.

### Task 13: Daily, communication, worksheets, settings pages

**Files:** Create `src/pages/daily/{DiaryFeed,DailyLogs,CheckInOut,Albums,HomeworkPage}.jsx`, `src/pages/comms/{Announcements,Chat,CalendarEvents,Worksheets}.jsx`, `src/pages/settings/Settings.jsx`. Modify `src/App.jsx`.

- [ ] DiaryFeed: composer (section/child target, text, multi-photo upload, ≤30s flow), feed cards w/ likes/comments. DailyLogs: per-section grid, tap child → typed log entry forms. CheckInOut: roster in/out buttons + pickup person. Albums grid. Homework list+create.
- [ ] Announcements: composer w/ audience picker + requiresAck + read/ack stats. Chat: thread list + message pane. CalendarEvents: month grid + event CRUD + RSVP counts. Worksheets: upload + publish w/ audience.
- [ ] Settings tabs: branches, years, programs, classes/sections, fee heads, users, **permission matrix editor** (checkbox grid per role×module×action), notification templates (static list ok), audit log viewer w/ filters.
- [ ] Commit `feat: daily engagement, communication, worksheets, settings UI`.

### Task 14: Parent portal

**Files:** Create `src/pages/parent/{ParentHome,ParentAttendance,ParentFees,ParentChat,ParentNotices,ParentCalendar,ParentLeave,ParentWorksheets,ParentProfile}.jsx`. Modify `src/App.jsx`.

- [ ] Home: child switcher, today strip (check-in, meals, nap), diary feed w/ like/comment, homework. Attendance: month calendar + %. Fees: invoices w/ **Pay Now** → mock gateway modal (choose UPI/card, success/fail simulate) → receipt view. Chat w/ teacher/office. Notices w/ ack. Calendar+RSVP. Leave submit/track. Worksheets download. Profile: guardians, consents toggles, notification prefs.
- [ ] Manual check flows 2–5 as parent in mobile viewport. Commit `feat: parent portal`.

### Task 15: Tests green, README, demo script, parity check

**Files:** Create `README.md`, `server/tests/flows.test.js` (consolidated 5-flow suite). Modify as needed.

- [ ] `npm test` all green; `npm run lint` clean; `npm run build` succeeds.
- [ ] README: setup, seed accounts table, architecture, module map, **demo script** (full lifecycle walkthrough), Section 5A parity checklist w/ status (transport + report-card items marked Phase 2/3), production notes (Postgres/S3/real gateway swap points).
- [ ] Final commit `docs: README, demo script, parity checklist`.
