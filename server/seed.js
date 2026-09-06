import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { rupees as R } from './fees/money.js'
import { instanceId } from './tasks/ids.js'
import { localDate, DEFAULT_TZ } from './tasks/time.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS = path.join(__dirname, 'uploads')

const HASH = bcrypt.hashSync('password', 10)
const now = new Date()
const iso = (d) => d.toISOString()
// Calendar days are the SCHOOL's days, not UTC's. Formatting with toISOString()
// meant that between midnight and 05:30 IST the seed's "today" was already
// yesterday to the task engine — so a freshly seeded database was born with the
// logout gate armed and every write refused. One definition of today, shared
// with the engine.
const dateStr = (d) => localDate(DEFAULT_TZ, d)
const daysFromNow = (n) => new Date(now.getTime() + n * 86400000)
const yearsAgo = (y, extraDays = 0) =>
  new Date(now.getTime() - Math.round(y * 365.25) * 86400000 - extraDays * 86400000)

const TODAY = dateStr(now)
const YESTERDAY = dateStr(daysFromNow(-1))

function stamp(row) {
  const t = iso(now)
  return { createdAt: t, createdBy: null, updatedAt: t, updatedBy: null, deletedAt: null, ...row }
}

export function buildSeed() {
  const db = {}
  const push = (coll, row) => {
    db[coll] = db[coll] || []
    const r = stamp(row)
    db[coll].push(r)
    return r
  }

  // ---------- branches, years, programs, classes, sections ----------
  push('branches', { id: 'br-jh', name: 'Kidzonia Jubilee Hills', code: 'JH', address: 'Road No 36, Jubilee Hills, Hyderabad', phone: '+91 90000 11111' })
  push('branches', { id: 'br-gb', name: 'Kidzonia Gachibowli', code: 'GB', address: 'DLF Street, Gachibowli, Hyderabad', phone: '+91 90000 22222' })

  for (const br of ['jh', 'gb']) {
    push('academicYears', { id: `ay-${br}-25`, branchId: `br-${br}`, name: '2025-2026', startDate: '2025-06-01', endDate: '2026-03-31', active: false, archived: true })
    push('academicYears', { id: `ay-${br}-26`, branchId: `br-${br}`, name: '2026-2027', startDate: '2026-06-01', endDate: '2027-03-31', active: true, archived: false })
    push('academicYears', { id: `ay-${br}-27`, branchId: `br-${br}`, name: '2027-2028', startDate: '2027-06-01', endDate: '2028-03-31', active: false, archived: false })
  }

  const PROGRAMS = [
    ['daycare', 'Daycare', 6, 36],
    ['playgroup', 'Playgroup', 24, 42],
    ['nursery', 'Nursery', 36, 54],
    ['jrkg', 'Jr. KG', 48, 66],
    ['srkg', 'Sr. KG', 60, 78],
  ]
  // Admin-config layer for classes: display name, short code, teacher assignments.
  const CLASS_META = {
    daycare: { label: 'Kidzo Daycare', code: 'KZ-DC' },
    playgroup: { label: 'Kidzo Playgroup', code: 'KZ-PG' },
    nursery: { label: 'Kidzo Nursery', code: 'KZ-NUR' },
    jrkg: { label: 'Kidzo Junior KG', code: 'KZ-JKG' },
    srkg: { label: 'Kidzo Senior KG', code: 'KZ-SKG' },
  }
  // [primaryClassTeacherId, [assistant/subject teacher ids]] per branch+program
  const CLASS_TEACHERS = {
    jh: {
      daycare: ['u-teacher', []],
      playgroup: ['u-teacher', []],
      nursery: ['u-teacher', ['u-teacher2']],
      jrkg: ['u-teacher2', []],
      srkg: ['u-teacher2', ['u-teacher']],
    },
    gb: {
      daycare: ['u-teacher-gb', []],
      playgroup: ['u-teacher-gb', []],
      nursery: ['u-teacher-gb', []],
      jrkg: ['u-teacher-gb', []],
      srkg: ['u-teacher-gb', []],
    },
  }
  for (const br of ['jh', 'gb']) {
    for (const [key, name, min, max] of PROGRAMS) {
      push('programs', { id: `prog-${br}-${key}`, branchId: `br-${br}`, name, ageMinMonths: min, ageMaxMonths: max })
      const [classTeacherId, assistantTeacherIds] = CLASS_TEACHERS[br][key]
      push('classes', {
        id: `cls-${br}-${key}`, branchId: `br-${br}`, academicYearId: `ay-${br}-26`, programId: `prog-${br}-${key}`,
        name: CLASS_META[key].label, code: CLASS_META[key].code, capacity: 40,
        ageMinMonths: min, ageMaxMonths: max,
        classTeacherId, assistantTeacherIds, active: true,
      })
    }
  }
  const SECTIONS = [
    ['sec-jh-daycare-a', 'cls-jh-daycare', 'A', 12, null, 'Play Room 1'],
    ['sec-jh-playgroup-a', 'cls-jh-playgroup', 'A', 15, null, 'Room PG'],
    ['sec-jh-nursery-a', 'cls-jh-nursery', 'A', 20, 'u-teacher', 'Room N1'],
    ['sec-jh-nursery-b', 'cls-jh-nursery', 'B', 20, null, 'Room N2'],
    ['sec-jh-jrkg-a', 'cls-jh-jrkg', 'A', 20, 'u-teacher2', 'Room J1'],
    ['sec-jh-jrkg-b', 'cls-jh-jrkg', 'B', 20, null, 'Room J2'],
    ['sec-jh-srkg-a', 'cls-jh-srkg', 'A', 20, null, 'Room S1'],
    ['sec-gb-nursery-a', 'cls-gb-nursery', 'A', 20, 'u-teacher-gb', 'GB Room N1'],
    ['sec-gb-jrkg-a', 'cls-gb-jrkg', 'A', 20, 'u-teacher-gb', 'GB Room J1'],
  ]
  for (const [id, classId, name, capacity, teacherId, room] of SECTIONS) {
    push('sections', { id, classId, name, capacity, teacherId, room })
  }

  // Next session (2027-2028): same class structure, no students yet — the
  // primary destination for year-rollover promotion. Jr. KG A is intentionally
  // small (cap 10) to demonstrate the over-capacity override flow.
  for (const br of ['jh', 'gb']) {
    for (const [key, , min, max] of PROGRAMS) {
      const [classTeacherId, assistantTeacherIds] = CLASS_TEACHERS[br][key]
      push('classes', {
        id: `cls-${br}-${key}-27`, branchId: `br-${br}`, academicYearId: `ay-${br}-27`, programId: `prog-${br}-${key}`,
        name: CLASS_META[key].label, code: CLASS_META[key].code, capacity: 40,
        ageMinMonths: min, ageMaxMonths: max, classTeacherId, assistantTeacherIds, active: true,
      })
      push('sections', { id: `sec-${br}-${key}-a-27`, classId: `cls-${br}-${key}-27`, name: 'A', capacity: key === 'jrkg' ? 10 : 20, teacherId: classTeacherId, room: 'Room A' })
    }
  }

  // ---------- users (staff) ----------
  // [id, name, email, role, branchId, employeeId, username, designation]
  const staff = [
    ['u-super', 'Meera Krishnan', 'superadmin@kidzonia.com', 'super_admin', null, 'EMP/1', 'meera', 'Super Admin'],
    ['u-principal', 'Lakshmi Devi', 'principal@kidzonia.com', 'branch_admin', 'br-jh', 'EMP/2', 'lakshmi', 'Principal'],
    ['u-frontdesk', 'Ravi Teja', 'frontdesk@kidzonia.com', 'front_desk', 'br-jh', 'EMP/3', 'ravi', 'Front Desk Executive'],
    ['u-accounts', 'Suresh Babu', 'accounts@kidzonia.com', 'accountant', 'br-jh', 'EMP/4', 'suresh', 'Accountant'],
    ['u-teacher', 'Anjali Rao', 'teacher@kidzonia.com', 'teacher', 'br-jh', 'EMP/10', 'anjali', 'Class Teacher'],
    ['u-teacher2', 'Kavya Menon', 'teacher2@kidzonia.com', 'teacher', 'br-jh', 'EMP/11', 'kavya', 'Class Teacher'],
    ['u-principal-gb', 'Sunil Kumar', 'principal.gb@kidzonia.com', 'branch_admin', 'br-gb', 'EMP/12', 'sunil', 'Principal'],
    ['u-teacher-gb', 'Divya Nair', 'teacher.gb@kidzonia.com', 'teacher', 'br-gb', 'EMP/13', 'divya', 'Class Teacher'],
  ]
  for (const [id, name, email, role, branchId, employeeId, username, designation] of staff) {
    push('users', { id, name, email, phone: null, passwordHash: HASH, role, branchId, guardianId: null, active: true, employeeId, username, designation, subjects: [], classTeacherOf: [], subjectTeacher: false, groupAdmin: false, photoId: null })
  }

  // named teaching/day-care staff (Staff → List demo). [id,name,username,role,branchId,empId,designation,subjects,classTeacherOf,subjectTeacher,groupAdmin,phone]
  const namedStaff = [
    ['u-anurag', 'ANURAG JAIN', 'anurag.jain', 'teacher', 'br-jh', 'EMP/5', 'Senior Teacher', ['English', 'Rhymes'], ['cls-jh-srkg'], true, true, '+91 90000 45501'],
    ['u-aanya', 'AANYA KHAN', 'aanya.khan', 'teacher', 'br-jh', 'EMP/6', 'Class Teacher', ['EVS', 'Art & Craft'], ['cls-jh-nursery'], true, false, '+91 90000 45502'],
    ['u-renu', 'Renu Nair', 'renu.nair', 'teacher', 'br-jh', 'EMP/7', 'Class Teacher', ['Numbers', 'Rhymes'], ['cls-jh-jrkg'], false, false, '+91 90000 45503'],
    ['u-sudhir', 'Sudhir Kukreja', 'sudhir.kukreja', 'branch_admin', 'br-jh', 'EMP/8', 'Vice Principal', [], [], false, true, '+91 90000 45504'],
    ['u-gayatri', 'gayatri Nair', 'gayatri.nair', 'daycare_staff', 'br-jh', 'EMP/9', 'Day Care Assistant', ['Play', 'Meals'], ['cls-jh-daycare'], false, false, '+91 90000 45505'],
  ]
  for (const [id, name, username, role, branchId, employeeId, designation, subjects, classTeacherOf, subjectTeacher, groupAdmin, phone] of namedStaff) {
    push('users', { id, name, email: `${username}@kidzonia.com`, phone, passwordHash: HASH, role, branchId, guardianId: null, active: true, employeeId, username, designation, subjects, classTeacherOf, subjectTeacher, groupAdmin, photoId: null })
  }

  seedHqUsers(push)

  // ---------- role permissions ----------
  const P = (view, create, edit, del) => ({ view, create, edit, delete: del })
  const ALL = P(true, true, true, true)
  const VIEW = P(true, false, false, false)
  const NONE = P(false, false, false, false)
  const MODULES = ['crm', 'admissions', 'students', 'attendance', 'fees', 'daily', 'comms', 'worksheets', 'settings', 'dashboards', 'setup', 'staff', 'daycare', 'org', 'tasks']
  // org/tasks permissions are a COARSE module gate only. Who may assign to whom,
  // define levels or approve is decided by the org tree (server/org/tree.js) —
  // which is why every staff role gets tasks:ALL: a leaf simply has no downline
  // to assign to, and the tree says so.
  const matrix = {
    branch_admin: { crm: ALL, admissions: ALL, students: ALL, attendance: ALL, fees: ALL, daily: ALL, comms: ALL, worksheets: ALL, settings: ALL, dashboards: VIEW, setup: ALL, staff: ALL, daycare: ALL, org: ALL, tasks: ALL },
    front_desk: { crm: ALL, admissions: ALL, students: P(true, true, false, false), attendance: VIEW, fees: P(true, true, false, false), daily: VIEW, comms: P(true, true, false, false), worksheets: VIEW, settings: NONE, dashboards: VIEW, setup: NONE, staff: NONE, daycare: NONE, org: VIEW, tasks: ALL },
    accountant: { crm: NONE, admissions: VIEW, students: VIEW, attendance: NONE, fees: ALL, daily: NONE, comms: VIEW, worksheets: NONE, settings: NONE, dashboards: VIEW, setup: NONE, staff: NONE, daycare: NONE, org: VIEW, tasks: ALL },
    teacher: { crm: NONE, admissions: NONE, students: VIEW, attendance: ALL, fees: NONE, daily: ALL, comms: P(true, true, true, false), worksheets: P(true, true, true, false), settings: NONE, dashboards: VIEW, setup: NONE, staff: NONE, daycare: NONE, org: VIEW, tasks: ALL },
    daycare_staff: { crm: NONE, admissions: NONE, students: VIEW, attendance: VIEW, fees: NONE, daily: ALL, comms: VIEW, worksheets: VIEW, settings: NONE, dashboards: VIEW, setup: NONE, staff: NONE, daycare: ALL, org: VIEW, tasks: ALL },
    hq_coordinator: { crm: VIEW, admissions: VIEW, students: VIEW, attendance: VIEW, fees: VIEW, daily: VIEW, comms: P(true, true, true, false), worksheets: VIEW, settings: NONE, dashboards: VIEW, setup: VIEW, staff: VIEW, daycare: VIEW, org: ALL, tasks: ALL },
    school_owner: { crm: VIEW, admissions: VIEW, students: VIEW, attendance: VIEW, fees: VIEW, daily: VIEW, comms: VIEW, worksheets: VIEW, settings: NONE, dashboards: VIEW, setup: VIEW, staff: VIEW, daycare: VIEW, org: ALL, tasks: ALL },
    parent: Object.fromEntries(MODULES.map((m) => [m, NONE])),
  }
  for (const [role, permissions] of Object.entries(matrix)) {
    push('rolePermissions', { id: `rp-${role}`, role, permissions })
  }

  // ---------- families, guardians, students, enrolments ----------
  // roster: [first, last, sectionId, ageYears]
  const roster = [
    ['Aarav', 'Sharma', 'sec-jh-nursery-a', 3.6],
    ['Vihaan', 'Reddy', 'sec-jh-nursery-a', 3.4],
    ['Diya', 'Iyer', 'sec-jh-nursery-a', 3.8],
    ['Zara', 'Khan', 'sec-jh-nursery-a', 3.5],
    ['Arjun', 'Patel', 'sec-jh-nursery-a', 3.9],
    ['Myra', 'Verma', 'sec-jh-nursery-a', 3.3],
    ['Advait', 'Rao', 'sec-jh-nursery-b', 3.7],
    ['Kiara', 'Gupta', 'sec-jh-nursery-b', 3.5],
    ['Vivaan', 'Mehta', 'sec-jh-nursery-b', 3.6],
    ['Aadhya', 'Joshi', 'sec-jh-nursery-b', 3.4],
    ['Anaya', 'Sharma', 'sec-jh-jrkg-a', 4.8],
    ['Reyansh', 'Nair', 'sec-jh-jrkg-a', 4.6],
    ['Saanvi', 'Singh', 'sec-jh-jrkg-a', 4.7],
    ['Ayaan', 'Das', 'sec-jh-jrkg-a', 4.5],
    ['Anika', 'Kulkarni', 'sec-jh-jrkg-a', 4.9],
    ['Kabir', 'Bose', 'sec-jh-jrkg-b', 4.6],
    ['Tara', 'Menon', 'sec-jh-jrkg-b', 4.7],
    ['Yuvan', 'Pillai', 'sec-jh-jrkg-b', 4.5],
    ['Ira', 'Shetty', 'sec-jh-jrkg-b', 4.8],
    ['Dev', 'Chawla', 'sec-jh-srkg-a', 5.6],
    ['Navya', 'Bajaj', 'sec-jh-srkg-a', 5.7],
    ['Rudra', 'Jain', 'sec-jh-srkg-a', 5.5],
    ['Pari', 'Agarwal', 'sec-jh-srkg-a', 5.8],
    ['Shaurya', 'Malhotra', 'sec-jh-srkg-a', 5.6],
    ['Amaira', 'Sood', 'sec-jh-playgroup-a', 2.6],
    ['Atharv', 'Bhat', 'sec-jh-playgroup-a', 2.8],
    ['Mishka', 'Rana', 'sec-jh-playgroup-a', 2.5],
    ['Veer', 'Chopra', 'sec-jh-playgroup-a', 2.9],
    ['Aarohi', 'Saxena', 'sec-jh-daycare-a', 1.2],
    ['Krish', 'Tiwari', 'sec-jh-daycare-a', 1.8],
    ['Riya', 'Dubey', 'sec-jh-daycare-a', 2.1],
    ['Ishaan', 'Kapoor', 'sec-gb-nursery-a', 3.5],
    ['Ahana', 'Roy', 'sec-gb-nursery-a', 3.6],
    ['Ranbir', 'Sethi', 'sec-gb-nursery-a', 3.7],
    ['Ivana', 'Dutta', 'sec-gb-nursery-a', 3.4],
    ['Agastya', 'Basu', 'sec-gb-nursery-a', 3.8],
    ['Ryka', 'Bhalla', 'sec-gb-jrkg-a', 4.6],
    ['Aryan', 'Kaul', 'sec-gb-jrkg-a', 4.7],
    ['Meher', 'Anand', 'sec-gb-jrkg-a', 4.5],
    ['Jai', 'Puri', 'sec-gb-jrkg-a', 4.8],
    // extra Nursery A intake (appended to keep earlier stu-N ids stable) — makes the transfer roster fuller
    ['Ansh', 'Bhatia', 'sec-jh-nursery-a', 3.6],
    ['Kyra', 'Sridhar', 'sec-jh-nursery-a', 3.5],
    ['Rohan', 'Naidu', 'sec-jh-nursery-a', 3.7],
    ['Sia', 'Wagh', 'sec-jh-nursery-a', 3.4],
    ['Om', 'Sarin', 'sec-jh-nursery-a', 3.8],
    ['Nyra', 'Bakshi', 'sec-jh-nursery-a', 3.5],
  ]

  const sectionById = Object.fromEntries(db.sections.map((s) => [s.id, s]))
  const classById = Object.fromEntries(db.classes.map((c) => [c.id, c]))
  const familyByLast = {}
  const rollCounters = {}
  let famSeq = 0

  roster.forEach(([first, last, sectionId, age], i) => {
    const section = sectionById[sectionId]
    const cls = classById[section.classId]
    const branchId = cls.branchId
    const sid = `stu-${i + 1}`

    let fam = familyByLast[`${branchId}:${last}`]
    if (!fam) {
      famSeq += 1
      fam = push('families', { id: `fam-${famSeq}`, branchId, name: `${last} Family`, address: `${20 + famSeq} Green Park Lane, Hyderabad` })
      familyByLast[`${branchId}:${last}`] = fam
      const isSharma = fam.id === 'fam-1'
      const guardians = isSharma
        ? [
            { id: 'gua-priya', name: 'Priya Sharma', relationship: 'mother', email: 'parent@kidzonia.com', userId: 'u-parent' },
            { id: 'gua-rahul', name: 'Rahul Sharma', relationship: 'father', email: 'parent2@kidzonia.com', userId: 'u-parent2' },
          ]
        : [{ id: `gua-${famSeq}`, name: `Asha ${last}`, relationship: 'mother', email: `parent${famSeq}@example.com`, userId: `u-parent-${famSeq}` }]
      fam.guardianIds = guardians.map((g) => g.id)
      for (const g of guardians) {
        push('users', { id: g.userId, name: g.name, email: g.email, phone: `+91 98${String(1000000 + famSeq * 7)}`, passwordHash: HASH, role: 'parent', branchId: null, guardianId: g.id, active: true })
        push('guardians', {
          id: g.id, familyId: fam.id, name: g.name, relationship: g.relationship,
          phone: `+91 98${String(1000000 + famSeq * 7)}`, email: g.email, userId: g.userId,
          notificationPrefs: { inApp: true, push: true, sms: false, whatsapp: true, email: true },
        })
      }
    }

    rollCounters[sectionId] = (rollCounters[sectionId] || 0) + 1
    // deterministic mock demographics for breakup reports
    let category = ['General', 'General', 'OBC', 'General', 'SC', 'General', 'OBC', 'ST', 'General', 'Others'][i % 10]
    if (i % 13 === 0) category = 'Not Provided'
    push('students', {
      id: sid, branchId, familyId: fam.id, applicationId: null,
      firstName: first, lastName: last, dob: dateStr(yearsAgo(age, i * 3)), gender: i % 2 === 0 ? 'male' : 'female',
      photoId: null, bloodGroup: ['O+', 'A+', 'B+', 'AB+'][i % 4],
      allergies: i % 7 === 0 ? 'Peanuts' : '', medicalNotes: '',
      category, ews: i % 6 === 0, specialNeeds: i % 11 === 0,
      emergencyContacts: [{ name: `Asha ${last}`, phone: `+91 98${String(1000000 + famSeq * 7)}` }],
      authorisedPickups: [{ name: `Asha ${last}`, relation: 'mother' }],
      rollNo: rollCounters[sectionId], status: 'active',
    })
    push('enrolments', { id: `enr-${i + 1}`, studentId: sid, academicYearId: `ay-${branchId.slice(3)}-26`, classId: cls.id, sectionId, joinedAt: '2026-06-01', leftAt: null })

    // media consent per guardian; Patel guardian demoes a revoked consent
    for (const gid of fam.guardianIds) {
      push('consents', { id: `con-${gid}-${sid}`, guardianId: gid, studentId: sid, type: 'media_share', granted: last !== 'Patel' })
      push('guardianStudentLinks', { id: `gsl-${gid}-${sid}`, guardianId: gid, studentId: sid, relationship: gid === 'gua-rahul' ? 'father' : 'mother', isPrimary: gid !== 'gua-rahul' })
    }
  })

  // ---------- attendance ----------
  const nurseryA = db.enrolments.filter((e) => e.sectionId === 'sec-jh-nursery-a').map((e) => e.studentId)

  // Seed ~4 weeks (weekdays) of attendance for every JH section that has students,
  // so the analytics charts are populated. A couple of chronic absentees (<75%).
  const CHRONIC = new Set(['stu-2', 'stu-5']) // Vihaan, Arjun — chronic absentees for the demo
  const hash = (str) => { let x = 0; for (const ch of str) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x }
  const rnd = (seed) => (hash(seed) % 1000) / 1000
  const attDates = []
  for (let k = 27; k >= 0; k--) {
    const d = daysFromNow(-k)
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) attDates.push(dateStr(d))
  }
  const jhEnrol = db.enrolments.filter((e) => e.academicYearId === 'ay-jh-26' && !e.leftAt)
  const sectionTeacher = Object.fromEntries(db.sections.map((s) => [s.id, s.teacherId || 'u-teacher']))
  for (const enr of jhEnrol) {
    attDates.forEach((date, di) => {
      const r = rnd(`${enr.studentId}:${date}`)
      let status
      // chronic absentees: present only every 3rd day (~33%) so they reliably fall below 75%
      if (CHRONIC.has(enr.studentId)) status = di % 3 === 0 ? 'present' : 'absent'
      else status = r < 0.08 ? 'absent' : r < 0.12 ? 'late' : r < 0.15 ? 'leave' : 'present'
      push('attendanceRecords', {
        id: `att-${enr.studentId}-${date}`, branchId: 'br-jh', sectionId: enr.sectionId, studentId: enr.studentId,
        date, status, reason: status === 'late' ? 'Traffic delay' : status === 'leave' ? 'Family leave' : '',
        markedBy: sectionTeacher[enr.sectionId],
      })
    })
  }

  push('leaveRequests', { id: 'lv-1', studentId: 'stu-1', fromDate: dateStr(daysFromNow(5)), toDate: dateStr(daysFromNow(7)), reason: 'Family wedding', status: 'pending', decidedBy: null })
  push('leaveRequests', { id: 'lv-2', studentId: 'stu-11', fromDate: dateStr(daysFromNow(-10)), toDate: dateStr(daysFromNow(-9)), reason: 'Fever', status: 'approved', decidedBy: 'u-principal' })

  // ---------- fees ----------
  // [code, periodicity, refundable]
  const HEAD_META = [
    ['admission', 'one_time', false],
    ['tuition', 'monthly', false],
    ['transport', 'monthly', false],
    ['meals', 'monthly', false],
    ['activity', 'annual', false],
    ['uniform', 'one_time', false],
    ['books', 'one_time', false],
    ['deposit', 'one_time', true],
    ['late_fee', 'one_time', false],
  ]
  for (const br of ['jh', 'gb']) {
    for (const [h, periodicity, refundable] of HEAD_META) {
      push('feeHeads', {
        id: `fh-${br}-${h}`, branchId: `br-${br}`,
        name: h === 'late_fee' ? 'Late Fee' : h[0].toUpperCase() + h.slice(1), code: h.toUpperCase(),
        periodicity, taxable: false, gstPct: 0, refundable, active: true,
      })
    }
  }
  const TUITION = { daycare: 12000, playgroup: 8000, nursery: 9000, jrkg: 10000, srkg: 11000 }
  for (const br of ['jh', 'gb']) {
    for (const [key] of PROGRAMS) {
      push('feeStructures', {
        id: `fs-${br}-${key}`, branchId: `br-${br}`, academicYearId: `ay-${br}-26`, programId: `prog-${br}-${key}`, classId: `cls-${br}-${key}`,
        name: `${key[0].toUpperCase() + key.slice(1)} 2026-27`,
        lines: [
          { feeHeadId: `fh-${br}-admission`, amount: R(25000), cycle: 'one_time' },
          { feeHeadId: `fh-${br}-deposit`, amount: R(10000), cycle: 'one_time' },
          { feeHeadId: `fh-${br}-tuition`, amount: R(TUITION[key]), cycle: 'monthly' },
          { feeHeadId: `fh-${br}-meals`, amount: R(1500), cycle: 'monthly' },
          { feeHeadId: `fh-${br}-transport`, amount: R(2000), cycle: 'monthly' },
          { feeHeadId: `fh-${br}-activity`, amount: R(6000), cycle: 'annual' },
        ],
      })
    }
  }

  // July invoices for JH Nursery A + Jr KG A; mixed payment states
  let invSeq = 0
  let rcpSeq = 0
  const ledgerBalance = {}
  const monthLabel = now.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
  const billed = db.enrolments.filter((e) => ['sec-jh-nursery-a', 'sec-jh-jrkg-a'].includes(e.sectionId))
  billed.forEach((enr, idx) => {
    const sid = enr.studentId
    const progKey = enr.classId.split('-')[2]
    const lines = [
      { feeHeadId: 'fh-jh-tuition', description: `Tuition – ${monthLabel}`, amount: R(TUITION[progKey]) },
      { feeHeadId: 'fh-jh-meals', description: `Meals – ${monthLabel}`, amount: R(1500) },
      { feeHeadId: 'fh-jh-transport', description: `Transport – ${monthLabel}`, amount: R(2000) },
    ]
    const total = lines.reduce((s, l) => s + l.amount, 0)
    invSeq += 1
    const inv = push('invoices', {
      id: `inv-${invSeq}`, branchId: 'br-jh', studentId: sid,
      number: `INV-JH-${String(invSeq).padStart(4, '0')}`,
      dueDate: dateStr(daysFromNow(idx % 4 === 3 ? -5 : 10)),
      lines, discountTotal: 0, total, paidAmount: 0, status: 'pending',
    })
    ledgerBalance[sid] = (ledgerBalance[sid] || 0) + total
    push('ledgerEntries', { id: `led-c-${invSeq}`, branchId: 'br-jh', studentId: sid, type: 'charge', refId: inv.id, amount: total, balanceAfter: ledgerBalance[sid] })

    const mode = idx % 4
    if (mode === 0 || mode === 1) {
      const amount = mode === 0 ? total : Math.round(total / 2)
      const pay = push('payments', {
        id: `pay-${invSeq}`, branchId: 'br-jh', invoiceId: inv.id, studentId: sid,
        amount, mode: mode === 0 ? 'gateway' : 'cash',
        gatewayRef: mode === 0 ? `MOCKPAY-seed-${invSeq}` : null, status: 'success',
      })
      rcpSeq += 1
      push('receipts', { id: `rcp-${rcpSeq}`, paymentId: pay.id, number: `RCP-JH-${String(rcpSeq).padStart(4, '0')}` })
      inv.paidAmount = amount
      inv.status = amount >= total ? 'paid' : 'partial'
      ledgerBalance[sid] -= amount
      push('ledgerEntries', { id: `led-p-${invSeq}`, branchId: 'br-jh', studentId: sid, type: 'payment', refId: pay.id, amount: -amount, balanceAfter: ledgerBalance[sid] })
    } else if (mode === 3) {
      inv.status = 'overdue'
    }
  })
  push('discounts', { id: 'disc-1', branchId: 'br-jh', studentId: 'stu-11', invoiceId: null, name: 'Sibling discount 10%', amount: R(1050), reason: 'Second child (Anaya Sharma)', status: 'pending', approvedBy: null })

  // per-student fee overrides (Nursery A): stu-1 sibling tuition cut, stu-5 transport waived
  push('studentFeeStructures', { id: 'sfs-1', branchId: 'br-jh', academicYearId: 'ay-jh-26', studentId: 'stu-1', lines: [{ feeHeadId: 'fh-jh-tuition', amount: R(7650), cycle: 'monthly' }], removedHeadIds: [] })
  push('studentFeeStructures', { id: 'sfs-2', branchId: 'br-jh', academicYearId: 'ay-jh-26', studentId: 'stu-5', lines: [], removedHeadIds: ['fh-jh-transport'] })

  // concessions (per session, per-head %/fixed)
  push('concessions', { id: 'conc-ews', branchId: 'br-jh', academicYearId: 'ay-jh-26', category: 'EWS', name: 'EWS', type: 'percentage', values: { 'fh-jh-tuition': 25, 'fh-jh-meals': 100 }, active: true })
  push('concessions', { id: 'conc-obc', branchId: 'br-jh', academicYearId: 'ay-jh-26', category: 'OBC', name: 'OBC', type: 'percentage', values: { 'fh-jh-tuition': 15 }, active: true })
  push('concessions', { id: 'conc-sibling', branchId: 'br-jh', academicYearId: 'ay-jh-26', category: 'Sibling', name: 'Sibling', type: 'percentage', values: { 'fh-jh-tuition': 10 }, active: true })
  push('concessions', { id: 'conc-staff', branchId: 'br-jh', academicYearId: 'ay-jh-26', category: 'Staff-ward', name: 'Staff ward', type: 'percentage', values: { 'fh-jh-tuition': 50, 'fh-jh-admission': 100 }, active: true })
  // explicit assignment (Anaya, sibling); OBC students (e.g. stu-3) auto-map from their category
  push('studentConcessions', { id: 'sconc-1', branchId: 'br-jh', academicYearId: 'ay-jh-26', studentId: 'stu-11', concessionId: 'conc-sibling' })

  // corporate tie-up + tagged ward
  push('corporates', { id: 'corp-infy', branchId: 'br-jh', name: 'Infosys', type: 'percentage', values: { 'fh-jh-tuition': 15 }, active: true })
  const vihaan = db.students.find((s) => s.id === 'stu-2'); if (vihaan) vihaan.corporateId = 'corp-infy'

  // fee general settings (per session)
  push('feeSettings', {
    id: 'fset-jh-26', branchId: 'br-jh', academicYearId: 'ay-jh-26',
    lateFee: { type: 'fixed', amount: R(500), cap: R(2000), grace: 5 },
    perCycleDueDay: { one_time: 15, monthly: 10, quarterly: 10, term: 10, half_yearly: 10, annual: 15 },
    autoGenerate: { enabled: true, dayOfMonth: 1 },
    autoReminders: { enabled: true, channels: ['in_app', 'email', 'whatsapp'], rules: [{ type: 'before', days: 3 }, { type: 'on_due', days: 0 }, { type: 'overdue', days: 7 }] },
    bankAccounts: [{ name: 'Kidzonia Jubilee Hills — HDFC', accountNo: '50100012345678', ifsc: 'HDFC0001234', upi: 'kidzonia.jh@hdfcbank' }],
    reportEmails: ['principal@kidzonia.com', 'accounts@kidzonia.com'],
  })

  // ad-hoc one-off charge (Annual Day costume) → invoices per Nursery student
  push('adhocFees', { id: 'adhoc-annualday', branchId: 'br-jh', academicYearId: 'ay-jh-26', title: 'Annual Day costume', description: 'Costume for the annual day performance', amount: R(500), dueDate: dateStr(daysFromNow(10)), audience: { type: 'class', ids: ['cls-jh-nursery'] }, status: 'active' })
  ;['stu-3', 'stu-4', 'stu-6'].forEach((sid, i) => {
    invSeq += 1
    const inv = push('invoices', { id: `inv-adhoc-${i + 1}`, branchId: 'br-jh', academicYearId: 'ay-jh-26', studentId: sid, adhocFeeId: 'adhoc-annualday', cycleKey: null, number: `INV-JH-${String(invSeq).padStart(4, '0')}`, dueDate: dateStr(daysFromNow(10)), lines: [{ feeHeadId: null, description: 'Annual Day costume', amount: R(500) }], discountTotal: 0, total: R(500), paidAmount: 0, status: 'pending' })
    ledgerBalance[sid] = (ledgerBalance[sid] || 0) + R(500)
    push('ledgerEntries', { id: `led-adhoc-c-${i + 1}`, branchId: 'br-jh', studentId: sid, type: 'charge', refId: inv.id, amount: R(500), balanceAfter: ledgerBalance[sid] })
    if (i === 0) {
      const pay = push('payments', { id: 'pay-adhoc-1', branchId: 'br-jh', invoiceId: inv.id, studentId: sid, amount: R(500), mode: 'cash', reference: {}, allocations: [{ invoiceId: inv.id, amount: R(500) }], date: TODAY, gatewayRef: null, status: 'success' })
      rcpSeq += 1
      push('receipts', { id: 'rcp-adhoc-1', paymentId: pay.id, number: `RCP-JH-${String(rcpSeq).padStart(4, '0')}` })
      inv.paidAmount = R(500); inv.status = 'paid'
      ledgerBalance[sid] -= R(500)
      push('ledgerEntries', { id: 'led-adhoc-p-1', branchId: 'br-jh', studentId: sid, type: 'payment', refId: pay.id, amount: -R(500), balanceAfter: ledgerBalance[sid] })
    }
  })
  db._feesMoneyV2 = true // seed writes paise directly; skip the rupee->paise migration

  // ---------- CRM ----------
  const leadDefs = [
    ['lead-1', 'Kabir Malhotra', 'prog-jh-nursery', 'Rohit Malhotra', 'walk_in', 'new'],
    ['lead-2', 'Sara Ali', 'prog-jh-playgroup', 'Farhan Ali', 'website', 'new'],
    ['lead-3', 'Vanya Kohli', 'prog-jh-jrkg', 'Nidhi Kohli', 'referral', 'contacted'],
    ['lead-4', 'Aditya Rana', 'prog-jh-nursery', 'Vikas Rana', 'whatsapp', 'contacted'],
    ['lead-5', 'Prisha Ahuja', 'prog-jh-daycare', 'Neha Ahuja', 'ads', 'visit_scheduled'],
    ['lead-6', 'Rehan Qureshi', 'prog-jh-nursery', 'Sana Qureshi', 'phone', 'visited'],
    ['lead-7', 'Amayra Kapadia', 'prog-jh-srkg', 'Jay Kapadia', 'event', 'demo'],
    ['lead-8', 'Neil Wadhwa', 'prog-jh-jrkg', 'Ritu Wadhwa', 'parent_app', 'negotiation'],
    ['lead-9', 'Ariana Dsouza', 'prog-jh-nursery', 'Melissa Dsouza', 'website', 'converted'],
    ['lead-10', 'Zoya Hashmi', 'prog-jh-playgroup', 'Imran Hashmi', 'walk_in', 'lost'],
    ['lead-11', 'Advika Iyengar', 'prog-gb-nursery', 'Raghav Iyengar', 'website', 'new'],
    ['lead-12', 'Shivansh Goel', 'prog-gb-jrkg', 'Pooja Goel', 'referral', 'visited'],
    ['lead-13', 'Anvi Trivedi', 'prog-gb-nursery', 'Kunal Trivedi', 'walk_in', 'contacted'],
  ]
  leadDefs.forEach(([id, childName, programId, parentName, source, stage], i) => {
    const branchId = programId.includes('-gb-') ? 'br-gb' : 'br-jh'
    push('leads', {
      id, branchId, childName, childDob: dateStr(yearsAgo(3.5, i * 11)), programId,
      parentName, phone: `+91 97${String(2000000 + i * 13)}`, email: `${parentName.split(' ')[0].toLowerCase()}@example.com`,
      source, stage, counsellorId: branchId === 'br-jh' ? 'u-frontdesk' : 'u-principal-gb',
      expectedStart: dateStr(daysFromNow(30)), feeBracket: '8k-12k/month',
      lostReason: stage === 'lost' ? 'Fees higher than budget' : null,
      convertedApplicationId: stage === 'converted' ? 'app-1' : null,
    })
    push('leadActivities', { id: `la-${id}`, leadId: id, type: 'note', note: `Enquiry received via ${source.replace('_', ' ')}`, byId: 'u-frontdesk' })
  })
  push('followUpTasks', { id: 'fu-1', leadId: 'lead-3', dueDate: YESTERDAY, channel: 'call', note: 'Share fee structure and confirm visit slot', status: 'open', assigneeId: 'u-frontdesk' })
  push('followUpTasks', { id: 'fu-2', leadId: 'lead-6', dueDate: dateStr(daysFromNow(1)), channel: 'whatsapp', note: 'Send admission form link after visit', status: 'open', assigneeId: 'u-frontdesk' })
  push('followUpTasks', { id: 'fu-3', leadId: 'lead-8', dueDate: YESTERDAY, channel: 'call', note: 'Discuss sibling discount approval', status: 'done', assigneeId: 'u-frontdesk' })

  // ---------- admissions ----------
  push('applications', {
    id: 'app-1', branchId: 'br-jh', leadId: 'lead-9', programId: 'prog-jh-nursery',
    childName: 'Ariana Dsouza', childDob: dateStr(yearsAgo(3.5, 40)), gender: 'female',
    guardiansDraft: [{ name: 'Melissa Dsouza', relationship: 'mother', phone: '+91 9720000117', email: 'melissa@example.com' }],
    siblingStudentIds: [], status: 'submitted',
    decisions: [{ status: 'submitted', byId: 'u-frontdesk', at: iso(now), note: 'Converted from lead' }],
  })
  push('applications', {
    id: 'app-2', branchId: 'br-jh', leadId: null, programId: 'prog-jh-jrkg',
    childName: 'Hriday Bansal', childDob: dateStr(yearsAgo(4.7, 20)), gender: 'male',
    guardiansDraft: [{ name: 'Shweta Bansal', relationship: 'mother', phone: '+91 9720000501', email: 'shweta@example.com' }],
    siblingStudentIds: [], status: 'offered',
    decisions: [{ status: 'offered', byId: 'u-principal', at: iso(now), note: 'Seat available in Jr. KG B' }],
  })
  push('applications', {
    id: 'app-3', branchId: 'br-jh', leadId: null, programId: 'prog-jh-daycare',
    childName: 'Inaya Merchant', childDob: dateStr(yearsAgo(1.4, 10)), gender: 'female',
    guardiansDraft: [{ name: 'Zain Merchant', relationship: 'father', phone: '+91 9720000502', email: 'zain@example.com' }],
    siblingStudentIds: [], status: 'waitlisted',
    decisions: [{ status: 'waitlisted', byId: 'u-principal', at: iso(now), note: 'Daycare A at capacity' }],
  })
  push('applicationDocuments', { id: 'doc-1', applicationId: 'app-1', type: 'birth_certificate', status: 'received', mediaId: null })
  push('applicationDocuments', { id: 'doc-2', applicationId: 'app-1', type: 'photograph', status: 'pending', mediaId: null })
  push('applicationDocuments', { id: 'doc-3', applicationId: 'app-1', type: 'address_proof', status: 'pending', mediaId: null })
  push('applicationDocuments', { id: 'doc-4', applicationId: 'app-2', type: 'birth_certificate', status: 'verified', mediaId: null })

  // ---------- daily engagement ----------
  push('diaryPosts', { id: 'dp-1', branchId: 'br-jh', sectionId: 'sec-jh-nursery-a', studentIds: null, text: 'We explored monsoon colours today — cotton-ball clouds and finger-paint rain! 🌧️', mediaIds: [], authorId: 'u-teacher', publishedAt: iso(daysFromNow(-1)), likes: ['u-parent'] })
  push('diaryPosts', { id: 'dp-2', branchId: 'br-jh', sectionId: 'sec-jh-nursery-a', studentIds: null, text: 'Water play morning! Everyone tried pouring and measuring at the splash table.', mediaIds: [], authorId: 'u-teacher', publishedAt: iso(now), likes: [] })
  push('diaryPosts', { id: 'dp-3', branchId: 'br-jh', sectionId: 'sec-jh-nursery-a', studentIds: ['stu-1'], text: 'Aarav built a 12-block tower today and counted every block out loud!', mediaIds: [], authorId: 'u-teacher', publishedAt: iso(now), likes: ['u-parent'] })
  push('diaryComments', { id: 'dc-1', postId: 'dp-3', byId: 'u-parent', text: 'He kept talking about the tower all evening. Thank you!' })
  push('diaryComments', { id: 'dc-2', postId: 'dp-3', byId: 'u-teacher', text: 'He was so proud — we will try 15 blocks next week!' })

  nurseryA.slice(0, 5).forEach((sid, i) => {
    push('dailyLogs', { id: `dl-meal-${sid}`, branchId: 'br-jh', studentId: sid, date: TODAY, type: 'meal', data: { meal: 'Lunch', items: 'Veg pulao, curd, banana', ate: i % 3 === 0 ? 'some' : 'all', newFood: i === 2 }, byId: 'u-teacher' })
    push('dailyLogs', { id: `dl-nap-${sid}`, branchId: 'br-jh', studentId: sid, date: TODAY, type: 'nap', data: { start: '12:30', end: '13:45' }, byId: 'u-teacher' })
  })
  push('dailyLogs', { id: 'dl-mood-stu-1', branchId: 'br-jh', studentId: 'stu-1', date: TODAY, type: 'mood', data: { mood: 'happy', note: 'Very engaged during circle time' }, byId: 'u-teacher' })
  push('dailyLogs', { id: 'dl-health-stu-4', branchId: 'br-jh', studentId: 'stu-4', date: TODAY, type: 'health', data: { flag: 'Mild cold', note: 'Runny nose, monitored through the day' }, byId: 'u-teacher' })
  push('dailyLogs', { id: 'dl-diaper-stu-29', branchId: 'br-jh', studentId: 'stu-29', date: TODAY, type: 'diaper', data: { time: '10:15', kind: 'wet' }, byId: 'u-teacher' })

  nurseryA.forEach((sid, i) => {
    if (i === 1) return // absent child
    push('checkInOuts', { id: `cio-${sid}`, branchId: 'br-jh', studentId: sid, date: TODAY, inAt: `08:${40 + i}`, outAt: null, pickupPerson: null })
  })

  push('albums', { id: 'alb-1', branchId: 'br-jh', sectionId: 'sec-jh-nursery-a', title: 'Monsoon Week', mediaIds: [] })
  push('homework', { id: 'hw-1', branchId: 'br-jh', sectionId: 'sec-jh-nursery-a', title: 'Colour the umbrella', description: 'Use any 3 colours. Talk about rain while colouring!', dueDate: dateStr(daysFromNow(2)), mediaIds: [] })
  push('homework', { id: 'hw-2', branchId: 'br-jh', sectionId: 'sec-jh-jrkg-a', title: 'Count 1–10 practice', description: 'Count objects at home and draw any five.', dueDate: dateStr(daysFromNow(5)), mediaIds: [] })

  // ---------- communication ----------
  push('announcements', { id: 'ann-1', branchId: null, audience: { type: 'all', ids: [] }, title: 'Independence Day holiday', body: 'School will remain closed on 15 August 2026 for Independence Day.', mediaIds: [], requiresAck: false, publishedAt: iso(daysFromNow(-2)) })
  push('announcements', { id: 'ann-2', branchId: 'br-jh', audience: { type: 'class', ids: ['sec-jh-nursery-a'] }, title: 'PTM – Nursery A', body: 'Parent-teacher meeting on 25 July, 10am–1pm. Please acknowledge.', mediaIds: [], requiresAck: true, publishedAt: iso(daysFromNow(-1)) })
  push('announcementReads', { id: 'ar-1', announcementId: 'ann-1', userId: 'u-parent', readAt: iso(daysFromNow(-1)), ackAt: null })

  push('chatThreads', { id: 'ct-1', branchId: 'br-jh', type: 'parent_teacher', studentId: 'stu-1', participantIds: ['u-parent', 'u-teacher'] })
  push('messages', { id: 'msg-1', threadId: 'ct-1', byId: 'u-parent', text: 'Hi ma’am, Aarav was asking about the block tower photos 😊', readBy: ['u-teacher'] })
  push('messages', { id: 'msg-2', threadId: 'ct-1', byId: 'u-teacher', text: 'Hello! Posting them to the class album today.', readBy: ['u-parent'] })
  push('messages', { id: 'msg-3', threadId: 'ct-1', byId: 'u-parent', text: 'Thank you!', readBy: [] })

  push('events', { id: 'ev-1', branchId: 'br-jh', title: 'Independence Day (holiday)', date: '2026-08-15', type: 'holiday', description: 'School closed', rsvpEnabled: false })
  push('events', { id: 'ev-2', branchId: 'br-jh', title: 'Parent-Teacher Meeting', date: dateStr(daysFromNow(10)), type: 'ptm', description: 'Slot-wise meetings, Nursery & Jr. KG', rsvpEnabled: true })
  push('events', { id: 'ev-3', branchId: 'br-jh', title: 'Annual Sports Day', date: dateStr(daysFromNow(52)), type: 'function', description: 'Ground floor play area', rsvpEnabled: true })
  push('eventRsvps', { id: 'rsvp-1', eventId: 'ev-2', guardianUserId: 'u-parent', response: 'yes' })

  // ---------- worksheets (published resources) ----------
  try {
    fs.mkdirSync(UPLOADS, { recursive: true })
    fs.writeFileSync(path.join(UPLOADS, 'seed-worksheet-1.txt'), 'Kidzonia worksheet: Trace the letters A–E, one row each.\n')
    fs.writeFileSync(path.join(UPLOADS, 'seed-worksheet-2.txt'), 'Kidzonia worksheet: Count the mangoes (1–10) and circle the number.\n')
  } catch {
    /* uploads dir not writable in some test contexts — resources just skip files */
  }
  push('mediaAssets', { id: 'med-ws-1', branchId: 'br-jh', filename: 'tracing-a-to-e.txt', mimetype: 'text/plain', size: 60, path: 'seed-worksheet-1.txt', studentIds: [] })
  push('mediaAssets', { id: 'med-ws-2', branchId: 'br-jh', filename: 'count-the-mangoes.txt', mimetype: 'text/plain', size: 64, path: 'seed-worksheet-2.txt', studentIds: [] })
  push('publishedResources', { id: 'pr-1', branchId: 'br-jh', title: 'Tracing practice A–E', description: 'Home activity for Nursery', mediaId: 'med-ws-1', audience: { type: 'class', ids: ['sec-jh-nursery-a', 'sec-jh-nursery-b'] }, publishedAt: iso(daysFromNow(-3)), publishedBy: 'u-teacher' })
  push('publishedResources', { id: 'pr-2', branchId: 'br-jh', title: 'Count the mangoes', description: 'Number recognition worksheet', mediaId: 'med-ws-2', audience: { type: 'branch', ids: ['br-jh'] }, publishedAt: iso(daysFromNow(-1)), publishedBy: 'u-teacher' })

  // ---------- notifications ----------
  push('notifications', { id: 'ntf-1', userId: 'u-parent', title: 'Welcome to Kidzonia!', body: 'Your parent account is ready. Aarav and Anaya are linked to this login.', type: 'general', refType: null, refId: null, readAt: iso(daysFromNow(-6)) })
  push('notifications', { id: 'ntf-2', userId: 'u-parent', title: 'Fee reminder', body: `Tuition invoice for ${monthLabel} is due soon.`, type: 'fees', refType: 'invoice', refId: 'inv-1', readAt: null })

  // ---------- staff attendance (current + prior weekdays this month) ----------
  const jhStaff = db.users.filter((u) => u.role !== 'parent' && u.branchId === 'br-jh')
  const staffAttDates = []
  for (let k = 9; k >= 0; k--) {
    const d = daysFromNow(-k)
    if (d.getDay() !== 0 && d.getDay() !== 6) staffAttDates.push(dateStr(d))
  }
  jhStaff.forEach((u, ui) => {
    staffAttDates.forEach((date, di) => {
      const seed = (ui * 7 + di) % 10
      const status = seed === 0 ? 'absent' : seed === 1 ? 'leave' : seed === 2 ? 'half_day' : 'present'
      push('staffAttendance', { id: `sat-${u.id}-${date}`, branchId: 'br-jh', staffId: u.id, date, status, note: '', markedBy: 'u-principal' })
    })
  })

  // ---------- day care: dish library + weekly menu ----------
  const DISHES = [
    ['dish-idli', 'Idli & Sambar', []],
    ['dish-poha', 'Vegetable Poha', []],
    ['dish-pulao', 'Veg Pulao', []],
    ['dish-khichdi', 'Moong Dal Khichdi', []],
    ['dish-curd', 'Curd Rice', ['Dairy']],
    ['dish-fruit', 'Seasonal Fruit Bowl', []],
    ['dish-milk', 'Warm Milk', ['Dairy']],
    ['dish-pbsandwich', 'Peanut Butter Sandwich', ['Peanuts']],
    ['dish-vegsandwich', 'Veg Sandwich', ['Gluten']],
    ['dish-cookies', 'Oat Cookies', ['Gluten']],
    ['dish-banana', 'Banana', []],
    ['dish-upma', 'Rava Upma', ['Gluten']],
  ]
  for (const [id, name, allergens] of DISHES) push('dishes', { id, branchId: 'br-jh', name, allergens })

  // master activity catalog (definitions the operational Daily module logs against)
  const act = (o) => push('daycareActivities', { branchId: 'br-jh', description: '', showStartTime: false, startTime: null, showEndTime: false, endTime: null, options: [], multipleEntriesAllowed: false, isSystem: false, active: true, ...o })
  act({ id: 'dca-checkin', name: 'Check In', showStartTime: true, isSystem: true })
  act({ id: 'dca-checkout', name: 'Check Out', showStartTime: true, isSystem: true })
  act({ id: 'dca-nap', name: 'Nap Time', showStartTime: true, showEndTime: true })
  act({ id: 'dca-meal', name: 'Meal', showStartTime: true, options: ['Ate all', 'Ate some', 'Refused', 'New food tried'] })
  act({ id: 'dca-diaper', name: 'Diaper / Potty', showStartTime: true, options: ['Wet', 'Soiled', 'Dry'], multipleEntriesAllowed: true })
  act({ id: 'dca-mood', name: 'Mood', options: ['Happy', 'Calm', 'Fussy', 'Sleepy'] })
  act({ id: 'dca-play', name: 'Play', description: 'Free / sensory / outdoor play', multipleEntriesAllowed: true })
  act({ id: 'dca-incident', name: 'Incident', showStartTime: true, description: 'Injury / behaviour note requiring parent awareness' })

  // Mon–Fri breakfast/lunch/snack for JH active session; Wed snack has peanuts (allergy demo)
  const WEEK_MENU = [
    [1, 'breakfast', 'Idli Breakfast', ['dish-idli', 'dish-milk'], '08:30'],
    [1, 'lunch', 'Pulao Lunch', ['dish-pulao', 'dish-curd'], '12:30'],
    [1, 'snack', 'Evening Snack', ['dish-fruit', 'dish-banana'], '16:00'],
    [2, 'breakfast', 'Poha Breakfast', ['dish-poha', 'dish-milk'], '08:30'],
    [2, 'lunch', 'Khichdi Lunch', ['dish-khichdi', 'dish-curd'], '12:30'],
    [2, 'snack', 'Cookies & Milk', ['dish-cookies', 'dish-milk'], '16:00'],
    [3, 'breakfast', 'Upma Breakfast', ['dish-upma', 'dish-milk'], '08:30'],
    [3, 'lunch', 'Pulao Lunch', ['dish-pulao', 'dish-fruit'], '12:30'],
    [3, 'snack', 'Sandwich Snack', ['dish-pbsandwich'], '16:00'],
    [4, 'breakfast', 'Idli Breakfast', ['dish-idli', 'dish-milk'], '08:30'],
    [4, 'lunch', 'Khichdi Lunch', ['dish-khichdi', 'dish-curd'], '12:30'],
    [4, 'snack', 'Fruit Snack', ['dish-fruit'], '16:00'],
    [5, 'breakfast', 'Poha Breakfast', ['dish-poha', 'dish-banana'], '08:30'],
    [5, 'lunch', 'Pulao Lunch', ['dish-pulao', 'dish-curd'], '12:30'],
    [5, 'snack', 'Veg Sandwich', ['dish-vegsandwich'], '16:00'],
  ]
  WEEK_MENU.forEach(([dayOfWeek, mealType, name, dishIds, startTime], i) => {
    push('dcMeals', { id: `dcm-${i + 1}`, branchId: 'br-jh', sessionId: 'ay-jh-26', dayOfWeek, mealType, name, description: '', dishIds, showStartTime: true, startTime, published: true })
  })

  // ---------- day care: sample day's activities for the daycare section ----------
  const daycareKids = db.enrolments.filter((e) => e.sectionId === 'sec-jh-daycare-a').map((e) => e.studentId)
  daycareKids.forEach((sid, i) => {
    push('checkInOuts', { id: `cio-dc-${sid}`, branchId: 'br-jh', studentId: sid, date: TODAY, inAt: `08:${30 + i}`, outAt: null, pickupPerson: null })
    push('dailyLogs', { id: `dl-dc-nap-${sid}`, branchId: 'br-jh', studentId: sid, date: TODAY, type: 'nap', data: { start: '12:30', end: '14:00' }, byId: 'u-gayatri' })
    push('dailyLogs', { id: `dl-dc-meal-${sid}`, branchId: 'br-jh', studentId: sid, date: TODAY, type: 'meal', data: { meal: 'Lunch', items: 'Khichdi & curd', ate: i % 2 === 0 ? 'all' : 'some' }, byId: 'u-gayatri' })
    push('dailyLogs', { id: `dl-dc-play-${sid}`, branchId: 'br-jh', studentId: sid, date: TODAY, type: 'play', data: { note: 'Sensory play with water beads' }, byId: 'u-gayatri' })
  })
  push('dailyLogs', { id: 'dl-dc-incident-1', branchId: 'br-jh', studentId: daycareKids[0], date: TODAY, type: 'incident', data: { note: 'Minor bump on knee during play; cold compress applied, calm after.' }, byId: 'u-gayatri' })

  // ---------- groups (targeted-communication cohorts: staff / parents / class) ----------
  const grp = (o) => push('groups', { staffIds: [], classIds: [], memberIds: [], description: '', active: true, branchId: 'br-jh', academicYearId: 'ay-jh-26', ...o })
  grp({ id: 'grp-music', type: 'activity', name: 'Music & Movement', description: 'Weekly music and rhythm session across pre-primary.', memberIds: ['stu-1', 'stu-3', 'stu-11', 'stu-13', 'stu-20'], staffInchargeId: 'u-anurag' })
  grp({ id: 'grp-bus3', type: 'transport', name: 'Bus Route 3 — Jubilee Hills', description: 'Morning + evening pickup, Road No 36.', memberIds: ['stu-2', 'stu-5', 'stu-14', 'stu-29'], staffInchargeId: 'u-frontdesk', charges: [{ feeHeadId: 'fh-jh-transport', kind: 'charge', type: 'fixed', value: R(500) }] })
  grp({ id: 'grp-swim', type: 'activity', name: 'Swimming Batch A', description: 'Sr. KG splash sessions on Fridays.', memberIds: ['stu-20', 'stu-21', 'stu-22'], staffInchargeId: 'u-teacher', charges: [{ feeHeadId: 'fh-jh-activity', kind: 'charge', type: 'fixed', value: R(1000) }] })
  grp({ id: 'grp-allstaff', type: 'staff', name: 'All Teaching Staff', description: 'Broadcast group for teachers & admins.', staffIds: ['u-principal', 'u-teacher', 'u-teacher2', 'u-anurag', 'u-aanya', 'u-renu'], staffInchargeId: 'u-principal' })
  grp({ id: 'grp-nursery-parents', type: 'parents', name: 'Nursery Parents', description: 'Parents of all Nursery children.', classIds: ['cls-jh-nursery'], staffInchargeId: 'u-aanya' })
  grp({ id: 'grp-srkg-class', type: 'class', name: 'Senior KG (whole class)', description: 'Sr. KG staff + parents for class-wide notices.', classIds: ['cls-jh-srkg'], staffIds: ['u-anurag'], staffInchargeId: 'u-anurag' })

  seedOrgTree(push)
  seedTasks(push)

  db._counters ={ 'invoice-JH': invSeq, 'receipt-JH': rcpSeq, 'invoice-GB': 0, 'receipt-GB': 0, employeeId: 15 }
  return db
}

// ==========================================================================
// Org tree — HQ over two schools, one franchise (deeper) and one company-owned
// (shallower). Same permission behaviour on both branches: it is all ancestry.
//
//   node-hq            depth 0   Managing Director, HQ Co-ordinator
//    ├ node-own-jh     depth 1   School Owner            (franchise tier)
//    │  └ node-sch-jh  depth 2   Principal, VP, Teachers
//    └ node-sch-gb     depth 1   Principal, Teacher      (no owner tier)
//
// Exported so db.migrate() can graft it onto an existing db.json without a wipe.
// ==========================================================================
// HQ tiers above the schools. The co-ordinator has no branchId — HQ staff are
// cross-branch by definition; their reach is bounded by the org tree, not by
// branch tenancy.
export function seedHqUsers(push) {
  const hqStaff = [
    ['u-coord', 'Nandita Rao', 'nandita.rao', 'hq_coordinator', null, 'EMP/14', 'HQ School Co-ordinator', '+91 90000 45510'],
    ['u-owner', 'Prakash Reddy', 'prakash.reddy', 'school_owner', 'br-jh', 'EMP/15', 'Franchise Owner — Jubilee Hills', '+91 90000 45511'],
  ]
  for (const [id, name, username, role, branchId, employeeId, designation, phone] of hqStaff) {
    push('users', { id, name, email: `${username}@kidzonia.com`, phone, passwordHash: HASH, role, branchId, guardianId: null, active: true, employeeId, username, designation, subjects: [], classTeacherOf: [], subjectTeacher: false, groupAdmin: false, photoId: null })
  }
}

export function seedOrgTree(push) {
  const orgNode = (o) => push('orgNodes', {
    code: null, branchId: null, isFranchise: false, timezone: 'Asia/Kolkata',
    settings: { blockingLogoutEnabled: true, workWeek: [1, 2, 3, 4, 5, 6], dayEndReport: false },
    active: true, ...o, depth: o.path.length - 1,
  })
  orgNode({ id: 'node-hq', type: 'hq', name: 'Kidzonia HQ', code: 'HQ', parentId: null, path: ['node-hq'] })
  orgNode({ id: 'node-own-jh', type: 'franchise', name: 'Jubilee Hills Franchise', code: 'JH-FR', parentId: 'node-hq', path: ['node-hq', 'node-own-jh'], isFranchise: true })
  orgNode({ id: 'node-sch-jh', type: 'school', name: 'Kidzonia Jubilee Hills', code: 'JH', parentId: 'node-own-jh', path: ['node-hq', 'node-own-jh', 'node-sch-jh'], branchId: 'br-jh', isFranchise: true })
  orgNode({ id: 'node-sch-gb', type: 'school', name: 'Kidzonia Gachibowli', code: 'GB', parentId: 'node-hq', path: ['node-hq', 'node-sch-gb'], branchId: 'br-gb' })

  // Levels are all scoped to the HQ root, so HQ defines the tiers for HQ *and*
  // for every school. A school creating its own tier would scope it to itself.
  const level = (id, name, scopeKind, rank, color) =>
    push('orgLevels', { id, name, code: name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), scopeNodeId: 'node-hq', scopeKind, rank, color, createdByPositionId: 'pos-meera', active: true })
  level('lvl-md', 'Managing Director', 'hq', 0, '#7c3aed')
  level('lvl-hq-coord', 'HQ School Co-ordinator', 'hq', 10, '#2563eb')
  level('lvl-owner', 'School Owner', 'franchise', 0, '#c2410c')
  level('lvl-principal', 'Principal', 'school', 10, '#12907e')
  level('lvl-vp', 'Vice Principal', 'school', 20, '#0891b2')
  level('lvl-sch-coord', 'School Co-ordinator', 'school', 30, '#65a30d')
  // rank is AUTHORITY at a node, not a display order: the floor staff are peers
  // of each other, so they all sit at 40 and none can assign to another.
  level('lvl-teacher', 'Teacher', 'school', 40, '#f4772e')
  level('lvl-daycare', 'Day Care Staff', 'school', 40, '#db2777')
  level('lvl-frontdesk', 'Front Desk', 'school', 40, '#64748b')
  level('lvl-accounts', 'Accountant', 'school', 40, '#475569')

  const LEVEL_RANK = { 'lvl-md': 0, 'lvl-hq-coord': 10, 'lvl-owner': 0, 'lvl-principal': 10, 'lvl-vp': 20, 'lvl-sch-coord': 30, 'lvl-teacher': 40, 'lvl-daycare': 40, 'lvl-frontdesk': 40, 'lvl-accounts': 40 }
  const NODE_PATH = { 'node-hq': ['node-hq'], 'node-own-jh': ['node-hq', 'node-own-jh'], 'node-sch-jh': ['node-hq', 'node-own-jh', 'node-sch-jh'], 'node-sch-gb': ['node-hq', 'node-sch-gb'] }
  const position = (id, userId, nodeId, levelId, title = null) => push('orgPositions', {
    id, userId, nodeId, levelId, title,
    rank: LEVEL_RANK[levelId], nodePath: NODE_PATH[nodeId], depth: NODE_PATH[nodeId].length - 1,
    isPrimary: true, startDate: '2026-06-01', endDate: null, active: true,
  })
  position('pos-meera', 'u-super', 'node-hq', 'lvl-md')
  position('pos-nandita', 'u-coord', 'node-hq', 'lvl-hq-coord')
  position('pos-prakash', 'u-owner', 'node-own-jh', 'lvl-owner')
  position('pos-lakshmi', 'u-principal', 'node-sch-jh', 'lvl-principal')
  position('pos-sudhir', 'u-sudhir', 'node-sch-jh', 'lvl-vp')
  position('pos-anjali', 'u-teacher', 'node-sch-jh', 'lvl-teacher')
  position('pos-kavya', 'u-teacher2', 'node-sch-jh', 'lvl-teacher')
  position('pos-anurag', 'u-anurag', 'node-sch-jh', 'lvl-teacher', 'Senior Teacher')
  position('pos-aanya', 'u-aanya', 'node-sch-jh', 'lvl-teacher')
  position('pos-renu', 'u-renu', 'node-sch-jh', 'lvl-teacher')
  position('pos-gayatri', 'u-gayatri', 'node-sch-jh', 'lvl-daycare')
  position('pos-ravi', 'u-frontdesk', 'node-sch-jh', 'lvl-frontdesk')
  position('pos-suresh', 'u-accounts', 'node-sch-jh', 'lvl-accounts')
  position('pos-sunil', 'u-principal-gb', 'node-sch-gb', 'lvl-principal')
  position('pos-divya', 'u-teacher-gb', 'node-sch-gb', 'lvl-teacher')
}

// ==========================================================================
// Task templates + a worked example of every occurrence state. Occurrence ids
// are the same (task|position|date) hash the generator uses, so seeded rows and
// generated ones are the same rows — nothing duplicates on first read.
// ==========================================================================
export function seedTasks(push) {
  const cat = (id, name, color) => push('taskCategories', { id, name, color, active: true })
  cat('tcat-compliance', 'Compliance', '#e5484d')
  cat('tcat-ops', 'Operations', '#f4772e')
  cat('tcat-academics', 'Academics', '#12907e')
  cat('tcat-parents', 'Parent Engagement', '#5b4a99')
  cat('tcat-safety', 'Safety', '#ad7a12')

  const task = (o) => push('tasks', {
    description: '', priority: 'normal', categoryId: null,
    dueType: 'end_of_day', dueConfig: { startDate: null, dueDate: null, days: null },
    recurrence: { freq: 'none', byWeekday: [], dayOfMonth: null, interval: 1, startDate: TODAY, endDate: null, count: null, skipNonWorkingDays: false },
    requiresApproval: false, approverPositionId: null,
    requiresMedia: false, mediaTypes: ['photo', 'document'], minAttachments: 0,
    isBlocking: false, status: 'active', academicYearId: null,
    lastGeneratedThrough: null, createdAtNodeId: null,
    ...o,
  })

  // 1. DAILY, mandatory, blocks logout — Principal -> all JH teachers.
  // skipNonWorkingDays: no occurrence on Sundays or on school-calendar holidays.
  task({
    id: 'task-attendance', title: 'Mark class attendance',
    description: 'Mark every child present, absent or on leave in the app before you go home.',
    createdByUserId: 'u-principal', createdByPositionId: 'pos-lakshmi', createdAtNodeId: 'node-sch-jh',
    approverPositionId: 'pos-lakshmi',
    target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelId: 'lvl-teacher', positionIds: [], userIds: [], includeSubtree: true },
    priority: 'high', categoryId: 'tcat-compliance', isBlocking: true,
    recurrence: { freq: 'daily', byWeekday: [], dayOfMonth: null, interval: 1, startDate: dateStr(daysFromNow(-7)), endDate: null, count: null, skipNonWorkingDays: true },
    academicYearId: 'ay-jh-26', lastGeneratedThrough: TODAY,
  })

  // 1b. WEEKLY — Vice Principal -> the day-care staff, every Friday.
  task({
    id: 'task-weekly-inventory', title: 'Weekly day-care inventory count',
    description: 'Count nappies, wipes and spare uniforms; flag anything under a week of stock.',
    createdByUserId: 'u-sudhir', createdByPositionId: 'pos-sudhir', createdAtNodeId: 'node-sch-jh',
    approverPositionId: 'pos-sudhir',
    target: { kind: 'position', positionIds: ['pos-gayatri'], userIds: [], nodeIds: [], includeSubtree: true },
    categoryId: 'tcat-ops', requiresApproval: true,
    recurrence: { freq: 'weekly', byWeekday: [5], dayOfMonth: null, interval: 1, startDate: dateStr(daysFromNow(-21)), endDate: null, count: null, skipNonWorkingDays: true },
    academicYearId: 'ay-jh-26', lastGeneratedThrough: TODAY,
  })

  // 1c. DAILY, day care -> parents. Automated origin, MCQ nature, and the first
  // task that DOES something when it finishes: answering Yes tells the parents
  // of every child in the group that their child has eaten. Answering No still
  // completes the task — the food not arriving is a fact worth recording — and
  // fires nothing, which is what `when.answer` is for.
  task({
    id: 'task-daycare-lunch', title: 'Day-care lunch served',
    description: 'Confirm the day-care children have been given their lunch, with a photo of the meal.',
    createdByUserId: 'u-sudhir', createdByPositionId: 'pos-sudhir', createdAtNodeId: 'node-sch-jh',
    approverPositionId: 'pos-sudhir',
    target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelId: 'lvl-daycare', positionIds: [], userIds: [], includeSubtree: true },
    categoryId: 'tcat-parents', priority: 'high',
    origin: 'automated',
    requiresMedia: true, mediaTypes: ['photo'], minAttachments: 1,
    completionCondition: {
      nature: 'mcq',
      mcq: {
        question: 'Did you give food to the day-care children?',
        options: [
          { value: 'yes', label: 'Yes', accepts: true },
          // No completes it too: the task is a daily record, not a gate
          { value: 'no', label: 'No', accepts: true },
        ],
        requiredAnswer: 'yes',
        requireMedia: true,
      },
      moduleLinked: null, custom: null, derivedFrom: null,
    },
    onComplete: {
      // ONE way to tell parents something, on any task in any module: the
      // action sends whatever the assigner wrote. Nothing about it is day-care
      // specific, so it can never claim a child was fed on the strength of a
      // task that checked something else.
      actions: [{
        moduleKey: 'parents', actionKey: 'notify',
        paramBinding: { sectionId: { source: 'assignee.section' }, date: { source: 'instance.serviceDate' } },
        config: { message: '{child} was given lunch at day care on {date}.' },
        onFailure: 'warn', when: { answer: 'yes' },
      }],
    },
    lockOnComplete: [],
    recurrence: { freq: 'daily', byWeekday: [], dayOfMonth: null, interval: 1, startDate: dateStr(daysFromNow(-2)), endDate: null, count: null, skipNonWorkingDays: true },
    academicYearId: 'ay-jh-26', lastGeneratedThrough: TODAY,
  })

  // 2. daily, proof + approval — Principal -> JH teachers
  task({
    id: 'task-photos', title: 'Upload 3 classroom photos',
    description: 'Share the day’s activity photos for the parent diary.',
    createdByUserId: 'u-principal', createdByPositionId: 'pos-lakshmi', createdAtNodeId: 'node-sch-jh',
    approverPositionId: 'pos-lakshmi',
    target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelId: 'lvl-teacher', positionIds: [], userIds: [], includeSubtree: true },
    categoryId: 'tcat-parents', requiresApproval: true, requiresMedia: true, mediaTypes: ['photo'], minAttachments: 3,
    recurrence: { freq: 'daily', byWeekday: [], dayOfMonth: null, interval: 1, startDate: dateStr(daysFromNow(-3)), endDate: null, count: null, skipNonWorkingDays: false },
    academicYearId: 'ay-jh-26', lastGeneratedThrough: TODAY,
  })

  // 3. Mon/Wed/Fri — Principal -> JH teachers
  task({
    id: 'task-parentcalls', title: 'Parent call round-up',
    description: 'Call two families and log the conversation.',
    createdByUserId: 'u-principal', createdByPositionId: 'pos-lakshmi', createdAtNodeId: 'node-sch-jh',
    approverPositionId: 'pos-lakshmi',
    target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelId: 'lvl-teacher', positionIds: [], userIds: [], includeSubtree: true },
    categoryId: 'tcat-parents', dueType: 'n_days', dueConfig: { startDate: null, dueDate: null, days: 1 },
    recurrence: { freq: 'weekdays', byWeekday: [1, 3, 5], dayOfMonth: null, interval: 1, startDate: dateStr(daysFromNow(-14)), endDate: null, count: null, skipNonWorkingDays: true },
    academicYearId: 'ay-jh-26', lastGeneratedThrough: TODAY,
  })

  // 4. monthly across BOTH schools — HQ Co-ordinator -> every principal
  task({
    id: 'task-audit', title: 'Monthly compliance self-audit',
    description: 'Fire equipment, first-aid stock, staff police verification and CCTV uptime.',
    createdByUserId: 'u-coord', createdByPositionId: 'pos-nandita', createdAtNodeId: 'node-hq',
    approverPositionId: 'pos-nandita',
    target: { kind: 'node_level', nodeIds: ['node-hq'], levelId: 'lvl-principal', positionIds: [], userIds: [], includeSubtree: true },
    priority: 'high', categoryId: 'tcat-compliance', requiresApproval: true, requiresMedia: true, mediaTypes: ['document', 'photo'], minAttachments: 1,
    recurrence: { freq: 'monthly', byWeekday: [], dayOfMonth: 5, interval: 1, startDate: dateStr(daysFromNow(-60)), endDate: null, count: null, skipNonWorkingDays: false },
    lastGeneratedThrough: TODAY,
  })

  // 5. one-off with a window — Franchise Owner -> JH Principal
  task({
    id: 'task-firedrill', title: 'Quarterly fire drill + report',
    description: 'Run the drill, record evacuation time and file the signed report.',
    createdByUserId: 'u-owner', createdByPositionId: 'pos-prakash', createdAtNodeId: 'node-own-jh',
    approverPositionId: 'pos-prakash',
    target: { kind: 'position', positionIds: ['pos-lakshmi'], userIds: [], nodeIds: [], includeSubtree: true },
    priority: 'urgent', categoryId: 'tcat-safety', requiresApproval: true,
    dueType: 'date_window', dueConfig: { startDate: dateStr(daysFromNow(-5)), dueDate: dateStr(daysFromNow(-1)), days: null },
    recurrence: { freq: 'none', byWeekday: [], dayOfMonth: null, interval: 1, startDate: dateStr(daysFromNow(-5)), endDate: null, count: null, skipNonWorkingDays: false },
  })

  // 6. one-off — Managing Director -> HQ Co-ordinator (gets deferred)
  task({
    id: 'task-hqreview', title: 'Draft the Q2 school performance review',
    createdByUserId: 'u-super', createdByPositionId: 'pos-meera', createdAtNodeId: 'node-hq',
    approverPositionId: 'pos-meera',
    target: { kind: 'position', positionIds: ['pos-nandita'], userIds: [], nodeIds: [], includeSubtree: true },
    categoryId: 'tcat-ops', dueType: 'n_days', dueConfig: { startDate: null, dueDate: null, days: 5 },
    recurrence: { freq: 'none', byWeekday: [], dayOfMonth: null, interval: 1, startDate: YESTERDAY, endDate: null, count: null, skipNonWorkingDays: false },
  })

  // 7. one-off — Principal -> Front Desk (gets cancelled)
  task({
    id: 'task-uniform', title: 'Collect uniform size list',
    createdByUserId: 'u-principal', createdByPositionId: 'pos-lakshmi', createdAtNodeId: 'node-sch-jh',
    approverPositionId: 'pos-lakshmi',
    target: { kind: 'position', positionIds: ['pos-ravi'], userIds: [], nodeIds: [], includeSubtree: true },
    categoryId: 'tcat-ops',
    recurrence: { freq: 'none', byWeekday: [], dayOfMonth: null, interval: 1, startDate: YESTERDAY, endDate: null, count: null, skipNonWorkingDays: false },
    academicYearId: 'ay-jh-26',
  })

  // 8. the other school, so the non-franchise branch has live work too
  task({
    id: 'task-gb-safety', title: 'Playground safety walkthrough',
    createdByUserId: 'u-principal-gb', createdByPositionId: 'pos-sunil', createdAtNodeId: 'node-sch-gb',
    approverPositionId: 'pos-sunil',
    target: { kind: 'node_level', nodeIds: ['node-sch-gb'], levelId: 'lvl-teacher', positionIds: [], userIds: [], includeSubtree: true },
    categoryId: 'tcat-safety', isBlocking: true,
    recurrence: { freq: 'daily', byWeekday: [], dayOfMonth: null, interval: 1, startDate: dateStr(daysFromNow(-2)), endDate: null, count: null, skipNonWorkingDays: false },
    academicYearId: 'ay-gb-26', lastGeneratedThrough: TODAY,
  })

  // ---- occurrences, one per state ----------------------------------------
  const TEACHERS = [
    ['pos-anjali', 'u-teacher', 'Anjali Rao'],
    ['pos-kavya', 'u-teacher2', 'Kavya Menon'],
    ['pos-anurag', 'u-anurag', 'ANURAG JAIN'],
    ['pos-aanya', 'u-aanya', 'AANYA KHAN'],
    ['pos-renu', 'u-renu', 'Renu Nair'],
  ]
  const eod = (d) => `${d}T18:29:59.999Z`      // 23:59:59.999 Asia/Kolkata
  const sod = (d) => `${dateStr(new Date(new Date(`${d}T00:00:00Z`).getTime() - 86400000))}T18:30:00.000Z`

  const inst = (o) => push('taskInstances', {
    tz: 'Asia/Kolkata', status: 'assigned',
    startedAt: null, submittedAt: null, decidedAt: null, completedAt: null, overdueAt: null,
    submissionRound: 1, rejectionCount: 0, lastComment: null, attachmentIds: [],
    priority: 'normal', isBlocking: false, requiresApproval: false, requiresMedia: false,
    mediaTypes: ['photo', 'document'], minAttachments: 0,
    deferredTo: null, deferredByPositionId: null, deferReason: null, cancelReason: null,
    academicYearId: 'ay-jh-26', branchId: 'br-jh',
    startAt: sod(o.serviceDate), dueAt: eod(o.serviceDate),
    occurrenceKey: o.serviceDate,
    ...o,
    id: instanceId(o.taskId, o.assigneePositionId, o.serviceDate),
  })

  // yesterday's attendance: four done, one never closed -> flips to overdue on read
  TEACHERS.forEach(([posId, userId, name], i) => {
    inst({
      taskId: 'task-attendance', serviceDate: YESTERDAY,
      assigneePositionId: posId, assigneeUserId: userId, assigneeName: name,
      assigneeNodeId: 'node-sch-jh', assignedByUserId: 'u-principal', assignedByPositionId: 'pos-lakshmi',
      approverPositionId: 'pos-lakshmi', title: 'Mark class attendance',
      priority: 'high', isBlocking: true,
      status: i === 4 ? 'assigned' : 'approved',
      startedAt: iso(daysFromNow(-1)), submittedAt: i === 4 ? null : iso(daysFromNow(-1)), completedAt: i === 4 ? null : iso(daysFromNow(-1)),
    })
  })
  // today: two started, three untouched
  TEACHERS.forEach(([posId, userId, name], i) => {
    inst({
      taskId: 'task-attendance', serviceDate: TODAY,
      assigneePositionId: posId, assigneeUserId: userId, assigneeName: name,
      assigneeNodeId: 'node-sch-jh', assignedByUserId: 'u-principal', assignedByPositionId: 'pos-lakshmi',
      approverPositionId: 'pos-lakshmi', title: 'Mark class attendance',
      priority: 'high', isBlocking: true,
      status: i < 2 ? 'in_progress' : 'assigned',
      startedAt: i < 2 ? iso(now) : null,
    })
  })

  // photos: awaiting approval, sent back (live work again), approved.
  // "sent back" is in_progress with a rejection on it — the UI derives the
  // "Sent back" pill from that, and it still blocks logout if mandatory.
  const SENT_BACK_REASON = 'Two of the three photos are blurry — please retake.'
  const photoStates = [
    ['pos-kavya', 'u-teacher2', 'Kavya Menon', 'submitted'],
    ['pos-anjali', 'u-teacher', 'Anjali Rao', 'sent_back'],
    ['pos-anurag', 'u-anurag', 'ANURAG JAIN', 'approved'],
  ]
  for (const [posId, userId, name, state] of photoStates) {
    const sentBack = state === 'sent_back'
    inst({
      taskId: 'task-photos', serviceDate: TODAY,
      assigneePositionId: posId, assigneeUserId: userId, assigneeName: name,
      assigneeNodeId: 'node-sch-jh', assignedByUserId: 'u-principal', assignedByPositionId: 'pos-lakshmi',
      approverPositionId: 'pos-lakshmi', title: 'Upload 3 classroom photos',
      requiresApproval: true, requiresMedia: true, mediaTypes: ['photo'], minAttachments: 3,
      status: sentBack ? 'in_progress' : state,
      startedAt: iso(now),
      submittedAt: state === 'approved' || state === 'submitted' ? iso(now) : null,
      decidedAt: state === 'submitted' ? null : iso(now),
      completedAt: state === 'approved' ? iso(now) : null,
      submissionRound: sentBack ? 2 : 1,
      rejectionCount: sentBack ? 1 : 0,
      lastComment: sentBack ? SENT_BACK_REASON : null,
      lastRejection: sentBack
        ? { at: iso(now), by: 'u-principal', byName: 'Lakshmi Devi', reason: SENT_BACK_REASON, round: 1 }
        : null,
    })
  }
  push('taskApprovals', {
    id: 'tapp-1', instanceId: instanceId('task-photos', 'pos-anjali', TODAY), round: 1, decision: 'rejected',
    approverUserId: 'u-principal', approverPositionId: 'pos-lakshmi',
    comment: SENT_BACK_REASON, viaOverride: false, decidedAt: iso(now),
  })
  push('taskApprovals', {
    id: 'tapp-2', instanceId: instanceId('task-photos', 'pos-anurag', TODAY), round: 1, decision: 'approved',
    approverUserId: 'u-principal', approverPositionId: 'pos-lakshmi',
    comment: 'Lovely shots of circle time.', viaOverride: false, decidedAt: iso(now),
  })

  // overdue: the fire drill window closed yesterday and nothing was filed
  inst({
    taskId: 'task-firedrill', serviceDate: dateStr(daysFromNow(-5)),
    assigneePositionId: 'pos-lakshmi', assigneeUserId: 'u-principal', assigneeName: 'Lakshmi Devi',
    assigneeNodeId: 'node-sch-jh', assignedByUserId: 'u-owner', assignedByPositionId: 'pos-prakash',
    approverPositionId: 'pos-prakash', title: 'Quarterly fire drill + report',
    priority: 'urgent', requiresApproval: true,
    status: 'overdue', startedAt: iso(daysFromNow(-3)), overdueAt: iso(daysFromNow(-1)),
    startAt: sod(dateStr(daysFromNow(-5))), dueAt: eod(dateStr(daysFromNow(-1))),
  })

  // deferred by the Managing Director
  inst({
    taskId: 'task-hqreview', serviceDate: YESTERDAY,
    assigneePositionId: 'pos-nandita', assigneeUserId: 'u-coord', assigneeName: 'Nandita Rao',
    assigneeNodeId: 'node-hq', assignedByUserId: 'u-super', assignedByPositionId: 'pos-meera',
    approverPositionId: 'pos-meera', title: 'Draft the Q2 school performance review',
    academicYearId: null, branchId: null,
    status: 'deferred', deferredTo: dateStr(daysFromNow(4)), deferredByPositionId: 'pos-meera',
    deferReason: 'Waiting on the audited fee collection numbers.',
    dueAt: eod(dateStr(daysFromNow(4))),
  })

  // cancelled
  inst({
    taskId: 'task-uniform', serviceDate: YESTERDAY,
    assigneePositionId: 'pos-ravi', assigneeUserId: 'u-frontdesk', assigneeName: 'Ravi Teja',
    assigneeNodeId: 'node-sch-jh', assignedByUserId: 'u-principal', assignedByPositionId: 'pos-lakshmi',
    approverPositionId: 'pos-lakshmi', title: 'Collect uniform size list',
    status: 'cancelled', cancelReason: 'Vendor is sending a pre-filled sheet instead.',
  })

  // the monthly audit, one per principal — pending on both branches
  inst({
    taskId: 'task-audit', serviceDate: YESTERDAY,
    assigneePositionId: 'pos-lakshmi', assigneeUserId: 'u-principal', assigneeName: 'Lakshmi Devi',
    assigneeNodeId: 'node-sch-jh', assignedByUserId: 'u-coord', assignedByPositionId: 'pos-nandita',
    approverPositionId: 'pos-nandita', title: 'Monthly compliance self-audit',
    priority: 'high', requiresApproval: true, requiresMedia: true, mediaTypes: ['document', 'photo'], minAttachments: 1,
    status: 'submitted', startedAt: iso(daysFromNow(-1)), submittedAt: iso(now),
    academicYearId: null,
  })
  inst({
    taskId: 'task-audit', serviceDate: YESTERDAY,
    assigneePositionId: 'pos-sunil', assigneeUserId: 'u-principal-gb', assigneeName: 'Sunil Kumar',
    assigneeNodeId: 'node-sch-gb', assignedByUserId: 'u-coord', assignedByPositionId: 'pos-nandita',
    approverPositionId: 'pos-nandita', title: 'Monthly compliance self-audit',
    priority: 'high', requiresApproval: true, requiresMedia: true, mediaTypes: ['document', 'photo'], minAttachments: 1,
    status: 'in_progress', startedAt: iso(daysFromNow(-1)),
    academicYearId: null, branchId: 'br-gb',
  })
}
