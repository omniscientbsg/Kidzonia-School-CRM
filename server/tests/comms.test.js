import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('comms: announcements, chat, events, worksheets, dashboards', async (t) => {
  await startServer()
  t.after(stopServer)
  const principal = await login('principal@kidzonia.com')
  const teacher = await login('teacher@kidzonia.com')
  const nurseryParent = await login('parent2@example.com') // Vihaan Reddy — Nursery A only
  const jrkgParent = await login('parent15@example.com') // Kabir Bose — Jr. KG B only

  await t.test('class-targeted announcement reaches exactly that class', async () => {
    const { status, data } = await api('POST', '/api/announcements', {
      token: principal,
      body: {
        title: 'Nursery A picnic', body: 'Pack a cap and water bottle on Friday!',
        audience: { type: 'class', ids: ['sec-jh-nursery-a'] }, requiresAck: true,
      },
    })
    assert.equal(status, 201)
    assert.ok(data.recipients > 0)

    const inFeed = await api('GET', '/api/parent/announcements', { token: nurseryParent })
    assert.ok(inFeed.data.some((a) => a.title === 'Nursery A picnic'))
    const notInFeed = await api('GET', '/api/parent/announcements', { token: jrkgParent })
    assert.ok(!notInFeed.data.some((a) => a.title === 'Nursery A picnic'))

    const notif = await api('GET', '/api/notifications', { token: nurseryParent })
    assert.ok(notif.data.some((n) => n.title.includes('Nursery A picnic')))
  })

  await t.test('parent acknowledges an announcement and stats reflect it', async () => {
    const feed = await api('GET', '/api/parent/announcements', { token: nurseryParent })
    const ann = feed.data.find((a) => a.title === 'Nursery A picnic')
    await api('POST', `/api/announcements/${ann.id}/ack`, { token: nurseryParent })
    const stats = await api('GET', `/api/announcements/${ann.id}/stats`, { token: principal })
    assert.equal(stats.data.acknowledged, 1)
  })

  await t.test('parent chat: find-or-create thread, teacher unread increments', async () => {
    const thread = await api('POST', '/api/chat/threads', {
      token: nurseryParent, body: { studentId: 'stu-2', type: 'parent_teacher' },
    })
    assert.ok([200, 201].includes(thread.status))
    await api('POST', `/api/chat/threads/${thread.data.id}/messages`, {
      token: nurseryParent, body: { text: 'Vihaan forgot his water bottle today' },
    })
    const teacherThreads = await api('GET', '/api/chat/threads', { token: teacher })
    const th = teacherThreads.data.find((x) => x.id === thread.data.id)
    assert.ok(th.unreadCount >= 1)
    // reading clears unread
    await api('GET', `/api/chat/threads/${thread.data.id}/messages`, { token: teacher })
    const after = await api('GET', '/api/chat/threads', { token: teacher })
    assert.equal(after.data.find((x) => x.id === thread.data.id).unreadCount, 0)
  })

  await t.test('parent RSVPs to a PTM event', async () => {
    const events = await api('GET', '/api/parent/events', { token: nurseryParent })
    const ptm = events.data.find((e) => e.type === 'ptm')
    const rsvp = await api('POST', `/api/events/${ptm.id}/rsvp`, { token: nurseryParent, body: { response: 'yes' } })
    assert.equal(rsvp.status, 200)
    const counts = await api('GET', `/api/events/${ptm.id}/rsvps`, { token: principal })
    assert.ok(counts.data.counts.yes >= 1)
  })

  await t.test('worksheets respect audience targeting', async () => {
    const nursery = await api('GET', '/api/parent/worksheets', { token: nurseryParent })
    const titles = nursery.data.map((w) => w.title)
    assert.ok(titles.includes('Tracing practice A–E')) // class-targeted at nursery
    assert.ok(titles.includes('Count the mangoes')) // branch-wide

    const jrkg = await api('GET', '/api/parent/worksheets', { token: jrkgParent })
    const jrkgTitles = jrkg.data.map((w) => w.title)
    assert.ok(!jrkgTitles.includes('Tracing practice A–E'))
    assert.ok(jrkgTitles.includes('Count the mangoes'))
  })

  await t.test('dashboards are role-shaped', async () => {
    const p = await api('GET', '/api/dashboards/summary', { token: principal })
    assert.equal(p.data.role, 'branch_admin')
    assert.ok(p.data.activeStudents > 0)
    assert.ok(Array.isArray(p.data.occupancy))
    assert.ok(p.data.fees.due >= 0)

    const tch = await api('GET', '/api/dashboards/summary', { token: teacher })
    assert.ok(tch.data.sections.some((s) => s.name.includes('Nursery')))

    const hq = await api('GET', '/api/dashboards/summary', { token: await login('superadmin@kidzonia.com') })
    assert.equal(hq.data.branches.length, 2)
  })
})
