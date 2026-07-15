import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('crm: lead lifecycle', async (t) => {
  await startServer()
  t.after(stopServer)
  const token = await login('frontdesk@kidzonia.com')

  let leadId

  await t.test('walk-in lead captured with minimal fields', async () => {
    const { status, data } = await api('POST', '/api/leads', {
      token,
      body: {
        childName: 'Test Child',
        childDob: '2023-01-15',
        programId: 'prog-jh-nursery',
        parentName: 'Test Parent',
        phone: '+91 9000000001',
        email: 'testparent@example.com',
        source: 'walk_in',
      },
    })
    assert.equal(status, 201)
    assert.equal(data.stage, 'new')
    assert.equal(data.branchId, 'br-jh')
    leadId = data.id
  })

  await t.test('duplicate detection finds the lead by phone', async () => {
    const { data } = await api('GET', '/api/leads/check-duplicate?phone=%2B91%209000000001', { token })
    assert.ok(data.duplicates.some((l) => l.id === leadId))
  })

  await t.test('stage change to lost requires a reason', async () => {
    const bad = await api('POST', `/api/leads/${leadId}/stage`, { token, body: { stage: 'lost' } })
    assert.equal(bad.status, 400)
    const ok = await api('POST', `/api/leads/${leadId}/stage`, { token, body: { stage: 'visited' } })
    assert.equal(ok.status, 200)
    assert.equal(ok.data.stage, 'visited')
  })

  await t.test('convert creates application with copied data, no retyping', async () => {
    const { status, data } = await api('POST', `/api/leads/${leadId}/convert`, { token, body: {} })
    assert.equal(status, 201)
    assert.equal(data.application.childName, 'Test Child')
    assert.equal(data.application.guardiansDraft[0].phone, '+91 9000000001')
    assert.equal(data.application.programId, 'prog-jh-nursery')
    assert.equal(data.lead.stage, 'converted')
    assert.equal(data.lead.convertedApplicationId, data.application.id)
  })

  await t.test('second convert is rejected', async () => {
    const { status } = await api('POST', `/api/leads/${leadId}/convert`, { token, body: {} })
    assert.equal(status, 409)
  })

  await t.test('activity timeline recorded the journey', async () => {
    const { data } = await api('GET', `/api/leads/${leadId}/activities`, { token })
    const notes = data.map((a) => a.note).join(' | ')
    assert.ok(notes.includes('new → visited'))
    assert.ok(notes.includes('Converted to application'))
  })

  await t.test('analytics counts stages and counsellor conversion', async () => {
    const { data } = await api('GET', '/api/crm/analytics', { token })
    assert.ok(data.total > 0)
    assert.ok(data.byStage.converted >= 1)
    assert.ok(Array.isArray(data.counsellors))
  })
})
