import test from 'node:test'
import assert from 'node:assert'
import { startServer, stopServer, api, login } from './helpers.js'

test.before(startServer)
test.after(stopServer)

test('End-to-end school workflow', async (t) => {
  let superToken, parentToken
  let studentId, branchId, programId, classId, sectionId
  let teacherId, headId, structureId
  let appId

  await t.test('1. Setup basic structural data', async () => {
    superToken = await login('superadmin@kidzonia.com')
    assert.ok(superToken, 'Super admin should log in')

    const bRes = await api('POST', '/api/branches', { token: superToken, body: { name: 'Main Campus', code: 'MAIN', address: '123 Main St' } })
    assert.equal(bRes.status, 201)
    branchId = bRes.data.id

    const pRes = await api('POST', '/api/programs', { token: superToken, body: { name: 'Kindergarten' } })
    assert.equal(pRes.status, 201)
    programId = pRes.data.id

    const cRes = await api('POST', '/api/classes', { token: superToken, body: { name: 'LKG', programId, capacity: 30 } })
    assert.equal(cRes.status, 201)
    classId = cRes.data.id

    const uRes = await api('POST', '/api/users', { token: superToken, body: { name: 'Jane Teacher', email: 'jane@kidzonia.com', password: 'password', role: 'teacher', branchId } })
    assert.equal(uRes.status, 201)
    teacherId = uRes.data.id

    const sRes = await api('POST', '/api/sections', { token: superToken, body: { name: 'LKG-A', classId, teacherId, capacity: 30 } })
    assert.equal(sRes.status, 201)
    sectionId = sRes.data.id
  })

  await t.test('2. Fee setup', async () => {
    const fRes = await api('POST', '/api/fee-heads', { token: superToken, body: { name: 'Tuition Fee', code: 'TUITION', periodicity: 'monthly', branchId } })
    assert.equal(fRes.status, 201)
    headId = fRes.data.id

    const sRes = await api('POST', '/api/fee-structures', { token: superToken, body: { 
      name: 'LKG Annual', programId,
      lines: [{ feeHeadId: headId, amount: 15000, cycle: 'monthly' }]
    } })
    assert.equal(sRes.status, 201)
    structureId = sRes.data.id

  })

  await t.test('3. Admit a student and generate invoice', async () => {
    const appRes = await api('POST', '/api/applications', { token: superToken, body: { 
      branchId, programId, 
      childName: 'Timmy Test', childDob: '2020-01-01', gender: 'male',
      guardiansDraft: [{ name: 'Tom Test', phone: '5551234', email: 'tom@kidzonia.com' }]
    }})
    assert.equal(appRes.status, 201)
    appId = appRes.data.id
    
    // Confirm application
    const confirmRes = await api('POST', `/api/applications/${appId}/confirm`, { token: superToken, body: { sectionId, feeStructureId: structureId } })
    assert.equal(confirmRes.status, 201)
    
    // Check students created
    const stuRes = await api('GET', '/api/students', { token: superToken })
    assert.equal(stuRes.status, 200)
    const student = stuRes.data.find(s => s.applicationId === appId)
    assert.ok(student, 'Student should be generated')
    studentId = student.id
  })

  await t.test('4. Daily operations: Check-in, Logs, Feed', async () => {
    const tToken = await login('jane@kidzonia.com')
    
    const inRes = await api('POST', `/api/attendance`, { token: tToken, body: { sectionId, date: new Date().toISOString().slice(0,10), records: [{ studentId, status: 'present' }] } })
    assert.equal(inRes.status, 200)

    // no date: the server decides what today is, in the school's timezone. The
    // test used to build it from toISOString(), which is UTC and disagrees with
    // the app for five and a half hours every night.
    const mealRes = await api('POST', `/api/daily-logs`, { token: tToken, body: { studentId, type: 'meal', data: { ate: 'All', items: 'Apple, Sandwich' } } })
    assert.equal(mealRes.status, 201)

    const postRes = await api('POST', `/api/diary-posts`, { token: tToken, body: { sectionId, studentIds: [studentId], text: 'Timmy had a great day painting!', mediaIds: [] } })
    assert.equal(postRes.status, 201)
  })

  await t.test('5. Communication: Announcements', async () => {
    const aRes = await api('POST', '/api/announcements', { token: superToken, body: { title: 'Holiday Notice', body: 'School closed tomorrow.', targetType: 'all', targetId: null, requiresAck: true } })
    assert.equal(aRes.status, 201)
  })

  await t.test('6. Parent Portal access', async () => {
    parentToken = await login('tom@kidzonia.com')
    assert.ok(parentToken, 'Parent should be able to log in')

    const cRes = await api('GET', '/api/parent/children', { token: parentToken })
    assert.equal(cRes.status, 200)
    assert.equal(cRes.data.length, 1)
    assert.equal(cRes.data[0].firstName, 'Timmy')

    const tRes = await api('GET', `/api/parent/children/${cRes.data[0].id}/today`, { token: parentToken })
    assert.equal(tRes.status, 200)
    const mealLog = tRes.data.logs.find(l => l.type === 'meal')
    assert.ok(mealLog, 'Meal log should be returned to parent')

    const fRes = await api('GET', '/api/parent/feed', { token: parentToken })
    assert.equal(fRes.status, 200)
    assert.ok(fRes.data.some(p => p.text.includes('great day painting')), 'Feed post should be visible')

    const annRes = await api('GET', '/api/parent/announcements', { token: parentToken })
    assert.equal(annRes.status, 200)
    assert.ok(annRes.data.some(a => a.title === 'Holiday Notice'), 'Announcement should be visible')

    const invRes = await api('GET', '/api/parent/invoices', { token: parentToken })
    assert.equal(invRes.status, 200)
    assert.ok(invRes.data.some(i => i.total > 0), 'Invoice should be visible')
  })
})
