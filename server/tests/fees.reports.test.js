import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('fees reports: ledger / transactions / detailed / series', async (t) => {
  await startServer()
  t.after(stopServer)
  const accountant = await login('accounts@kidzonia.com')

  await t.test('student ledger has a consistent running balance', async () => {
    const r = await api('GET', '/api/fees/reports/student-ledger?studentId=stu-1', { token: accountant })
    assert.equal(r.status, 200)
    assert.ok(r.data.rows.length > 0)
    let bal = 0
    for (const e of r.data.rows) { bal += e.amount; assert.equal(e.balanceAfter, bal) }
    assert.equal(r.data.closingBalance, bal)
    assert.ok(r.data.rows.every((e) => typeof e.description === 'string'))
  })

  await t.test('transactions filter by mode + status; date-type switch', async () => {
    const all = (await api('GET', '/api/fees/reports/transactions', { token: accountant })).data
    assert.ok(all.rows.length > 0)
    assert.ok(all.rows.every((r) => r.statusLabel))
    const cash = (await api('GET', '/api/fees/reports/transactions?mode=cash', { token: accountant })).data
    assert.ok(cash.rows.every((r) => r.mode === 'cash'))
    const completed = (await api('GET', '/api/fees/reports/transactions?status=success', { token: accountant })).data
    assert.ok(completed.rows.every((r) => r.status === 'success'))
    // clearance date-type: rows carry a clearanceDate for cleared payments
    const byClear = (await api('GET', '/api/fees/reports/transactions?dateType=clearance', { token: accountant })).data
    assert.ok(byClear.rows.length > 0)
  })

  await t.test('detailed report reconciles paid with invoice paidAmount', async () => {
    const invoices = (await api('GET', '/api/invoices', { token: accountant })).data
    const paidSum = invoices.reduce((s, i) => s + i.paidAmount, 0)
    const det = (await api('GET', '/api/fees/reports/detailed?showCancelled=true', { token: accountant })).data
    assert.equal(det.summary.totalPaid, paidSum)
    assert.equal(det.summary.recordCount, det.rows.length)
    assert.ok(det.summary.totalFees >= det.summary.totalPaid)
    // status filter works
    const paid = (await api('GET', '/api/fees/reports/detailed?status=paid', { token: accountant })).data
    assert.ok(paid.rows.every((r) => r.status === 'paid'))
    // show-cancelled toggles record count
    const noCancel = (await api('GET', '/api/fees/reports/detailed', { token: accountant })).data
    assert.ok(noCancel.rows.every((r) => r.status !== 'cancelled'))
  })

  await t.test('collections series is sorted daily buckets', async () => {
    const s = (await api('GET', '/api/fees/reports/collections-series?from=0000-00-00&to=9999-99-99', { token: accountant })).data
    assert.ok(Array.isArray(s.series))
    for (let i = 1; i < s.series.length; i++) assert.ok(s.series[i].date >= s.series[i - 1].date)
    assert.ok(s.series.every((p) => p.amount > 0))
  })

  await t.test('teacher denied fee reports', async () => {
    const teacher = await login('teacher@kidzonia.com')
    assert.equal((await api('GET', '/api/fees/reports/detailed', { token: teacher })).status, 403)
  })
})
