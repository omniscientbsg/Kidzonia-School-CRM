import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('user master: one identity table, imported not re-registered', async (t) => {
  await startServer()
  t.after(stopServer)

  const meera = await login('superadmin@kidzonia.com')
  const lakshmi = await login('principal@kidzonia.com')

  await t.test('both creation doors produce the same shape of user', async () => {
    const viaSetup = await api('POST', '/api/staff', {
      token: meera,
      body: { name: 'Test ViaSetup', username: 'via.setup', role: 'teacher', branchId: 'br-jh', designation: 'Class Teacher' },
    })
    const viaSettings = await api('POST', '/api/users', {
      token: meera,
      body: { name: 'Test ViaSettings', email: 'via.settings@kidzonia.com', password: 'password', role: 'teacher', branchId: 'br-jh' },
    })
    assert.equal(viaSetup.status, 201)
    assert.equal(viaSettings.status, 201)

    // the Settings door used to skip these, which broke username login
    for (const u of [viaSetup.data, viaSettings.data]) {
      assert.ok(u.username, 'username missing')
      assert.ok(u.employeeId, 'employeeId missing')
      assert.equal(u.passwordHash, undefined)          // never leaked
    }
    // and the user created through Settings can actually log in by username
    const token = await login('via.settings')
    assert.ok(token)
  })

  await t.test('the master refuses duplicates from either door', async () => {
    const dupe = await api('POST', '/api/staff', {
      token: meera,
      body: { name: 'Clash', username: 'via.settings', role: 'teacher' },
    })
    assert.equal(dupe.status, 422)
    assert.match(dupe.data.error, /already in the user master/)

    const dupe2 = await api('POST', '/api/users', {
      token: meera,
      body: { name: 'Clash 2', email: 'via.setup@kidzonia.com', password: 'password', role: 'teacher' },
    })
    assert.equal(dupe2.status, 422)
  })

  await t.test('new staff are flagged as missing from the org chart', async () => {
    const { status, data } = await api('GET', '/api/org/unplaced-staff', { token: meera })
    assert.equal(status, 200)
    const names = data.map((u) => u.name)
    assert.ok(names.includes('Test ViaSetup'))
    assert.ok(names.includes('Test ViaSettings'))
    assert.ok(!names.includes('Anjali Rao'))          // already placed
  })

  await t.test('import places existing users — no second account is created', async () => {
    const before = (await api('GET', '/api/staff', { token: meera })).data.length
    const unplaced = (await api('GET', '/api/org/unplaced-staff', { token: lakshmi })).data
    const ids = unplaced.filter((u) => u.name.startsWith('Test Via')).map((u) => u.id)
    assert.equal(ids.length, 2)

    const res = await api('POST', '/api/org/positions/import', {
      token: lakshmi,
      body: { userIds: ids, nodeId: 'node-sch-jh', levelId: 'lvl-teacher' },
    })
    assert.equal(res.status, 201)
    assert.equal(res.data.placed, 2)
    assert.ok(res.data.created.every((p) => p.tier === 'Teacher' && p.nodeName === 'Kidzonia Jubilee Hills'))

    // the user master did not grow — the same people, now with a reporting line
    const after = (await api('GET', '/api/staff', { token: meera })).data.length
    assert.equal(after, before)

    // and they are immediately assignable
    const downline = (await api('GET', '/api/org/downline', { token: lakshmi })).data
    assert.ok(ids.every((id) => downline.some((p) => p.userId === id)))
    assert.equal((await api('GET', '/api/org/unplaced-staff', { token: meera })).data.filter((u) => ids.includes(u.id)).length, 0)
  })

  await t.test('importing twice is harmless, and the tree still bounds it', async () => {
    const ids = (await api('GET', '/api/org/positions?nodeId=node-sch-jh', { token: meera })).data
      .filter((p) => p.userName.startsWith('Test Via')).map((p) => p.userId)
    const again = await api('POST', '/api/org/positions/import', {
      token: lakshmi,
      body: { userIds: ids, nodeId: 'node-sch-jh', levelId: 'lvl-teacher' },
    })
    assert.equal(again.data.placed, 0)
    assert.ok(again.data.skipped.every((s) => s.reason === 'already_placed_here'))

    // a teacher cannot import anyone, and nobody can import above their own level
    const anjali = await login('teacher@kidzonia.com')
    const byTeacher = await api('POST', '/api/org/positions/import', {
      token: anjali, body: { userIds: ids, nodeId: 'node-sch-jh', levelId: 'lvl-teacher' },
    })
    assert.equal(byTeacher.status, 403)

    const upward = await api('POST', '/api/org/positions/import', {
      token: lakshmi, body: { userIds: ids, nodeId: 'node-sch-jh', levelId: 'lvl-principal' },
    })
    assert.equal(upward.status, 403)
  })

  await t.test('the import is audited per person', async () => {
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    const rows = audit.filter((a) => a.action === 'org.position.import')
    assert.equal(rows.length, 2)
    assert.ok(rows.every((r) => /Imported Test Via/.test(r.reason)))
    assert.ok(rows.every((r) => r.positionId === 'pos-lakshmi'))
  })
})
