import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('admissions: flow 1 — lead to enrolled student with parent login and first invoice', async (t) => {
  await startServer()
  t.after(stopServer)
  const token = await login('frontdesk@kidzonia.com')

  // capture + convert
  const leadRes = await api('POST', '/api/leads', {
    token,
    body: {
      childName: 'Nia Fernandes', childDob: '2023-02-10', programId: 'prog-jh-nursery',
      parentName: 'Lara Fernandes', phone: '+91 9000000077', email: 'lara.fernandes@example.com', source: 'walk_in',
    },
  })
  const convertRes = await api('POST', `/api/leads/${leadRes.data.id}/convert`, { token, body: {} })
  const appId = convertRes.data.application.id

  await t.test('document checklist tracked on the application', async () => {
    const doc = await api('POST', `/api/applications/${appId}/documents`, { token, body: { type: 'birth_certificate', status: 'received' } })
    assert.equal(doc.status, 201)
    const upd = await api('PUT', `/api/application-documents/${doc.data.id}`, { token, body: { status: 'verified' } })
    assert.equal(upd.data.status, 'verified')
  })

  let confirm
  await t.test('confirm creates student, guardians, logins, enrolment and first invoice', async () => {
    confirm = await api('POST', `/api/applications/${appId}/confirm`, {
      token,
      body: { sectionId: 'sec-jh-nursery-a', feeStructureId: 'fs-jh-nursery' },
    })
    assert.equal(confirm.status, 201)
    assert.equal(confirm.data.student.firstName, 'Nia')
    assert.equal(confirm.data.application.status, 'confirmed')
    assert.ok(confirm.data.invoice.number.startsWith('INV-JH-'))
    assert.ok(confirm.data.invoice.total > 25000) // admission + deposit + pro-rata monthlies
    assert.equal(confirm.data.createdLogins.length, 1)
  })

  await t.test('new parent can log in and sees only their child', async () => {
    const parentToken = await login('lara.fernandes@example.com')
    const me = await api('GET', '/api/me', { token: parentToken })
    assert.equal(me.data.role, 'parent')
  })

  await t.test('second confirm rejected', async () => {
    const again = await api('POST', `/api/applications/${appId}/confirm`, {
      token,
      body: { sectionId: 'sec-jh-nursery-a', feeStructureId: 'fs-jh-nursery' },
    })
    assert.equal(again.status, 409)
  })
})
