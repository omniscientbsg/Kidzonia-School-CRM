import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('fees: collect payments (cash/cheque/multi/overpay)', async (t) => {
  await startServer()
  t.after(stopServer)
  const accountant = await login('accounts@kidzonia.com')

  // fresh invoices for stu-24 (Senior KG) so we don't collide with other suites
  const gen = await api('POST', '/api/invoices/generate', { token: accountant, body: { studentId: 'stu-24', feeStructureId: 'fs-jh-srkg', months: ['2099-05', '2099-06'] } })
  assert.equal(gen.status, 201)
  const [inv1, inv2] = gen.data
  const invTotal = inv1.total // tuition+meals+transport in paise

  await t.test('cash part-payment: partial status, receipt, ledger', async () => {
    const r = await api('POST', '/api/payments/collect', { token: accountant, body: { studentId: 'stu-24', mode: 'cash', amount: 500000, allocations: [{ invoiceId: inv1.id, amount: 500000 }] } })
    assert.equal(r.status, 201)
    assert.equal(r.data.payment.status, 'success')
    assert.ok(r.data.receipt.number.startsWith('RCP-JH-'))
    const inv = (await api('GET', `/api/invoices/${inv1.id}`, { token: accountant })).data
    assert.equal(inv.paidAmount, 500000)
    assert.equal(inv.status, 'partial')
    const led = (await api('GET', '/api/students/stu-24/ledger', { token: accountant })).data
    assert.equal(led.at(-1).type, 'payment')
    assert.equal(led.at(-1).amount, -500000)
  })

  await t.test('multi-invoice single payment settles both', async () => {
    const bal1 = invTotal - 500000
    const r = await api('POST', '/api/payments/collect', { token: accountant, body: { studentId: 'stu-24', mode: 'neft', amount: bal1 + invTotal, reference: { utr: 'UTR12345' }, allocations: [{ invoiceId: inv1.id, amount: bal1 }, { invoiceId: inv2.id, amount: invTotal }] } })
    assert.equal(r.status, 201)
    const a = (await api('GET', `/api/invoices/${inv1.id}`, { token: accountant })).data
    const b = (await api('GET', `/api/invoices/${inv2.id}`, { token: accountant })).data
    assert.equal(a.status, 'paid')
    assert.equal(b.status, 'paid')
  })

  await t.test('overpayment becomes an advance/credit on the ledger', async () => {
    const gen2 = await api('POST', '/api/invoices/generate', { token: accountant, body: { studentId: 'stu-24', feeStructureId: 'fs-jh-srkg', months: ['2099-07'] } })
    const inv = gen2.data[0]
    const r = await api('POST', '/api/payments/collect', { token: accountant, body: { studentId: 'stu-24', mode: 'cash', amount: inv.total + 100000, allocations: [{ invoiceId: inv.id, amount: inv.total }] } })
    assert.equal(r.data.advance, 100000)
    const led = (await api('GET', '/api/students/stu-24/ledger', { token: accountant })).data
    assert.ok(led.some((e) => e.type === 'advance' && e.amount === -100000))
  })

  await t.test('cheque: pending_clearance, no balance effect until cleared', async () => {
    const gen3 = await api('POST', '/api/invoices/generate', { token: accountant, body: { studentId: 'stu-24', feeStructureId: 'fs-jh-srkg', months: ['2099-08'] } })
    const inv = gen3.data[0]
    const r = await api('POST', '/api/payments/collect', { token: accountant, body: { studentId: 'stu-24', mode: 'cheque', amount: inv.total, reference: { chequeNo: '000123', bank: 'HDFC' }, allocations: [{ invoiceId: inv.id, amount: inv.total }] } })
    assert.equal(r.data.payment.status, 'pending_clearance')
    assert.equal(r.data.receipt, null)
    // invoice untouched, cheque shows in pending list, not in collections
    let cur = (await api('GET', `/api/invoices/${inv.id}`, { token: accountant })).data
    assert.equal(cur.paidAmount, 0)
    const pend = (await api('GET', '/api/payments/pending-cheques', { token: accountant })).data
    assert.ok(pend.some((p) => p.id === r.data.payment.id))

    // clear -> applied, receipt, invoice paid
    const cl = await api('POST', `/api/payments/${r.data.payment.id}/clear`, { token: accountant, body: {} })
    assert.ok(cl.data.receipt.number)
    cur = (await api('GET', `/api/invoices/${inv.id}`, { token: accountant })).data
    assert.equal(cur.status, 'paid')
    // double clear rejected
    const again = await api('POST', `/api/payments/${r.data.payment.id}/clear`, { token: accountant, body: {} })
    assert.equal(again.status, 409)
  })

  await t.test('bounced cheque has no balance effect', async () => {
    const gen4 = await api('POST', '/api/invoices/generate', { token: accountant, body: { studentId: 'stu-24', feeStructureId: 'fs-jh-srkg', months: ['2099-09'] } })
    const inv = gen4.data[0]
    const r = await api('POST', '/api/payments/collect', { token: accountant, body: { studentId: 'stu-24', mode: 'cheque', amount: inv.total, reference: { chequeNo: '000999' }, allocations: [{ invoiceId: inv.id, amount: inv.total }] } })
    const b = await api('POST', `/api/payments/${r.data.payment.id}/bounce`, { token: accountant, body: { reason: 'insufficient funds' } })
    assert.equal(b.data.status, 'bounced')
    const cur = (await api('GET', `/api/invoices/${inv.id}`, { token: accountant })).data
    assert.equal(cur.paidAmount, 0)
  })

  await t.test('RBAC: front-desk can collect, cannot clear cheques', async () => {
    const front = await login('frontdesk@kidzonia.com')
    const gen5 = await api('POST', '/api/invoices/generate', { token: accountant, body: { studentId: 'stu-24', feeStructureId: 'fs-jh-srkg', months: ['2099-10'] } })
    const inv = gen5.data[0]
    const collect = await api('POST', '/api/payments/collect', { token: front, body: { studentId: 'stu-24', mode: 'cheque', amount: inv.total, allocations: [{ invoiceId: inv.id, amount: inv.total }] } })
    assert.equal(collect.status, 201)
    const clear = await api('POST', `/api/payments/${collect.data.payment.id}/clear`, { token: front, body: {} })
    assert.equal(clear.status, 403)
  })
})
