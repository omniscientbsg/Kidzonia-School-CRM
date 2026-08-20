// Discount engine. Amounts are integer paise. Precedence is explicit and fixed:
//   1) CONCESSION (category: EWS/OBC/SC/ST/Staff-ward/Sibling/Scholarship/Custom)
//   2) CORPORATE  (company tie-up rate)
//   3) GROUP      (per-group charges/discounts from Setup Groups)
// Each stage acts on the amount left by the previous stage. Discounts never push a
// line below zero; group CHARGES may add to it (and can introduce new heads).
import { pctOfPaise } from './money.js'

export const CONCESSION_CATEGORIES = ['EWS', 'OBC', 'SC', 'ST', 'Staff-ward', 'Sibling', 'Scholarship', 'Custom']

// value of a {type, values{headId}} rule for one head against a running amount
function ruleAmount(rule, headId, runningAmount) {
  if (!rule) return 0
  const v = rule.values?.[headId]
  if (v == null || v === '') return 0
  return rule.type === 'percentage' ? pctOfPaise(runningAmount, v) : Math.min(Number(v) || 0, runningAmount)
}

// lines: [{ feeHeadId, amount(paise), cycle }] (effective, billable)
// ctx: { concession, corporate, groups: [{charges:[{feeHeadId, kind:'charge'|'discount', type, value}]}] }
export function applyDiscounts(lines, ctx = {}) {
  const { concession, corporate, groups = [] } = ctx
  const byHead = new Map(lines.map((l) => [l.feeHeadId, { ...l }]))
  // group charges can target heads not in the base structure -> seed a zero line
  for (const g of groups) for (const ch of g.charges || []) {
    if (!byHead.has(ch.feeHeadId)) byHead.set(ch.feeHeadId, { feeHeadId: ch.feeHeadId, amount: 0, cycle: 'monthly', addedByGroup: true })
  }

  const out = []
  for (const l of byHead.values()) {
    const base = l.amount || 0
    const concAmt = ruleAmount(concession, l.feeHeadId, base)
    const a1 = Math.max(0, base - concAmt)
    const corpAmt = ruleAmount(corporate, l.feeHeadId, a1)
    const a2 = Math.max(0, a1 - corpAmt)
    let groupDiscount = 0, groupCharge = 0
    for (const g of groups) for (const ch of g.charges || []) {
      if (ch.feeHeadId !== l.feeHeadId) continue
      const amt = ch.type === 'percentage' ? pctOfPaise(a2, ch.value) : (Number(ch.value) || 0)
      if (ch.kind === 'discount') groupDiscount += amt
      else groupCharge += amt
    }
    const net = Math.max(0, a2 - groupDiscount) + groupCharge
    out.push({ feeHeadId: l.feeHeadId, cycle: l.cycle, base, concession: concAmt, corporate: corpAmt, groupDiscount, groupCharge, net })
  }
  return out
}

// convenience totals across lines
export function totalsOf(breakdown) {
  const t = { base: 0, concession: 0, corporate: 0, groupDiscount: 0, groupCharge: 0, net: 0 }
  for (const b of breakdown) { t.base += b.base; t.concession += b.concession; t.corporate += b.corporate; t.groupDiscount += b.groupDiscount; t.groupCharge += b.groupCharge; t.net += b.net }
  t.totalDiscount = t.concession + t.corporate + t.groupDiscount
  return t
}
