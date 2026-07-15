import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, getBaseUrl } from './helpers.js'

async function uploadMedia(token, { name, studentIds }) {
  const fd = new FormData()
  fd.append('file', new Blob([Buffer.from('fake image bytes')], { type: 'image/png' }), name)
  if (studentIds) fd.append('studentIds', JSON.stringify(studentIds))
  const res = await fetch(`${getBaseUrl()}/api/media`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: fd,
  })
  return { status: res.status, data: await res.json() }
}

async function fetchMediaFile(token, mediaId) {
  const res = await fetch(`${getBaseUrl()}/api/media/${mediaId}/file`, {
    headers: { authorization: `Bearer ${token}` },
  })
  return res.status
}

test('daily: flow 4 — diary feed, daily logs, consent-gated media', async (t) => {
  await startServer()
  t.after(stopServer)
  const teacher = await login('teacher@kidzonia.com')
  const priya = await login('parent@kidzonia.com') // Aarav (stu-1, Nursery A) — consent granted
  const patelParent = await login('parent5@example.com') // Arjun Patel (stu-5) — consent REVOKED in seed

  let classPost, taggedMedia, taggedPost

  await t.test('teacher posts a class update with an uploaded photo', async () => {
    const up = await uploadMedia(teacher, { name: 'splash.png' })
    assert.equal(up.status, 201)
    const post = await api('POST', '/api/diary-posts', {
      token: teacher,
      body: { sectionId: 'sec-jh-nursery-a', text: 'Splash table experiments today!', mediaIds: [up.data.id] },
    })
    assert.equal(post.status, 201)
    classPost = post.data
  })

  await t.test('teacher posts a child-tagged photo for Arjun (consent revoked)', async () => {
    const up = await uploadMedia(teacher, { name: 'arjun.png', studentIds: ['stu-5'] })
    taggedMedia = up.data
    const post = await api('POST', '/api/diary-posts', {
      token: teacher,
      body: { sectionId: 'sec-jh-nursery-a', studentIds: ['stu-5'], text: 'Arjun painted a rainbow!', mediaIds: [taggedMedia.id] },
    })
    taggedPost = post.data
    assert.equal(post.status, 201)
  })

  await t.test('consented parent sees class post and today\'s meal/nap logs, can comment', async () => {
    const feed = await api('GET', '/api/parent/feed', { token: priya })
    assert.ok(feed.data.some((p) => p.id === classPost.id))
    // tagged post for another child is NOT in Priya's feed
    assert.ok(!feed.data.some((p) => p.id === taggedPost.id))

    const today = await api('GET', '/api/parent/children/stu-1/today', { token: priya })
    const types = today.data.logs.map((l) => l.type)
    assert.ok(types.includes('meal') && types.includes('nap'))
    assert.ok(today.data.checkInOut?.inAt)

    const comment = await api('POST', `/api/diary-posts/${classPost.id}/comments`, {
      token: priya, body: { text: 'Looks like so much fun!' },
    })
    assert.equal(comment.status, 201)
  })

  await t.test('class (untagged) media is viewable by parents', async () => {
    const status = await fetchMediaFile(priya, classPost.mediaIds[0])
    assert.equal(status, 200)
  })

  await t.test('revoked consent blocks the tagged media file, not the post', async () => {
    const feed = await api('GET', '/api/parent/feed', { token: patelParent })
    assert.ok(feed.data.some((p) => p.id === taggedPost.id))
    const status = await fetchMediaFile(patelParent, taggedMedia.id)
    assert.equal(status, 403)
  })

  await t.test('parent can flip consent back on and media unlocks', async () => {
    const consents = await api('GET', '/api/parent/consents', { token: patelParent })
    const c = consents.data.find((x) => x.studentId === 'stu-5')
    assert.equal(c.granted, false)
    await api('PUT', `/api/parent/consents/${c.id}`, { token: patelParent, body: { granted: true } })
    const status = await fetchMediaFile(patelParent, taggedMedia.id)
    assert.equal(status, 200)
  })

  await t.test('another family\'s parent cannot open the tagged media', async () => {
    const status = await fetchMediaFile(priya, taggedMedia.id)
    assert.equal(status, 403)
  })

  await t.test('check-in/out notifies guardians', async () => {
    const out = await api('POST', '/api/check-in-out', {
      token: teacher, body: { studentId: 'stu-1', action: 'out', pickupPerson: 'Priya Sharma' },
    })
    assert.equal(out.status, 200)
    assert.ok(out.data.outAt)
    const notifs = await api('GET', '/api/notifications', { token: priya })
    assert.ok(notifs.data.some((n) => n.title.includes('checked out')))
  })
})
