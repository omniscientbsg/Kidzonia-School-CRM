import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS = path.join(__dirname, 'uploads')

const HASH = bcrypt.hashSync('password', 10)
const now = new Date()
const iso = (d) => d.toISOString()
const dateStr = (d) => d.toISOString().slice(0, 10)
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
    push('academicYears', { id: `ay-${br}-26`, branchId: `br-${br}`, name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', active: true })
  }

  const PROGRAMS = [
    ['daycare', 'Daycare', 6, 36],
    ['playgroup', 'Playgroup', 24, 42],
    ['nursery', 'Nursery', 36, 54],
    ['jrkg', 'Jr. KG', 48, 66],
    ['srkg', 'Sr. KG', 60, 78],
  ]
  for (const br of ['jh', 'gb']) {
    for (const [key, name, min, max] of PROGRAMS) {
      push('programs', { id: `prog-${br}-${key}`, branchId: `br-${br}`, name, ageMinMonths: min, ageMaxMonths: max })
      push('classes', { id: `cls-${br}-${key}`, branchId: `br-${br}`, academicYearId: `ay-${br}-26`, programId: `prog-${br}-${key}`, name, capacity: 40 })
    }
  }
  const SECTIONS = [
    ['sec-jh-daycare-a', 'cls-jh-daycare', 'A', 12, null],
    ['sec-jh-playgroup-a', 'cls-jh-playgroup', 'A', 15, null],
    ['sec-jh-nursery-a', 'cls-jh-nursery', 'A', 20, 'u-teacher'],
    ['sec-jh-nursery-b', 'cls-jh-nursery', 'B', 20, null],
    ['sec-jh-jrkg-a', 'cls-jh-jrkg', 'A', 20, 'u-teacher2'],
    ['sec-jh-jrkg-b', 'cls-jh-jrkg', 'B', 20, null],
    ['sec-jh-srkg-a', 'cls-jh-srkg', 'A', 20, null],
    ['sec-gb-nursery-a', 'cls-gb-nursery', 'A', 20, 'u-teacher-gb'],
    ['sec-gb-jrkg-a', 'cls-gb-jrkg', 'A', 20, 'u-teacher-gb'],
  ]
  for (const [id, classId, name, capacity, teacherId] of SECTIONS) {
    push('sections', { id, classId, name, capacity, teacherId })
  }

  // ---------- users (staff) ----------
  const staff = [
    ['u-super', 'Meera Krishnan', 'superadmin@kidzonia.com', 'super_admin', null],
    ['u-principal', 'Lakshmi Devi', 'principal@kidzonia.com', 'branch_admin', 'br-jh'],
    ['u-frontdesk', 'Ravi Teja', 'frontdesk@kidzonia.com', 'front_desk', 'br-jh'],
    ['u-accounts', 'Suresh Babu', 'accounts@kidzonia.com', 'accountant', 'br-jh'],
    ['u-teacher', 'Anjali Rao', 'teacher@kidzonia.com', 'teacher', 'br-jh'],
    ['u-teacher2', 'Kavya Menon', 'teacher2@kidzonia.com', 'teacher', 'br-jh'],
    ['u-principal-gb', 'Sunil Kumar', 'principal.gb@kidzonia.com', 'branch_admin', 'br-gb'],
    ['u-teacher-gb', 'Divya Nair', 'teacher.gb@kidzonia.com', 'teacher', 'br-gb'],
  ]
  for (const [id, name, email, role, branchId] of staff) {
    push('users', { id, name, email, phone: null, passwordHash: HASH, role, branchId, guardianId: null, active: true })
  }

  // ---------- role permissions ----------
  const P = (view, create, edit, del) => ({ view, create, edit, delete: del })
  const ALL = P(true, true, true, true)
  const VIEW = P(true, false, false, false)
  const NONE = P(false, false, false, false)
  const MODULES = ['crm', 'admissions', 'students', 'attendance', 'fees', 'daily', 'comms', 'worksheets', 'settings', 'dashboards']
  const matrix = {
    branch_admin: { crm: ALL, admissions: ALL, students: ALL, attendance: ALL, fees: ALL, daily: ALL, comms: ALL, worksheets: ALL, settings: ALL, dashboards: VIEW },
    front_desk: { crm: ALL, admissions: ALL, students: P(true, true, false, false), attendance: VIEW, fees: P(true, true, false, false), daily: VIEW, comms: P(true, true, false, false), worksheets: VIEW, settings: NONE, dashboards: VIEW },
    accountant: { crm: NONE, admissions: VIEW, students: VIEW, attendance: NONE, fees: ALL, daily: NONE, comms: VIEW, worksheets: NONE, settings: NONE, dashboards: VIEW },
    teacher: { crm: NONE, admissions: NONE, students: VIEW, attendance: ALL, fees: NONE, daily: ALL, comms: P(true, true, true, false), worksheets: P(true, true, true, false), settings: NONE, dashboards: VIEW },
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
    push('students', {
      id: sid, branchId, familyId: fam.id, applicationId: null,
      firstName: first, lastName: last, dob: dateStr(yearsAgo(age, i * 3)), gender: i % 2 === 0 ? 'male' : 'female',
      photoId: null, bloodGroup: ['O+', 'A+', 'B+', 'AB+'][i % 4],
      allergies: i % 7 === 0 ? 'Peanuts' : '', medicalNotes: '',
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
  nurseryA.forEach((sid, idx) => {
    push('attendanceRecords', { id: `att-y-${sid}`, branchId: 'br-jh', sectionId: 'sec-jh-nursery-a', studentId: sid, date: YESTERDAY, status: 'present', reason: '', markedBy: 'u-teacher' })
    const status = idx === 0 ? 'late' : idx === 1 ? 'absent' : 'present'
    push('attendanceRecords', { id: `att-t-${sid}`, branchId: 'br-jh', sectionId: 'sec-jh-nursery-a', studentId: sid, date: TODAY, status, reason: status === 'late' ? 'Traffic delay' : '', markedBy: 'u-teacher' })
  })

  push('leaveRequests', { id: 'lv-1', studentId: 'stu-1', fromDate: dateStr(daysFromNow(5)), toDate: dateStr(daysFromNow(7)), reason: 'Family wedding', status: 'pending', decidedBy: null })
  push('leaveRequests', { id: 'lv-2', studentId: 'stu-11', fromDate: dateStr(daysFromNow(-10)), toDate: dateStr(daysFromNow(-9)), reason: 'Fever', status: 'approved', decidedBy: 'u-principal' })

  // ---------- fees ----------
  const HEADS = ['admission', 'tuition', 'transport', 'meals', 'activity', 'uniform', 'books', 'deposit', 'late_fee']
  for (const br of ['jh', 'gb']) {
    for (const h of HEADS) {
      push('feeHeads', { id: `fh-${br}-${h}`, branchId: `br-${br}`, name: h === 'late_fee' ? 'Late Fee' : h[0].toUpperCase() + h.slice(1), code: h.toUpperCase() })
    }
  }
  const TUITION = { daycare: 12000, playgroup: 8000, nursery: 9000, jrkg: 10000, srkg: 11000 }
  for (const br of ['jh', 'gb']) {
    for (const [key] of PROGRAMS) {
      push('feeStructures', {
        id: `fs-${br}-${key}`, branchId: `br-${br}`, academicYearId: `ay-${br}-26`, programId: `prog-${br}-${key}`,
        name: `${key[0].toUpperCase() + key.slice(1)} 2026-27`,
        lines: [
          { feeHeadId: `fh-${br}-admission`, amount: 25000, cycle: 'one_time' },
          { feeHeadId: `fh-${br}-deposit`, amount: 10000, cycle: 'one_time' },
          { feeHeadId: `fh-${br}-tuition`, amount: TUITION[key], cycle: 'monthly' },
          { feeHeadId: `fh-${br}-meals`, amount: 1500, cycle: 'monthly' },
          { feeHeadId: `fh-${br}-transport`, amount: 2000, cycle: 'monthly' },
          { feeHeadId: `fh-${br}-activity`, amount: 6000, cycle: 'annual' },
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
      { feeHeadId: 'fh-jh-tuition', description: `Tuition – ${monthLabel}`, amount: TUITION[progKey] },
      { feeHeadId: 'fh-jh-meals', description: `Meals – ${monthLabel}`, amount: 1500 },
      { feeHeadId: 'fh-jh-transport', description: `Transport – ${monthLabel}`, amount: 2000 },
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
  push('discounts', { id: 'disc-1', branchId: 'br-jh', studentId: 'stu-11', invoiceId: null, name: 'Sibling discount 10%', amount: 1050, reason: 'Second child (Anaya Sharma)', status: 'pending', approvedBy: null })

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

  db._counters = { 'invoice-JH': invSeq, 'receipt-JH': rcpSeq, 'invoice-GB': 0, 'receipt-GB': 0 }
  return db
}
