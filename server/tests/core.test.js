import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('core: auth, rbac, branch scoping', async (t) => {
  await startServer()
  t.after(stopServer)

  await t.test('login succeeds with seeded super admin', async () => {
    const { status, data } = await api('POST', '/api/auth/login', {
      body: { email: 'superadmin@kidzonia.com', password: 'password' },
    })
    assert.equal(status, 200)
    assert.ok(data.token)
    assert.equal(data.user.role, 'super_admin')
    assert.equal(data.user.passwordHash, undefined)
  })

  await t.test('login rejects bad password', async () => {
    const { status } = await api('POST', '/api/auth/login', {
      body: { email: 'superadmin@kidzonia.com', password: 'wrong' },
    })
    assert.equal(status, 401)
  })

  await t.test('super admin sees all branches, branch admin only theirs', async () => {
    const superToken = await login('superadmin@kidzonia.com')
    const principalToken = await login('principal@kidzonia.com')
    const all = await api('GET', '/api/branches', { token: superToken })
    const scoped = await api('GET', '/api/branches', { token: principalToken })
    assert.equal(all.data.length, 2)
    assert.equal(scoped.data.length, 1)
    assert.equal(scoped.data[0].id, 'br-jh')
  })

  await t.test('branch admin class list is branch-filtered', async () => {
    const principalToken = await login('principal@kidzonia.com')
    const { status, data } = await api('GET', '/api/classes', { token: principalToken })
    assert.equal(status, 200)
    assert.ok(data.length > 0)
    assert.ok(data.every((c) => c.branchId === 'br-jh'))
  })

  await t.test('teacher denied settings module', async () => {
    const teacherToken = await login('teacher@kidzonia.com')
    const { status } = await api('GET', '/api/users', { token: teacherToken })
    assert.equal(status, 403)
  })

  await t.test('parent denied staff routes entirely', async () => {
    const parentToken = await login('parent@kidzonia.com')
    const { status } = await api('GET', '/api/classes', { token: parentToken })
    assert.equal(status, 403)
  })

  await t.test('unauthenticated request rejected', async () => {
    const { status } = await api('GET', '/api/classes')
    assert.equal(status, 401)
  })
})
