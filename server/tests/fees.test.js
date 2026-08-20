import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('fees: flow 3 — invoice → gateway payment → receipt → ledger', async (t) => {
  await startServer()
  t.after(stopServer)
  const accountant = await login('accounts@kidzonia.com')
  // stu-7 (Advait Rao, Nursery B) has no seeded invoices; guardian is parent7@example.com? — resolve via roster: fam seq for Rao
  // safer: generate for stu-25 (Amaira Sood, Playgroup A) and pay as her guardian

  let invoice
  await t.test('accountant generates a monthly invoice', async () => {
    const { status, data } = await api('POST', '/api/invoices/generate', {
      token: accountant,
      body: { studentId: 'stu-25', feeStructureId: 'fs-jh-playgroup', months: ['2099-04'] },
    })
    assert.equal(status, 201)
    assert.equal(data.length, 1)
    invoice = data[0]
    assert.ok(invoice.number.startsWith('INV-JH-'))
    assert.equal(invoice.total, (8000 + 1500 + 2000) * 100) // tuition + meals + transport, in paise
  })

  let gatewayRef
  await t.test('parent initiates gateway payment for own child only', async () => {
    // find Amaira's guardian login: family of stu-25
    const parentEmailProbe = await api('GET', `/api/students/stu-25/full`, { token: accountant })
    const email = parentEmailProbe.data.guardians[0].email
    const parentToken = await login(email)
    const init = await api('POST', '/api/payments/initiate', { token: parentToken, body: { invoiceId: invoice.id } })
    assert.equal(init.status, 201)
    assert.equal(init.data.amount, invoice.total)
    gatewayRef = init.data.gatewayRef

    // a different parent cannot initiate on this invoice
    const stranger = await login('parent@kidzonia.com')
    const forbidden = await api('POST', '/api/payments/initiate', { token: stranger, body: { invoiceId: invoice.id } })
    assert.equal(forbidden.status, 403)
  })

  await t.test('webhook settles payment: receipt, invoice paid, ledger updated', async () => {
    const hook = await api('POST', '/api/payments/webhook', { body: { gatewayRef, status: 'success' } })
    assert.equal(hook.status, 200)
    assert.ok(hook.data.receipt.startsWith('RCP-JH-'))

    const inv = await api('GET', `/api/invoices/${invoice.id}`, { token: accountant })
    assert.equal(inv.data.status, 'paid')
    assert.equal(inv.data.paidAmount, invoice.total)

    const ledger = await api('GET', '/api/students/stu-25/ledger', { token: accountant })
    const last = ledger.data.at(-1)
    assert.equal(last.type, 'payment')
    assert.equal(last.amount, -invoice.total)
  })

  await t.test('webhook replay is idempotent — no duplicate receipt or ledger entry', async () => {
    const before = await api('GET', '/api/students/stu-25/ledger', { token: accountant })
    const replay = await api('POST', '/api/payments/webhook', { body: { gatewayRef, status: 'success' } })
    assert.equal(replay.data.alreadySettled, true)
    const after = await api('GET', '/api/students/stu-25/ledger', { token: accountant })
    assert.equal(after.data.length, before.data.length)
  })

  await t.test('payment appears in the day-book', async () => {
    const { data } = await api('GET', '/api/fees/reports/daybook', { token: accountant })
    assert.ok(data.rows.some((r) => r.invoiceNumber === invoice.number))
    assert.ok(data.total >= invoice.total)
  })

  await t.test('approved discount reduces an unpaid invoice and hits the ledger', async () => {
    const gen = await api('POST', '/api/invoices/generate', {
      token: accountant,
      body: { studentId: 'stu-25', feeStructureId: 'fs-jh-playgroup', months: ['2099-05'] },
    })
    const inv2 = gen.data[0]
    const disc = await api('POST', '/api/discounts', {
      token: accountant,
      body: { studentId: 'stu-25', invoiceId: inv2.id, name: 'Promo 1000', amount: 1000, reason: 'Referral promo' },
    })
    const approved = await api('POST', `/api/discounts/${disc.data.id}/decide`, { token: accountant, body: { status: 'approved' } })
    assert.equal(approved.data.status, 'approved')
    const check = await api('GET', `/api/invoices/${inv2.id}`, { token: accountant })
    assert.equal(check.data.total, inv2.total - 1000)
    assert.equal(check.data.discountTotal, 1000)
  })

  await t.test('fee reminders notify guardians of open invoices', async () => {
    const { status, data } = await api('POST', '/api/fees/send-reminders', { token: accountant })
    assert.equal(status, 200)
    assert.ok(data.sent > 0)
  })

  await t.test('outstanding report aggregates per student', async () => {
    const { data } = await api('GET', '/api/fees/reports/outstanding', { token: accountant })
    assert.ok(data.totalDue > 0)
    assert.ok(data.rows.every((r) => r.due > 0))
  })
})
