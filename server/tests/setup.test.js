import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('setup: session (academic year) management', async (t) => {
  await startServer()
  t.after(stopServer)

  const superToken = await login('superadmin@kidzonia.com')

  await t.test('seed has one active + one archived session per branch', async () => {
    const { status, data } = await api('GET', '/api/academic-years', { token: superToken })
    assert.equal(status, 200)
    const jh = data.filter((s) => s.branchId === 'br-jh')
    assert.equal(jh.length, 3) // 2025-26 (archived), 2026-27 (active), 2027-28 (planning)
    const active = jh.filter((s) => s.active)
    assert.equal(active.length, 1)
    assert.equal(active[0].name, '2026-2027')
    const archived = jh.filter((s) => s.archived)
    assert.equal(archived.length, 1)
    assert.equal(archived[0].name, '2025-2026')
    assert.equal(archived[0].active, false)
  })

  await t.test('rejects end date not after start date', async () => {
    const { status } = await api('POST', '/api/academic-years', {
      token: superToken,
      body: { name: 'Bad', branchId: 'br-jh', startDate: '2028-06-01', endDate: '2028-06-01' },
    })
    assert.equal(status, 422)
  })

  await t.test('rejects overlapping date range', async () => {
    const { status, data } = await api('POST', '/api/academic-years', {
      token: superToken,
      body: { name: 'Overlap', branchId: 'br-jh', startDate: '2026-01-01', endDate: '2026-12-31' },
    })
    assert.equal(status, 422)
    assert.match(data.error, /overlap/i)
  })

  await t.test('accepts a valid non-overlapping session', async () => {
    const { status, data } = await api('POST', '/api/academic-years', {
      token: superToken,
      body: { name: '2028-2029', branchId: 'br-jh', startDate: '2028-06-01', endDate: '2029-03-31' },
    })
    assert.equal(status, 201)
    assert.equal(data.active, false)
    assert.equal(data.archived, false)
  })

  await t.test('activating demotes the previous active session (not archived)', async () => {
    const before = await api('GET', '/api/academic-years', { token: superToken })
    const jh = before.data.filter((s) => s.branchId === 'br-jh')
    const wasActive = jh.find((s) => s.active)
    const target = jh.find((s) => !s.active && !s.archived)
    const { status, data } = await api('PUT', `/api/academic-years/${target.id}/activate`, { token: superToken, body: {} })
    assert.equal(status, 200)
    assert.equal(data.active, true)
    const after = await api('GET', '/api/academic-years', { token: superToken })
    const jhAfter = after.data.filter((s) => s.branchId === 'br-jh')
    assert.equal(jhAfter.filter((s) => s.active).length, 1)
    const demoted = jhAfter.find((s) => s.id === wasActive.id)
    assert.equal(demoted.active, false)
    assert.equal(demoted.archived, false)
    // put 2026-2027 back as active for later assertions
    await api('PUT', `/api/academic-years/${wasActive.id}/activate`, { token: superToken, body: {} })
  })

  await t.test('cannot archive the active session; archived is read-only; restore works', async () => {
    const all = await api('GET', '/api/academic-years', { token: superToken })
    const active = all.data.find((s) => s.branchId === 'br-jh' && s.active)
    const blocked = await api('PUT', `/api/academic-years/${active.id}/archive`, { token: superToken, body: {} })
    assert.equal(blocked.status, 409)

    const archived = all.data.find((s) => s.branchId === 'br-jh' && s.archived)
    const editBlocked = await api('PUT', `/api/academic-years/${archived.id}`, { token: superToken, body: { name: 'Nope' } })
    assert.equal(editBlocked.status, 409)

    const restored = await api('PUT', `/api/academic-years/${archived.id}/archive`, { token: superToken, body: { archived: false } })
    assert.equal(restored.status, 200)
    assert.equal(restored.data.archived, false)
    // re-archive to leave seed state intact
    await api('PUT', `/api/academic-years/${archived.id}/archive`, { token: superToken, body: { archived: true } })
  })

  await t.test('clone copies classes + sections but no students', async () => {
    const all = await api('GET', '/api/academic-years', { token: superToken })
    const source = all.data.find((s) => s.branchId === 'br-jh' && s.active)
    const srcClasses = await api('GET', `/api/classes?academicYearId=${source.id}`, { token: superToken })

    const { status, data } = await api('POST', `/api/academic-years/${source.id}/clone`, {
      token: superToken,
      body: { name: '2029-2030', startDate: '2029-06-01', endDate: '2030-03-31' },
    })
    assert.equal(status, 201)
    assert.equal(data.classCount, srcClasses.data.length)

    const newClasses = await api('GET', `/api/classes?academicYearId=${data.session.id}`, { token: superToken })
    assert.equal(newClasses.data.length, srcClasses.data.length)

    const stats = await api('GET', '/api/session-stats', { token: superToken })
    const cloned = stats.data.find((x) => x.sessionId === data.session.id)
    assert.equal(cloned.classes, srcClasses.data.length)
    assert.equal(cloned.students, 0) // structure only, no enrolments
  })

  await t.test('session-stats reports students for the active session', async () => {
    const all = await api('GET', '/api/academic-years', { token: superToken })
    const active = all.data.find((s) => s.branchId === 'br-jh' && s.active)
    const stats = await api('GET', '/api/session-stats', { token: superToken })
    const row = stats.data.find((x) => x.sessionId === active.id)
    assert.ok(row.classes > 0)
    assert.ok(row.students > 0)
  })

  await t.test('seeded classes carry code + teacher assignments + active flag', async () => {
    const nursery = (await api('GET', '/api/classes?academicYearId=ay-jh-26', { token: superToken })).data.find((c) => c.id === 'cls-jh-nursery')
    assert.equal(nursery.name, 'Kidzo Nursery')
    assert.equal(nursery.code, 'KZ-NUR')
    assert.equal(nursery.active, true)
    assert.equal(nursery.classTeacherId, 'u-teacher')
    assert.ok(Array.isArray(nursery.assistantTeacherIds) && nursery.assistantTeacherIds.includes('u-teacher2'))
  })

  await t.test('class-stats returns live student + section counts', async () => {
    const stats = await api('GET', '/api/class-stats?academicYearId=ay-jh-26', { token: superToken })
    assert.equal(stats.status, 200)
    const nursery = stats.data.find((x) => x.classId === 'cls-jh-nursery')
    assert.ok(nursery.students > 0)
    assert.equal(nursery.sections, 2) // A + B
  })

  await t.test('roster export endpoint lists enrolled students', async () => {
    const { status, data } = await api('GET', '/api/classes/cls-jh-nursery/roster', { token: superToken })
    assert.equal(status, 200)
    assert.equal(data.class.code, 'KZ-NUR')
    assert.ok(data.students.length > 0)
    assert.ok(data.students.every((s) => s.name && s.section))
  })

  await t.test('deactivate + reactivate a class via active flag', async () => {
    const off = await api('PUT', '/api/classes/cls-jh-srkg', { token: superToken, body: { active: false } })
    assert.equal(off.status, 200)
    assert.equal(off.data.active, false)
    const on = await api('PUT', '/api/classes/cls-jh-srkg', { token: superToken, body: { active: true } })
    assert.equal(on.data.active, true)
  })

  await t.test('teacher cannot see users; branch admin roster is branch-scoped', async () => {
    const principal = await login('principal@kidzonia.com') // br-jh
    const ok = await api('GET', '/api/classes/cls-jh-nursery/roster', { token: principal })
    assert.equal(ok.status, 200)
    const cross = await api('GET', '/api/classes/cls-gb-nursery/roster', { token: principal })
    assert.equal(cross.status, 404)
  })

  await t.test('promotion moves students cross-session and closes the old enrolment', async () => {
    const roster = (await api('GET', '/api/classes/cls-jh-nursery/roster', { token: superToken })).data.students
    const aIds = roster.filter((s) => s.section === 'A').map((s) => s.id)
    assert.ok(aIds.length >= 6)
    const some = aIds.slice(0, 3)
    const r = await api('POST', '/api/transfers', {
      token: superToken,
      body: { fromSessionId: 'ay-jh-26', toSessionId: 'ay-jh-27', fromClassId: 'cls-jh-nursery', toClassId: 'cls-jh-jrkg-27', toSectionId: 'sec-jh-jrkg-a-27', studentIds: some },
    })
    assert.equal(r.status, 200)
    assert.equal(r.data.transferred, 3)
    const jkg27 = (await api('GET', '/api/class-stats?academicYearId=ay-jh-27', { token: superToken })).data.find((x) => x.classId === 'cls-jh-jrkg-27')
    assert.equal(jkg27.students, 3)
    const roster2 = (await api('GET', '/api/classes/cls-jh-nursery/roster', { token: superToken })).data.students.map((s) => s.id)
    assert.ok(some.every((id) => !roster2.includes(id)), 'moved students left the source class')
  })

  await t.test('over-capacity blocked without override, allowed with override', async () => {
    const aIds = (await api('GET', '/api/classes/cls-jh-nursery/roster', { token: superToken })).data.students
      .filter((s) => s.section === 'A').map((s) => s.id) // ~9 left; jrkg-27 A cap 10 already holds 3
    const body = { fromSessionId: 'ay-jh-26', toSessionId: 'ay-jh-27', fromClassId: 'cls-jh-nursery', toClassId: 'cls-jh-jrkg-27', toSectionId: 'sec-jh-jrkg-a-27', studentIds: aIds }
    const blocked = await api('POST', '/api/transfers', { token: superToken, body })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.data.error, 'over_capacity')
    const ok = await api('POST', '/api/transfers', { token: superToken, body: { ...body, override: true } })
    assert.equal(ok.status, 200)
    assert.equal(ok.data.transferred, aIds.length)
  })

  await t.test('same source/dest rejected; teacher denied promotion', async () => {
    const same = await api('POST', '/api/transfers', {
      token: superToken,
      body: { fromSessionId: 'ay-jh-26', toSessionId: 'ay-jh-26', fromClassId: 'cls-jh-nursery', toClassId: 'cls-jh-nursery', toSectionId: 'sec-jh-nursery-a', studentIds: ['stu-3'] },
    })
    assert.equal(same.status, 422)
    const teacher = await login('teacher@kidzonia.com')
    const denied = await api('POST', '/api/transfers', {
      token: teacher,
      body: { fromSessionId: 'ay-jh-26', toSessionId: 'ay-jh-27', fromClassId: 'cls-jh-nursery', toClassId: 'cls-jh-jrkg-27', toSectionId: 'sec-jh-jrkg-a-27', studentIds: ['stu-3'] },
    })
    assert.equal(denied.status, 403)
  })

  await t.test('promotion writes an audit entry', async () => {
    const logs = (await api('GET', '/api/audit-log?collection=enrolments', { token: superToken })).data
    assert.ok(logs.some((l) => l.action === 'promote'))
  })

  await t.test('student-breakup aggregates strength / EWS / category live', async () => {
    const { status, data } = await api('GET', '/api/reports/student-breakup?sessionId=ay-jh-26', { token: superToken })
    assert.equal(status, 200)
    assert.equal(data.session.name, '2026-2027')
    assert.ok(data.rows.length > 0)
    // TOTAL equals sum of class rows
    const sum = data.rows.reduce((n, r) => n + r.strength.total, 0)
    assert.equal(data.totals.strength.total, sum)
    // boys + girls === total for every row
    assert.ok(data.rows.every((r) => r.strength.boys + r.strength.girls === r.strength.total))
    // every student falls in exactly one category → category totals sum to strength
    const catSum = data.categories.reduce((n, c) => n + data.totals.categories[c].total, 0)
    assert.equal(catSum, data.totals.strength.total)
    // EWS is a subset of strength
    assert.ok(data.totals.ews.total <= data.totals.strength.total)
    // age bands present and sum to strength
    assert.equal(data.ageBands.length, 6)
    const bandSum = data.ageBands.reduce((n, b) => n + data.totals.ageBands[b].total, 0)
    assert.equal(bandSum, data.totals.strength.total)
  })

  await t.test('teacher can view breakup (students.view), parent cannot', async () => {
    const teacher = await login('teacher@kidzonia.com')
    const ok = await api('GET', '/api/reports/student-breakup', { token: teacher })
    assert.equal(ok.status, 200)
    const parent = await login('parent@kidzonia.com')
    const denied = await api('GET', '/api/reports/student-breakup', { token: parent })
    assert.equal(denied.status, 403)
  })

  await t.test('attendance report: class-wise summary + trend for a range', async () => {
    const { status, data } = await api('GET', '/api/reports/attendance?sessionId=ay-jh-26', { token: superToken })
    assert.equal(status, 200)
    assert.ok(data.classes.length > 0)
    assert.ok(data.trend.length > 0, 'trend has dated points')
    const nursery = data.classes.find((c) => c.classId === 'cls-jh-nursery')
    assert.ok(nursery.records > 0)
    assert.ok(nursery.presentPct > 0 && nursery.presentPct <= 100)
    // trend points carry a 0–100 pct
    assert.ok(data.trend.every((p) => p.pct >= 0 && p.pct <= 100))
  })

  await t.test('attendance drill: per-student % flags chronic absentees (<75%)', async () => {
    const { status, data } = await api('GET', '/api/reports/attendance/class/cls-jh-nursery', { token: superToken })
    assert.equal(status, 200)
    assert.ok(data.students.length > 0)
    assert.ok(data.students.every((s) => s.presentPct >= 0 && s.presentPct <= 100))
    // stu-2 (Vihaan) is a seeded chronic absentee
    const chronic = data.students.find((s) => s.studentId === 'stu-2')
    assert.ok(chronic, 'chronic student present in nursery drill')
    assert.ok(chronic.presentPct < 75 && chronic.chronic === true)
  })

  await t.test('accountant denied attendance report (attendance.view = none)', async () => {
    const acc = await login('accounts@kidzonia.com')
    const r = await api('GET', '/api/reports/attendance', { token: acc })
    assert.equal(r.status, 403)
  })

  await t.test('staff list carries employee IDs; AANYA is EMP/6; daycare_staff role seeded', async () => {
    const staff = (await api('GET', '/api/staff', { token: superToken })).data
    const aanya = staff.find((s) => s.name === 'AANYA KHAN')
    assert.ok(aanya)
    assert.equal(aanya.employeeId, 'EMP/6')
    assert.equal(aanya.username, 'aanya.khan')
    assert.deepEqual(aanya.classTeacherOf, ['cls-jh-nursery'])
    assert.equal(aanya.passwordHash, undefined) // sanitized
    const perms = (await api('GET', '/api/role-permissions', { token: superToken })).data
    assert.ok(perms.some((p) => p.role === 'daycare_staff'))
  })

  await t.test('new staff can log in by username', async () => {
    const { status, data } = await api('POST', '/api/auth/login', { body: { email: 'anurag.jain', password: 'password' } })
    assert.equal(status, 200)
    assert.equal(data.user.username, 'anurag.jain')
  })

  await t.test('create staff: auto employee id, validates mobile + unique username', async () => {
    const ok = await api('POST', '/api/staff', { token: superToken, body: { name: 'Test Teacher', username: 'test.teacher', role: 'teacher', branchId: 'br-jh', phone: '+91 90000 12345', designation: 'Teacher' } })
    assert.equal(ok.status, 201)
    assert.match(ok.data.employeeId, /^EMP\/\d+$/)
    const dupe = await api('POST', '/api/staff', { token: superToken, body: { name: 'Dup', username: 'anurag.jain', role: 'teacher', branchId: 'br-jh' } })
    assert.equal(dupe.status, 422)
    const badPhone = await api('POST', '/api/staff', { token: superToken, body: { name: 'Bad', username: 'bad.phone', role: 'teacher', branchId: 'br-jh', phone: '123' } })
    assert.equal(badPhone.status, 422)
  })

  await t.test('teacher denied staff.create', async () => {
    const teacher = await login('teacher@kidzonia.com')
    const r = await api('POST', '/api/staff', { token: teacher, body: { name: 'X', username: 'x.y', role: 'teacher' } })
    assert.equal(r.status, 403)
  })

  await t.test('staff attendance: bulk mark + monthly summary', async () => {
    const date = new Date().toISOString().slice(0, 10)
    const list0 = await api('GET', `/api/staff-attendance?date=${date}`, { token: superToken })
    assert.equal(list0.status, 200)
    assert.ok(list0.data.staff.length > 0)
    const targets = list0.data.staff.slice(0, 3).map((s) => ({ staffId: s.staffId, status: 'present' }))
    const mark = await api('POST', '/api/staff-attendance', { token: superToken, body: { date, records: targets } })
    assert.equal(mark.data.saved, 3)
    const month = date.slice(0, 7)
    const summary = await api('GET', `/api/staff-attendance/summary?month=${month}`, { token: superToken })
    assert.equal(summary.status, 200)
    assert.ok(summary.data.staff.some((s) => s.marked > 0))
  })

  await t.test('day care menu: weekly meals, dish library, peanut allergy warning', async () => {
    const { status, data } = await api('GET', '/api/dc-menu?sessionId=ay-jh-26', { token: superToken })
    assert.equal(status, 200)
    assert.ok(data.meals.length >= 15)
    assert.ok(data.dishes.length > 0)
    const peanutMeal = data.meals.find((m) => m.allergens.includes('Peanuts'))
    assert.ok(peanutMeal, 'a meal contains peanuts')
    assert.ok(peanutMeal.allergyWarnings.length > 0, 'peanut meal warns for an allergic daycare child')
    assert.ok(peanutMeal.allergyWarnings.some((w) => w.allergens.includes('Peanuts')))
  })

  await t.test('create dish + meal; day care staff allowed, accountant denied', async () => {
    const gayatri = await login('gayatri.nair@kidzonia.com') // daycare_staff (login by email or username)
    const dish = await api('POST', '/api/dishes', { token: gayatri, body: { name: 'Ragi Porridge', allergens: [] } })
    assert.equal(dish.status, 201)
    const meal = await api('POST', '/api/dc-meals', { token: gayatri, body: { sessionId: 'ay-jh-26', dayOfWeek: 6, mealType: 'breakfast', name: 'Saturday Special', dishIds: [dish.data.id] } })
    assert.equal(meal.status, 201)
    const acc = await login('accounts@kidzonia.com')
    const denied = await api('POST', '/api/dc-meals', { token: acc, body: { sessionId: 'ay-jh-26', dayOfWeek: 0, mealType: 'lunch', name: 'X' } })
    assert.equal(denied.status, 403)
  })

  await t.test('day care activity: play/incident log types accepted', async () => {
    const gayatri = await login('gayatri.nair')
    const dcKid = (await api('GET', '/api/dc-menu?sessionId=ay-jh-26', { token: superToken })).data.meals[0] && 'stu-29'
    const play = await api('POST', '/api/daily-logs', { token: gayatri, body: { studentId: dcKid, type: 'play', data: { note: 'Blocks' } } })
    assert.equal(play.status, 201)
    const incident = await api('POST', '/api/daily-logs', { token: gayatri, body: { studentId: dcKid, type: 'incident', data: { note: 'Small scrape' } } })
    assert.equal(incident.status, 201)
  })

  await t.test('day care activity master catalog: seeded defaults + create', async () => {
    const acts = (await api('GET', '/api/daycare-activities', { token: superToken })).data
    assert.ok(acts.some((a) => a.name === 'Check In' && a.isSystem))
    assert.ok(acts.some((a) => a.name === 'Check Out'))
    const meal = acts.find((a) => a.name === 'Meal')
    assert.ok(meal.options.length > 0 && meal.showStartTime)
    // day care staff can add a new master activity
    const gayatri = await login('gayatri.nair')
    const created = await api('POST', '/api/daycare-activities', { token: gayatri, body: { name: 'Story Time', showStartTime: true, startTime: '11:00', options: ['Listened', 'Participated'], multipleEntriesAllowed: false } })
    assert.equal(created.status, 201)
    assert.equal(created.data.name, 'Story Time')
    const acc = await login('accounts@kidzonia.com')
    const denied = await api('POST', '/api/daycare-activities', { token: acc, body: { name: 'X' } })
    assert.equal(denied.status, 403)
  })

  await t.test('publish week menu to parents', async () => {
    const r = await api('POST', '/api/dc-menu/publish', { token: superToken, body: { sessionId: 'ay-jh-26', published: true } })
    assert.equal(r.status, 200)
    assert.ok(r.data.count > 0)
  })

  await t.test('groups: session-filtered list, member resolution, create; teacher denied', async () => {
    const listed = await api('GET', '/api/groups?academicYearId=ay-jh-26', { token: superToken })
    assert.equal(listed.status, 200)
    assert.ok(listed.data.length >= 3)
    const bus = listed.data.find((g) => g.id === 'grp-bus3')
    assert.equal(bus.type, 'transport')
    assert.ok(bus.memberIds.length === 4)

    const members = await api('GET', '/api/groups/grp-music/members', { token: superToken })
    assert.equal(members.status, 200)
    assert.ok(members.data.every((m) => m.name && m.id))
    // cross-class cohort — more than one class represented
    assert.ok(new Set(members.data.map((m) => m.className)).size > 1)

    const created = await api('POST', '/api/groups', { token: superToken, body: { branchId: 'br-jh', academicYearId: 'ay-jh-26', type: 'custom', name: 'Art Club', memberIds: ['stu-1'], staffIds: [], classIds: [], staffInchargeId: 'u-aanya', active: true } })
    assert.equal(created.status, 201)

    const teacher = await login('teacher@kidzonia.com')
    const denied = await api('POST', '/api/groups', { token: teacher, body: { name: 'X', type: 'custom' } })
    assert.equal(denied.status, 403) // setup.create denied for teacher
  })

  await t.test('groups: staff/parents/class types + recipient resolution for comms', async () => {
    const groups = (await api('GET', '/api/groups?academicYearId=ay-jh-26', { token: superToken })).data
    assert.ok(groups.some((g) => g.type === 'staff'))
    assert.ok(groups.some((g) => g.type === 'parents'))

    // staff group → staff recipients, no guardians
    const staffRec = await api('GET', '/api/groups/grp-allstaff/recipients', { token: superToken })
    assert.equal(staffRec.status, 200)
    assert.ok(staffRec.data.staff.length >= 5)
    assert.equal(staffRec.data.guardians.length, 0)

    // parents-of-a-class group → guardians resolved via the class's enrolled students
    const parentRec = await api('GET', '/api/groups/grp-nursery-parents/recipients', { token: superToken })
    assert.ok(parentRec.data.studentCount > 0)
    assert.ok(parentRec.data.guardians.length > 0)
    assert.equal(parentRec.data.staff.length, 0)

    // mixed class group → both staff and guardians
    const mixed = await api('GET', '/api/groups/grp-srkg-class/recipients', { token: superToken })
    assert.ok(mixed.data.staff.length > 0 && mixed.data.guardians.length > 0)
  })

  await t.test('branch admin cannot touch another branch session; teacher denied writes', async () => {
    const gb = (await api('GET', '/api/academic-years', { token: superToken })).data.find((s) => s.branchId === 'br-gb')
    const principal = await login('principal@kidzonia.com') // br-jh
    const cross = await api('PUT', `/api/academic-years/${gb.id}/activate`, { token: principal, body: {} })
    assert.equal(cross.status, 404)

    const jhActive = (await api('GET', '/api/academic-years', { token: superToken })).data.find((s) => s.branchId === 'br-jh' && s.active)
    const teacher = await login('teacher@kidzonia.com')
    const denied = await api('PUT', `/api/academic-years/${jhActive.id}/activate`, { token: teacher, body: {} })
    assert.equal(denied.status, 403)
  })
})
