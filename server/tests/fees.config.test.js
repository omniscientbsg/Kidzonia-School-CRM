import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('fees config: fee heads as first-class components', async (t) => {
  await startServer()
  t.after(stopServer)
  const accountant = await login('accounts@kidzonia.com') // br-jh, fees:ALL
  const superToken = await login('superadmin@kidzonia.com')

  await t.test('seeded heads carry periodicity + tax/refund flags + usage', async () => {
    const { status, data } = await api('GET', '/api/fee-heads?branchId=br-jh', { token: accountant })
    assert.equal(status, 200)
    const byCode = Object.fromEntries(data.map((h) => [h.code, h]))
    assert.equal(byCode.ADMISSION.periodicity, 'one_time')
    assert.equal(byCode.TUITION.periodicity, 'monthly')
    assert.equal(byCode.ACTIVITY.periodicity, 'annual')
    assert.equal(byCode.DEPOSIT.refundable, true)
    assert.equal(byCode.TUITION.taxable, false)
    // tuition is referenced by structures + invoices
    assert.ok(byCode.TUITION.usage.total > 0)
    assert.ok(byCode.TUITION.usage.structures > 0)
  })

  await t.test('cannot delete a head in use — 409 with usage', async () => {
    const { status, data } = await api('DELETE', '/api/fee-heads/fh-jh-tuition', { token: accountant })
    assert.equal(status, 409)
    assert.equal(data.error, 'in_use')
    assert.ok(data.usage.total > 0)
  })

  let createdId
  await t.test('create component: validates periodicity; accountant allowed', async () => {
    const bad = await api('POST', '/api/fee-heads', { token: accountant, body: { name: 'Bad', periodicity: 'weekly', branchId: 'br-jh' } })
    assert.equal(bad.status, 422)
    const ok = await api('POST', '/api/fee-heads', { token: accountant, body: { name: 'Additional Hours', periodicity: 'monthly', taxable: true, gstPct: 18, branchId: 'br-jh' } })
    assert.equal(ok.status, 201)
    assert.equal(ok.data.code, 'ADDITIONAL_HOURS')
    assert.equal(ok.data.gstPct, 18)
    createdId = ok.data.id
  })

  await t.test('unused component can be deleted; deactivate toggles active', async () => {
    const off = await api('PUT', `/api/fee-heads/${createdId}`, { token: accountant, body: { active: false } })
    assert.equal(off.data.active, false)
    // deactivated head hidden by default, shown with includeInactive
    const hidden = await api('GET', '/api/fee-heads?branchId=br-jh', { token: accountant })
    assert.ok(!hidden.data.some((h) => h.id === createdId))
    const shown = await api('GET', '/api/fee-heads?branchId=br-jh&includeInactive=true', { token: accountant })
    assert.ok(shown.data.some((h) => h.id === createdId))
    const del = await api('DELETE', `/api/fee-heads/${createdId}`, { token: accountant })
    assert.equal(del.status, 200)
  })

  await t.test('teacher cannot manage fee heads (fees module denied)', async () => {
    const teacher = await login('teacher@kidzonia.com')
    const r = await api('POST', '/api/fee-heads', { token: teacher, body: { name: 'X', periodicity: 'monthly' } })
    assert.equal(r.status, 403)
  })

  await t.test('super admin sees heads across branches', async () => {
    const all = await api('GET', '/api/fee-heads', { token: superToken })
    const branches = new Set(all.data.map((h) => h.branchId))
    assert.ok(branches.size >= 2)
  })

  // ---- structures ----
  await t.test('seeded structures are class-scoped', async () => {
    const rows = (await api('GET', '/api/fee-structures?classId=cls-jh-nursery', { token: accountant })).data
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, 'fs-jh-nursery')
  })

  await t.test('upsert class structure + annual estimate', async () => {
    // cls-jh-nursery-27 (2027-28 session) has no structure yet
    const r = await api('PUT', '/api/class-fees/structure', {
      token: accountant,
      body: { sessionId: 'ay-jh-27', classId: 'cls-jh-nursery-27', name: 'Nursery 2027-28', lines: [
        { feeHeadId: 'fh-jh-tuition', amount: 1000000, cycle: 'monthly' },
        { feeHeadId: 'fh-jh-admission', amount: 2500000, cycle: 'one_time' },
      ] },
    })
    assert.equal(r.status, 200)
    // annual = tuition 10000×12 + admission 25000×1 = 145000 → paise
    assert.equal(r.data.estimate.annualTotal, 1000000 * 12 + 2500000)
    // re-upsert updates same row (no duplicate)
    const again = await api('PUT', '/api/class-fees/structure', { token: accountant, body: { sessionId: 'ay-jh-27', classId: 'cls-jh-nursery-27', lines: [{ feeHeadId: 'fh-jh-tuition', amount: 1100000, cycle: 'monthly' }] } })
    assert.equal(again.data.id, r.data.id)
    const list27 = (await api('GET', '/api/fee-structures?classId=cls-jh-nursery-27', { token: accountant })).data
    assert.equal(list27.length, 1)
  })

  await t.test('clone structure to another class/session', async () => {
    const r = await api('POST', '/api/class-fees/structure/clone', { token: accountant, body: { sourceId: 'fs-jh-nursery', toClassId: 'cls-jh-jrkg-27', toSessionId: 'ay-jh-27' } })
    assert.equal(r.status, 201)
    assert.equal(r.data.classId, 'cls-jh-jrkg-27')
    assert.equal(r.data.lines.length, 6)
    // cloning again onto same target -> 409
    const dupe = await api('POST', '/api/class-fees/structure/clone', { token: accountant, body: { sourceId: 'fs-jh-nursery', toClassId: 'cls-jh-jrkg-27', toSessionId: 'ay-jh-27' } })
    assert.equal(dupe.status, 409)
  })

  await t.test('teacher cannot edit structures', async () => {
    const teacher = await login('teacher@kidzonia.com')
    const r = await api('PUT', '/api/class-fees/structure', { token: teacher, body: { sessionId: 'ay-jh-26', classId: 'cls-jh-nursery', lines: [] } })
    assert.equal(r.status, 403)
  })

  // ---- per-student overrides ----
  await t.test('effective structure reflects seeded overrides', async () => {
    const a = (await api('GET', '/api/student-fees/stu-1?sessionId=ay-jh-26', { token: accountant })).data
    assert.equal(a.hasOverride, true)
    const tut = a.effective.find((l) => l.feeHeadId === 'fh-jh-tuition')
    assert.equal(tut.amount, 765000)
    assert.equal(tut.source, 'overridden')
    assert.equal(tut.baseAmount, 900000)

    const b = (await api('GET', '/api/student-fees/stu-5?sessionId=ay-jh-26', { token: accountant })).data
    const trans = b.effective.find((l) => l.feeHeadId === 'fh-jh-transport')
    assert.equal(trans.source, 'removed')
    // removed line excluded from the annual estimate
    const c = (await api('GET', '/api/student-fees/stu-3?sessionId=ay-jh-26', { token: accountant })).data
    assert.equal(c.hasOverride, false)
    assert.ok(c.estimate.annualTotal > b.estimate.annualTotal) // stu-3 pays transport, stu-5 doesn't
  })

  await t.test('set + reset a per-student override', async () => {
    const set = await api('PUT', '/api/student-fees/stu-3', { token: accountant, body: { sessionId: 'ay-jh-26', lines: [{ feeHeadId: 'fh-jh-tuition', amount: 800000, cycle: 'monthly' }], removedHeadIds: [] } })
    assert.equal(set.data.hasOverride, true)
    assert.equal(set.data.effective.find((l) => l.feeHeadId === 'fh-jh-tuition').amount, 800000)
    const reset = await api('PUT', '/api/student-fees/stu-3', { token: accountant, body: { sessionId: 'ay-jh-26', lines: [], removedHeadIds: [] } })
    assert.equal(reset.data.hasOverride, false)
  })

  // ---- Excel round-trip ----
  await t.test('fee matrix export lists students × heads', async () => {
    const m = (await api('GET', '/api/class-fees/matrix?classId=cls-jh-nursery&sessionId=ay-jh-26', { token: accountant })).data
    assert.ok(m.cols.length === 6)
    const aarav = m.students.find((s) => s.studentId === 'stu-1')
    assert.equal(aarav.overridden, true)
    assert.equal(aarav.amounts['fh-jh-tuition'], 765000)
  })

  // ---- discounts: concessions / corporate / group + precedence ----
  await t.test('concessions seeded; OBC auto-maps, sibling is explicit', async () => {
    const rows = (await api('GET', '/api/concessions?sessionId=ay-jh-26&branchId=br-jh', { token: accountant })).data
    assert.ok(rows.some((c) => c.category === 'EWS'))
    // stu-3 is OBC category -> auto concession, tuition 15% off
    const preview3 = (await api('GET', '/api/students/stu-3/fee-preview?sessionId=ay-jh-26', { token: accountant })).data
    assert.equal(preview3.concession.category, 'OBC')
    assert.equal(preview3.concession.source, 'auto')
    const tut3 = preview3.lines.find((l) => l.feeHeadId === 'fh-jh-tuition')
    assert.equal(tut3.base, 900000)
    assert.equal(tut3.concession, 135000) // 15% of 9000
    assert.equal(tut3.net, 765000)
  })

  await t.test('corporate + group charge apply; group adds a surcharge', async () => {
    // stu-2 tagged Infosys (tuition 15%) and in Bus Route 3 (transport +₹500 charge)
    const p = (await api('GET', '/api/students/stu-2/fee-preview?sessionId=ay-jh-26', { token: accountant })).data
    assert.equal(p.corporate.name, 'Infosys')
    assert.ok(p.groups.some((g) => g.id === 'grp-bus3'))
    const tut = p.lines.find((l) => l.feeHeadId === 'fh-jh-tuition')
    assert.equal(tut.corporate, 135000)
    assert.equal(tut.net, 765000)
    const trans = p.lines.find((l) => l.feeHeadId === 'fh-jh-transport')
    assert.equal(trans.groupCharge, 50000) // ₹500
    assert.equal(trans.net, trans.base + 50000)
  })

  await t.test('precedence concession → corporate; assign + resolve', async () => {
    const assigned = await api('PUT', '/api/students/stu-2/concession', { token: accountant, body: { sessionId: 'ay-jh-26', concessionId: 'conc-ews' } })
    assert.equal(assigned.status, 200)
    assert.equal(assigned.data.concession.source, 'assigned')
    const tut = assigned.data.lines.find((l) => l.feeHeadId === 'fh-jh-tuition')
    // base 9000: EWS 25% -> 2250 off => 6750; corporate 15% of 6750 = 1012.50 -> net 5737.50
    assert.equal(tut.concession, 225000)
    assert.equal(tut.corporate, 101250)
    assert.equal(tut.net, 573750)
    // unassign restores auto (stu-2 has no auto category) -> no concession
    const un = await api('PUT', '/api/students/stu-2/concession', { token: accountant, body: { sessionId: 'ay-jh-26', concessionId: null } })
    assert.equal(un.data.concession, null)
  })

  await t.test('discounts never push a line below zero', async () => {
    const draft = { type: 'fixed', values: { 'fh-jh-tuition': 99999999 } }
    const r = await api('POST', '/api/concessions/preview', { token: accountant, body: { studentId: 'stu-3', sessionId: 'ay-jh-26', concession: draft } })
    const tut = r.data.lines.find((l) => l.feeHeadId === 'fh-jh-tuition')
    assert.equal(tut.net, 0)
    assert.equal(tut.concession, tut.base) // capped at base, not the huge value
  })

  await t.test('group charges endpoint validates; teacher denied assign', async () => {
    const bad = await api('PUT', '/api/groups/grp-swim/charges', { token: accountant, body: { charges: [{ feeHeadId: 'fh-jh-activity', kind: 'nope', type: 'fixed', value: 100 }] } })
    assert.equal(bad.status, 422)
    const teacher = await login('teacher@kidzonia.com')
    const denied = await api('PUT', '/api/students/stu-2/concession', { token: teacher, body: { sessionId: 'ay-jh-26', concessionId: 'conc-ews' } })
    assert.equal(denied.status, 403)
  })

  // ---- fee settings ----
  await t.test('seeded fee settings + late-fee preview effect', async () => {
    const s = (await api('GET', '/api/fee-settings?sessionId=ay-jh-26&branchId=br-jh', { token: accountant })).data
    assert.equal(s.lateFee.type, 'fixed')
    assert.equal(s.lateFee.amount, 50000) // ₹500 in paise
    assert.equal(s.autoGenerate.enabled, true)
    assert.ok(s.bankAccounts.length >= 1)
    assert.ok(s.reportEmails.includes('accounts@kidzonia.com'))

    // preview: fixed ₹500 on overdue invoices (grace 0 so all overdue counted)
    const prev = await api('POST', '/api/fee-settings/preview', { token: accountant, body: { academicYearId: 'ay-jh-26', branchId: 'br-jh', lateFee: { type: 'fixed', amount: 50000, cap: 0, grace: 0 } } })
    assert.equal(prev.status, 200)
    assert.ok(prev.data.overdueCount >= 1)
    assert.equal(prev.data.totalLateFee, prev.data.affected * 50000)

    // grace larger than any overdue age -> nothing applies
    const graced = await api('POST', '/api/fee-settings/preview', { token: accountant, body: { academicYearId: 'ay-jh-26', branchId: 'br-jh', lateFee: { type: 'fixed', amount: 50000, cap: 0, grace: 9999 } } })
    assert.equal(graced.data.affected, 0)
  })

  await t.test('settings default when none; upsert; teacher denied', async () => {
    const def = (await api('GET', '/api/fee-settings?sessionId=ay-jh-27&branchId=br-jh', { token: accountant })).data
    assert.equal(def._isDefault, true)
    const saved = await api('PUT', '/api/fee-settings', { token: accountant, body: { academicYearId: 'ay-jh-27', branchId: 'br-jh', lateFee: { type: 'percentage', amount: 2, cap: 100000, grace: 3 }, reportEmails: ['x@kidzonia.com'] } })
    assert.equal(saved.status, 200)
    assert.equal(saved.data.lateFee.type, 'percentage')
    const back = (await api('GET', '/api/fee-settings?sessionId=ay-jh-27&branchId=br-jh', { token: accountant })).data
    assert.ok(!back._isDefault)
    assert.equal(back.lateFee.amount, 2)
    const teacher = await login('teacher@kidzonia.com')
    const denied = await api('PUT', '/api/fee-settings', { token: teacher, body: { academicYearId: 'ay-jh-26' } })
    assert.equal(denied.status, 403)
  })

  await t.test('import preview then apply; bad file blocked', async () => {
    // preview a tuition change for stu-6 (Myra, Nursery A, no override yet)
    const prev = await api('POST', '/api/class-fees/import', { token: accountant, body: { classId: 'cls-jh-nursery', sessionId: 'ay-jh-26', commit: false, rows: [{ studentId: 'stu-6', amounts: { 'fh-jh-tuition': 8500 } }] } })
    assert.equal(prev.data.preview, true)
    assert.equal(prev.data.canApply, true)
    assert.equal(prev.data.changes[0].diffs[0].toPaise, 850000)

    // a bad amount blocks apply
    const bad = await api('POST', '/api/class-fees/import', { token: accountant, body: { classId: 'cls-jh-nursery', sessionId: 'ay-jh-26', commit: true, rows: [{ studentId: 'stu-6', amounts: { 'fh-jh-tuition': -5 } }] } })
    assert.equal(bad.data.applied, false)
    assert.ok(bad.data.errors.length > 0)

    // valid apply
    const ok = await api('POST', '/api/class-fees/import', { token: accountant, body: { classId: 'cls-jh-nursery', sessionId: 'ay-jh-26', commit: true, rows: [{ studentId: 'stu-6', amounts: { 'fh-jh-tuition': 8500 } }] } })
    assert.equal(ok.data.applied, true)
    const after = (await api('GET', '/api/student-fees/stu-6?sessionId=ay-jh-26', { token: accountant })).data
    assert.equal(after.effective.find((l) => l.feeHeadId === 'fh-jh-tuition').amount, 850000)
  })
})
