import test from 'node:test'
import assert from 'node:assert/strict'
import { occurrencesBetween, describeRecurrence } from '../tasks/recurrence.js'
import { localDayEnd, localDayStart, localDate, addMonths, clampDayOfMonth, weekdayOf } from '../tasks/time.js'

test('recurrence expansion is pure and bounded', async (t) => {
  await t.test('one-off yields its start date only', () => {
    assert.deepEqual(occurrencesBetween({ freq: 'none', startDate: '2026-08-10' }, '2026-08-01', '2026-08-31'), ['2026-08-10'])
    assert.deepEqual(occurrencesBetween({ freq: 'none', startDate: '2026-09-10' }, '2026-08-01', '2026-08-31'), [])
  })

  await t.test('daily respects interval and end date', () => {
    assert.deepEqual(
      occurrencesBetween({ freq: 'daily', startDate: '2026-08-01' }, '2026-08-01', '2026-08-04'),
      ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']
    )
    assert.deepEqual(
      occurrencesBetween({ freq: 'daily', interval: 3, startDate: '2026-08-01' }, '2026-08-01', '2026-08-10'),
      ['2026-08-01', '2026-08-04', '2026-08-07', '2026-08-10']
    )
    assert.deepEqual(
      occurrencesBetween({ freq: 'daily', startDate: '2026-08-01', endDate: '2026-08-02' }, '2026-08-01', '2026-08-31'),
      ['2026-08-01', '2026-08-02']
    )
  })

  await t.test('specific weekdays and weekly intervals', () => {
    const mwf = occurrencesBetween({ freq: 'weekdays', byWeekday: [1, 3, 5], startDate: '2026-08-01' }, '2026-08-01', '2026-08-14')
    assert.ok(mwf.every((d) => [1, 3, 5].includes(weekdayOf(d))))
    assert.equal(mwf.length, 6)

    const fortnightly = occurrencesBetween({ freq: 'weekly', byWeekday: [1], interval: 2, startDate: '2026-08-01' }, '2026-08-01', '2026-09-30')
    assert.ok(fortnightly.every((d) => weekdayOf(d) === 1))
    assert.equal(fortnightly[1], '2026-08-17')          // 2 weeks after the first Monday (Aug 3)
  })

  await t.test('monthly clamps to short months', () => {
    const days = occurrencesBetween({ freq: 'monthly', dayOfMonth: 31, startDate: '2026-01-31' }, '2026-01-01', '2026-04-30')
    assert.deepEqual(days, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    assert.equal(clampDayOfMonth(2028, 1, 31), 29)      // leap February
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  })

  await t.test('count caps the series and skipNonWorkingDays honours the work week', () => {
    const five = occurrencesBetween({ freq: 'daily', startDate: '2026-08-01', count: 5 }, '2026-08-01', '2026-12-31')
    assert.equal(five.length, 5)

    const noSunday = occurrencesBetween(
      { freq: 'daily', startDate: '2026-08-01', skipNonWorkingDays: true },
      '2026-08-01', '2026-08-14',
      { workWeek: [1, 2, 3, 4, 5, 6] }
    )
    assert.ok(noSunday.every((d) => weekdayOf(d) !== 0))
  })

  await t.test('describeRecurrence reads like a human wrote it', () => {
    assert.equal(describeRecurrence({ freq: 'none' }), 'One-off')
    assert.equal(describeRecurrence({ freq: 'daily', interval: 1 }), 'Every day')
    assert.equal(describeRecurrence({ freq: 'weekdays', byWeekday: [1, 3] }), 'Weekly on Mon, Wed')
    assert.equal(describeRecurrence({ freq: 'monthly', dayOfMonth: 5, interval: 1 }), 'Monthly on day 5')
  })
})

test('day boundaries follow the school timezone, not the server', async (t) => {
  await t.test('end of day in Asia/Kolkata is 18:29:59.999Z', () => {
    assert.equal(localDayEnd('Asia/Kolkata', '2026-08-08'), '2026-08-08T18:29:59.999Z')
    assert.equal(localDayStart('Asia/Kolkata', '2026-08-08'), '2026-08-07T18:30:00.000Z')
  })

  await t.test('the same instant is a different local date in different zones', () => {
    const instant = new Date('2026-08-08T19:00:00.000Z')     // 00:30 next day in India
    assert.equal(localDate('Asia/Kolkata', instant), '2026-08-09')
    assert.equal(localDate('UTC', instant), '2026-08-08')
  })

  await t.test('a DST zone still lands on midnight local', () => {
    // New York is UTC-4 in August (EDT) and UTC-5 in January (EST)
    assert.equal(localDayStart('America/New_York', '2026-08-08'), '2026-08-08T04:00:00.000Z')
    assert.equal(localDayStart('America/New_York', '2026-01-08'), '2026-01-08T05:00:00.000Z')
  })
})
