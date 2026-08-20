import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

const SES = 'ay-jh-26'
const CLS = 'cls-jh-srkg' // Senior KG — 5 students, untouched by promotion tests

test('fees ops: generation + approval', async (t) => {
  await startServer()
  t.after(stopServer)
  const accountant = await login('accounts@kidzonia.com')

  await t.test('preview + idempotent commit (Aug–Sep monthly cycles)', async () => {
    const prev = await api('POST', '/api/fee-generation/preview', { token: accountant, body: { sessionId: SES, classIds: [CLS], startMonth: '2026-08', endMonth: '2026-09' } })
    assert.equal(prev.status, 200)
    assert.equal(prev.data.students, 5)
    assert.equal(prev.data.willCreate, 10) // 5 students × 2 months (monthly heads only)
    assert.equal(prev.data.duplicates, 0)

    const c1 = await api('POST', '/api/fee-generation/commit', { token: accountant, body: { sessionId: SES, classIds: [CLS], startMonth: '2026-08', endMonth: '2026-09' } })
    assert.equal(c1.data.created, 10)
    // re-run: everything skipped, no double charge
    const c2 = await api('POST', '/api/fee-generation/commit', { token: accountant, body: { sessionId: SES, classIds: [CLS], startMonth: '2026-08', endMonth: '2026-09' } })
    assert.equal(c2.data.created, 0)
    assert.equal(c2.data.skipped, 10)
  })

  await t.test('periodicity: one-time + annual heads only in the admission/start month', async () => {
    await api('POST', '/api/fee-generation/commit', { token: accountant, body: { sessionId: SES, classIds: [CLS], startMonth: '2026-06', endMonth: '2026-06' } })
    const cycles = (await api('GET', `/api/fee-cycles?academicYearId=${SES}&classId=${CLS}`, { token: accountant })).data
    const june = cycles.find((c) => c.cycleKey === '2026-06')
    const aug = cycles.find((c) => c.cycleKey === '2026-08')
    // June (session start) includes admission + deposit (one-time) + activity (annual)
    assert.ok(june.lines.some((l) => l.feeHeadId === 'fh-jh-admission'))
    assert.ok(june.lines.some((l) => l.feeHeadId === 'fh-jh-activity'))
    assert.equal(june.lines.length, 6)
    // August is monthly-only
    assert.equal(aug.lines.length, 3)
    assert.ok(!aug.lines.some((l) => l.feeHeadId === 'fh-jh-admission'))
  })

  await t.test('group charge lands on the billed head', async () => {
    const cycles = (await api('GET', `/api/fee-cycles?academicYearId=${SES}&classId=${CLS}&studentId=stu-20`, { token: accountant })).data
    const june = cycles.find((c) => c.cycleKey === '2026-06')
    const act = june.lines.find((l) => l.feeHeadId === 'fh-jh-activity')
    assert.equal(act.groupCharge, 100000) // Swim Batch +₹1000
    assert.equal(act.amount, act.base + 100000)
  })

  let approveIds, paidCycleId
  await t.test('approve turns estimate into invoice + ledger; no double approve', async () => {
    const est = (await api('GET', `/api/fee-cycles?academicYearId=${SES}&classId=${CLS}&status=estimated`, { token: accountant })).data
    approveIds = est.slice(0, 2).map((c) => c.id)
    paidCycleId = est.find((c) => c.cycleKey === '2026-08').id

    const r = await api('POST', '/api/fee-cycles/approve', { token: accountant, body: { cycleIds: approveIds } })
    assert.equal(r.data.approved.length, 2)
    const inv = await api('GET', `/api/invoices?studentId=${est[0].studentId}`, { token: accountant })
    assert.ok(inv.data.some((i) => i.number === r.data.approved[0].number))
    // double approve -> skipped
    const again = await api('POST', '/api/fee-cycles/approve', { token: accountant, body: { cycleIds: approveIds } })
    assert.equal(again.data.approved.length, 0)
    assert.match(again.data.skipped[0].reason, /already/)
  })

  await t.test('cancel estimated works; cancelling a paid invoice is blocked', async () => {
    const est = (await api('GET', `/api/fee-cycles?academicYearId=${SES}&classId=${CLS}&status=estimated`, { token: accountant })).data
    const toCancel = est[0].id
    const cx = await api('POST', '/api/fee-cycles/cancel', { token: accountant, body: { cycleIds: [toCancel], reason: 'duplicate' } })
    assert.equal(cx.data.cancelled.length, 1)

    // approve the paid cycle, pay it, then try to cancel -> blocked
    await api('POST', '/api/fee-cycles/approve', { token: accountant, body: { cycleIds: [paidCycleId] } })
    const cyc = (await api('GET', `/api/fee-cycles?academicYearId=${SES}&classId=${CLS}`, { token: accountant })).data.find((c) => c.id === paidCycleId)
    await api('POST', '/api/payments/offline', { token: accountant, body: { invoiceId: cyc.invoiceId, amount: 10000, mode: 'cash' } })
    const blocked = await api('POST', '/api/fee-cycles/cancel', { token: accountant, body: { cycleIds: [paidCycleId], reason: 'oops' } })
    assert.equal(blocked.data.cancelled.length, 0)
    assert.match(blocked.data.blocked[0].reason, /payment/)
  })

  await t.test('RBAC: front-desk cannot commit; teacher cannot preview-write', async () => {
    const front = await login('frontdesk@kidzonia.com')
    const r = await api('POST', '/api/fee-generation/commit', { token: front, body: { sessionId: SES, classIds: [CLS], startMonth: '2026-10', endMonth: '2026-10' } })
    assert.equal(r.status, 403) // fees.edit denied for front_desk
    const teacher = await login('teacher@kidzonia.com')
    const p = await api('POST', '/api/fee-generation/preview', { token: teacher, body: { sessionId: SES, classIds: [CLS], startMonth: '2026-10', endMonth: '2026-10' } })
    assert.equal(p.status, 403)
  })
})
