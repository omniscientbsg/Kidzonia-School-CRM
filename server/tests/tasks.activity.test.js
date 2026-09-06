import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

test('any module can verify a task, without a line of code for that module', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)

  const bindTo = (collection, op = 'any', scope = false) => ({
    nature: 'module_linked',
    moduleLinked: {
      moduleKey: 'activity',
      signalKey: 'performed',
      paramBinding: {
        collection: { source: 'literal', value: collection },
        op: { source: 'literal', value: op },
        scope: { source: 'literal', value: String(scope) },
      },
    },
  })

  const assign = async (title, condition) => {
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title,
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: today },
        completionCondition: condition,
      },
    })
    assert.equal(res.status, 201, JSON.stringify(res.data))
    return (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: lakshmi })).data[0].id
  }
  const load = async (id) => (await api('GET', `/api/task-instances/${id}`, { token: anjali })).data

  await t.test('the catalogue offers many modules, not one', async () => {
    const cat = (await api('GET', '/api/tasks/capabilities', { token: lakshmi })).data
    const modules = cat.activities.map((m) => m.key)
    assert.ok(modules.length >= 6, `expected several modules, got ${modules.join(', ')}`)
    for (const key of ['daily', 'attendance', 'fees', 'comms']) {
      assert.ok(modules.includes(key), `${key} should be verifiable`)
    }
    const daily = cat.activities.find((m) => m.key === 'daily')
    assert.ok(daily.things.some((t2) => t2.collection === 'diaryPosts'))

    // the engine's own bookkeeping signal is still not offered to a person
    assert.ok(!cat.verifiable.some((v) => v.signalKey === 'approvalCleared'))
  })

  await t.test('a module’s own check hangs off its thing, not beside it', async () => {
    // Attendance IS a module. Offering "attendance is marked" as a rival to
    // "they did something in a module" asked the same question twice, in two
    // vocabularies. The strict check now lives under Attendance -> Class
    // attendance, as the strongest answer to "how do we know it is done".
    const cat = (await api('GET', '/api/tasks/capabilities', { token: lakshmi })).data
    const register = cat.activities
      .find((m) => m.key === 'attendance')
      .things.find((t2) => t2.collection === 'attendanceRecords')

    assert.deepEqual(register.exact.map((e) => `${e.moduleKey}.${e.signalKey}`), ['attendance.isMarked'])
    assert.equal(register.exact[0].label, 'every child on the register is marked')
    assert.match(register.exact[0].note, /whole register/)

    // every hand-written signal a person can pick is attached to a thing —
    // an unattached one would be invisible now that there is one path in
    const attached = new Set(cat.activities.flatMap((m) => m.things.flatMap((t2) =>
      (t2.exact || []).map((e) => `${e.moduleKey}.${e.signalKey}`))))
    for (const v of cat.verifiable.filter((x) => x.precision === 'complete')) {
      assert.ok(attached.has(`${v.moduleKey}.${v.signalKey}`),
        `${v.moduleKey}.${v.signalKey} names no collection, so nothing can offer it`)
    }

    // things without their own check simply have none
    const diary = cat.activities.find((m) => m.key === 'daily').things.find((t2) => t2.collection === 'diaryPosts')
    assert.deepEqual(diary.exact, [])
  })

  await t.test('a diary-post task is not done until she posts a diary entry', async () => {
    const id = await assign('Write the class diary', bindTo('diaryPosts', 'created'))
    const before = await load(id)
    assert.equal(before.condition.satisfied, false)
    assert.match(before.condition.message, /Diary post/i)

    const refused = await api('POST', `/api/task-instances/${id}/submit`, { token: anjali })
    assert.equal(refused.status, 422)

    // do the actual work, in the actual module
    const post = await api('POST', '/api/diary-posts', {
      token: anjali,
      body: { sectionId: 'sec-jh-nursery-a', text: 'Splash table today', mediaIds: [] },
    })
    assert.equal(post.status, 201)

    const after = await load(id)
    assert.equal(after.condition.satisfied, true, 'the trail is written centrally, so nothing had to be wired into diary posts')

    const done = await api('POST', `/api/task-instances/${id}/submit`, { token: anjali })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved')
    assert.equal(done.data.completionEvidence.moduleKey, 'activity')
    assert.ok(done.data.completionEvidence.recordIds.length >= 1)
  })

  await t.test('someone else doing it does not finish HER task', async () => {
    const id = await assign('Log a meal', bindTo('dailyLogs', 'created'))
    // the principal records it, not the assignee
    const byOther = await api('POST', '/api/daily-logs', {
      token: lakshmi, body: { studentId: 'stu-1', type: 'meal', data: { ate: 'all' } },
    })
    assert.equal(byOther.status, 201)
    assert.equal((await load(id)).condition.satisfied, false, 'the trail records WHO did it')

    await api('POST', '/api/daily-logs', { token: anjali, body: { studentId: 'stu-1', type: 'meal', data: { ate: 'all' } } })
    assert.equal((await load(id)).condition.satisfied, true)
  })

  await t.test('work in a different module does not count', async () => {
    const id = await assign('Set homework', bindTo('homework', 'created'))
    await api('POST', '/api/diary-posts', { token: anjali, body: { sectionId: 'sec-jh-nursery-a', text: 'not homework', mediaIds: [] } })
    assert.equal((await load(id)).condition.satisfied, false)

    await api('POST', '/api/homework', { token: anjali, body: { sectionId: 'sec-jh-nursery-a', title: 'Read page 4' } })
    assert.equal((await load(id)).condition.satisfied, true)
  })

  await t.test('"for their own class" narrows it to the register they keep', async () => {
    // an earlier subtest already posted to her own class today, and the check
    // asks about the whole day — so start this one from a clean trail
    const { getDb } = await import('../db.js')
    const db = getDb()
    db.activityLog = db.activityLog.filter((a) => a.collection !== 'diaryPosts')

    const id = await assign('Diary for your own class', bindTo('diaryPosts', 'created', true))
    // Kavya's section, posted by Anjali — right module, wrong class
    await api('POST', '/api/diary-posts', { token: anjali, body: { sectionId: 'sec-jh-jrkg-a', text: 'other class', mediaIds: [] } })
    assert.equal((await load(id)).condition.satisfied, false)

    await api('POST', '/api/diary-posts', { token: anjali, body: { sectionId: 'sec-jh-nursery-a', text: 'her class', mediaIds: [] } })
    assert.equal((await load(id)).condition.satisfied, true)
  })

  await t.test('the two kinds of check are labelled differently, and honestly', async () => {
    const cat = (await api('GET', '/api/tasks/capabilities', { token: lakshmi })).data
    const attendance = cat.verifiable.find((v) => v.signalKey === 'isMarked')
    const generic = cat.verifiable.find((v) => v.moduleKey === 'activity')
    assert.equal(attendance.precision, 'complete', 'attendance knows what a finished register looks like')
    assert.equal(generic.precision, 'performed', 'the generic one only knows the work was touched')
  })
})

// ---------------------------------------------------------------------------
test('parents are told whatever the assigner wrote, on any task', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const sudhir = await login('sudhir.kukreja@kidzonia.com')
  const gayatri = await login('gayatri.nair@kidzonia.com')
  const today = localToday(TZ)

  const guardians = async () => {
    const { getDb } = await import('../db.js')
    const db = getDb()
    const kids = db.enrolments.filter((e) => e.sectionId === 'sec-jh-daycare-a' && !e.leftAt).map((e) => e.studentId)
    const users = db.guardianStudentLinks.filter((l) => kids.includes(l.studentId))
      .map((l) => db.guardians.find((g) => g.id === l.guardianId)?.userId).filter(Boolean)
    return { kids, users: [...new Set(users)] }
  }
  const parentMessages = async (users) => {
    const { getDb } = await import('../db.js')
    return getDb().notifications.filter((n) => users.includes(n.userId) && n.type === 'task_update')
  }

  const { kids, users } = await guardians()

  await t.test('the message is required, and it is the author’s words', async () => {
    const missing = await api('POST', '/api/tasks', {
      token: sudhir,
      body: {
        title: 'Lunch, no message',
        target: { kind: 'position', positionIds: ['pos-gayatri'] },
        recurrence: { freq: 'none', startDate: today },
        completionCondition: { nature: 'mcq', mcq: { question: 'Fed?', requiredAnswer: 'yes' } },
        onComplete: { actions: [{ moduleKey: 'parents', actionKey: 'notify' }] },
      },
    })
    assert.equal(missing.status, 422)
    assert.match(missing.data.message, /required/i)
  })

  await t.test('placeholders are filled per family, and it fires once', async () => {
    const before = (await parentMessages(users)).length
    const res = await api('POST', '/api/tasks', {
      token: sudhir,
      body: {
        title: 'Day-care lunch',
        target: { kind: 'position', positionIds: ['pos-gayatri'] },
        recurrence: { freq: 'none', startDate: today },
        completionCondition: {
          nature: 'mcq',
          mcq: {
            question: 'Did you give food to the day-care children?',
            options: [{ value: 'yes', label: 'Yes', accepts: true }, { value: 'no', label: 'No', accepts: true }],
            requiredAnswer: 'yes',
          },
        },
        onComplete: {
          actions: [{
            moduleKey: 'parents', actionKey: 'notify',
            config: { message: '{child} ate lunch today with {staff}.' },
            when: { answer: 'yes' },
          }],
        },
      },
    })
    assert.equal(res.status, 201, JSON.stringify(res.data))
    const id = (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: sudhir })).data[0].id

    const done = await api('POST', `/api/task-instances/${id}/submit`, { token: gayatri, body: { completion: { answer: 'yes' } } })
    assert.equal(done.status, 200)

    const sent = await parentMessages(users)
    assert.equal(sent.length - before, kids.length, 'one per child')
    const one = sent[sent.length - 1]
    assert.match(one.body, /ate lunch today with gayatri Nair\./)
    assert.ok(!/\{child\}|\{staff\}/.test(one.body), 'placeholders were replaced')
    // the message says nothing the task did not check — that was the old bug
    assert.equal(done.data.actionResults.find((r) => r.key === 'parents.notify').status, 'sent')
  })

  await t.test('answering No fires nothing', async () => {
    const before = (await parentMessages(users)).length
    const res = await api('POST', '/api/tasks', {
      token: sudhir,
      body: {
        title: 'Lunch again',
        target: { kind: 'position', positionIds: ['pos-gayatri'] },
        recurrence: { freq: 'none', startDate: today },
        completionCondition: {
          nature: 'mcq',
          mcq: {
            question: 'Fed?',
            options: [{ value: 'yes', label: 'Yes', accepts: true }, { value: 'no', label: 'No', accepts: true }],
            requiredAnswer: 'yes',
          },
        },
        onComplete: { actions: [{ moduleKey: 'parents', actionKey: 'notify', config: { message: '{child} ate.' }, when: { answer: 'yes' } }] },
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: sudhir })).data[0].id
    const done = await api('POST', `/api/task-instances/${id}/submit`, { token: gayatri, body: { completion: { answer: 'no' } } })
    assert.equal(done.data.status, 'approved')
    assert.equal((await parentMessages(users)).length, before)
  })
})
