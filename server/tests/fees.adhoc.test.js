import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

const SES = 'ay-jh-26'
const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10)

test('fees: ad-hoc one-off charges', async (t) => {
  await startServer()
  t.after(stopServer)
  const accountant = await login('accounts@kidzonia.com')

  await t.test('seeded ad-hoc renders with per-student summary', async () => {
    const a = (await api('GET', `/api/adhoc-fees?sessionId=${SES}`, { token: accountant })).data.find((x) => x.id === 'adhoc-annualday')
    assert.ok(a)
    assert.equal(a.targeted, 3)
    assert.equal(a.paidCount, 1)
    assert.equal(a.collected, 50000) // one ₹500 paid
  })

  await t.test('create for hand-picked students → invoices flow into Invoices & Dues', async () => {
    const r = await api('POST', '/api/adhoc-fees', { token: accountant, body: { sessionId: SES, title: 'Field trip', amount: 30000, dueDate: future, audience: { type: 'students', ids: ['stu-20', 'stu-21'] } } })
    assert.equal(r.status, 201)
    assert.equal(r.data.invoicesCreated, 2)
    const invs = (await api('GET', '/api/invoices?studentId=stu-20', { token: accountant })).data
    assert.ok(invs.some((i) => i.adhocFeeId === r.data.adhocFee.id && i.lines[0].description === 'Field trip'))
    const detail = (await api('GET', `/api/adhoc-fees/${r.data.adhocFee.id}`, { token: accountant })).data
    assert.equal(detail.students.length, 2)
    assert.ok(detail.students.every((s) => s.status === 'pending'))
  })

  await t.test('group audience targets all group students', async () => {
    const r = await api('POST', '/api/adhoc-fees', { token: accountant, body: { sessionId: SES, title: 'Swim gala', amount: 20000, dueDate: future, audience: { type: 'group', ids: ['grp-swim'] } } })
    assert.equal(r.data.invoicesCreated, 3) // stu-20,21,22
  })

  await t.test('empty audience rejected; front-desk cannot create', async () => {
    const bad = await api('POST', '/api/adhoc-fees', { token: accountant, body: { sessionId: SES, title: 'X', amount: 100, dueDate: future, audience: { type: 'students', ids: [] } } })
    assert.equal(bad.status, 422)
    const front = await login('frontdesk@kidzonia.com')
    const denied = await api('POST', '/api/adhoc-fees', { token: front, body: { sessionId: SES, title: 'Y', amount: 100, dueDate: future, audience: { type: 'class', ids: ['cls-jh-daycare'] } } })
    assert.equal(denied.status, 403)
  })

  await t.test('cancel voids unpaid invoices + reverses ledger; remind hits unpaid', async () => {
    const r = await api('POST', '/api/adhoc-fees', { token: accountant, body: { sessionId: SES, title: 'Picnic', amount: 25000, dueDate: future, audience: { type: 'class', ids: ['cls-jh-daycare'] } } })
    const id = r.data.adhocFee.id
    const rem = await api('POST', `/api/adhoc-fees/${id}/remind`, { token: accountant, body: {} })
    assert.equal(rem.data.sent, r.data.invoicesCreated)
    const cx = await api('POST', `/api/adhoc-fees/${id}/cancel`, { token: accountant, body: { reason: 'called off' } })
    assert.equal(cx.data.cancelledInvoices, r.data.invoicesCreated)
    assert.equal(cx.data.status, 'cancelled')
    const detail = (await api('GET', `/api/adhoc-fees/${id}`, { token: accountant })).data
    assert.ok(detail.students.every((s) => s.status === 'cancelled'))
  })
})
