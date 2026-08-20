import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('fees: pending dues + reminders', async (t) => {
  await startServer()
  t.after(stopServer)
  const accountant = await login('accounts@kidzonia.com')

  await t.test('pending-dues totals match the Outstanding report (cards consistency)', async () => {
    const dues = (await api('GET', '/api/fees/pending-dues', { token: accountant })).data
    const out = (await api('GET', '/api/fees/reports/outstanding', { token: accountant })).data
    assert.equal(dues.summary.totalDue, out.totalDue)
    assert.equal(dues.summary.totalOverdue, out.totalOverdue)
    assert.equal(dues.summary.families, out.rows.length)
    assert.ok(dues.rows.every((r) => r.balance > 0 && ['pending', 'partial', 'overdue'].includes(r.status)))
    assert.ok(dues.rows.every((r) => typeof r.cycleLabel === 'string' && typeof r.daysOverdue === 'number'))
  })

  await t.test('filters: overdue-only + amount threshold', async () => {
    const od = (await api('GET', '/api/fees/pending-dues?overdueOnly=true', { token: accountant })).data
    assert.ok(od.rows.every((r) => r.status === 'overdue'))
    const all = (await api('GET', '/api/fees/pending-dues', { token: accountant })).data
    const big = (await api('GET', '/api/fees/pending-dues?minAmount=100000000', { token: accountant })).data
    assert.ok(big.rows.length <= all.rows.length)
  })

  await t.test('send reminders stamps lastReminderAt + reminderCount; not-reminded filter respects it', async () => {
    const before = (await api('GET', '/api/fees/pending-dues', { token: accountant })).data
    const target = before.rows[0]
    assert.equal(target.reminderCount, 0)
    const r = await api('POST', '/api/fees/reminders/send', { token: accountant, body: { invoiceIds: [target.invoiceId] } })
    assert.equal(r.status, 200)
    assert.equal(r.data.sent, 1)
    assert.ok(r.data.perInvoice[0].channels.length > 0)

    const after = (await api('GET', '/api/fees/pending-dues', { token: accountant })).data
    const t2 = after.rows.find((x) => x.invoiceId === target.invoiceId)
    assert.equal(t2.reminderCount, 1)
    assert.ok(t2.lastReminderAt)
    // "not reminded in last 5 days" now excludes the just-reminded invoice
    const stale = (await api('GET', '/api/fees/pending-dues?notRemindedDays=5', { token: accountant })).data
    assert.ok(!stale.rows.some((x) => x.invoiceId === target.invoiceId))
  })

  await t.test('RBAC: teacher denied; front-desk can view but not send', async () => {
    const teacher = await login('teacher@kidzonia.com')
    assert.equal((await api('GET', '/api/fees/pending-dues', { token: teacher })).status, 403)
    const front = await login('frontdesk@kidzonia.com')
    assert.equal((await api('GET', '/api/fees/pending-dues', { token: front })).status, 200)
    assert.equal((await api('POST', '/api/fees/reminders/send', { token: front, body: { invoiceIds: [] } })).status, 403)
  })
})
