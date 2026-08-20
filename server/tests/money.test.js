import test from 'node:test'
import assert from 'node:assert/strict'
import { toPaise, fromPaise, fmtPaise, pctOfPaise, rupees } from '../fees/money.js'

test('money core: paise conversions and formatting', () => {
  // toPaise: numbers, strings, currency-formatted strings
  assert.equal(toPaise(25000), 2500000)
  assert.equal(toPaise('25000'), 2500000)
  assert.equal(toPaise('₹1,28,500'), 12850000)
  assert.equal(toPaise('1,28,500.50'), 12850050)
  assert.equal(toPaise(''), 0)
  assert.equal(toPaise('abc'), 0)

  // float safety: 25.55 * 100 must land on exactly 2555, not 2554.99…
  assert.equal(toPaise(25.55), 2555)
  assert.equal(toPaise(0.1 + 0.2), 30)

  // round-trip rupees -> paise -> rupees
  for (const r of [0, 1, 1500, 25000, 128500, 99.99]) {
    assert.equal(fromPaise(rupees(r)), r)
  }

  // rupees() seed helper == toPaise for whole values
  assert.equal(rupees(11500), toPaise(11500))

  // fmtPaise: whole rupees show no decimals; stray paise show two
  assert.equal(fmtPaise(12850000), '₹1,28,500')
  assert.equal(fmtPaise(2500000), '₹25,000')
  assert.equal(fmtPaise(12850050), '₹1,28,500.50')
  assert.equal(fmtPaise(0), '₹0')
  assert.equal(fmtPaise(null), '₹0')

  // pctOfPaise: 10% of ₹1,050 = ₹105 (rounded to whole paise)
  assert.equal(pctOfPaise(105000, 10), 10500)
  assert.equal(pctOfPaise(2555, 33.33), 852) // 851.58… -> 852
})
