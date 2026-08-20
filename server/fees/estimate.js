// Annualisation of fee-structure lines. Amounts are integer paise; cycle drives
// how many times per academic year a line is charged. Keep in sync with
// src/services/fees/estimate.js.
export const CYCLE_INSTALLMENTS = { one_time: 1, monthly: 12, quarterly: 4, term: 3, half_yearly: 2, annual: 1 }
export const CYCLE_LABEL = { one_time: 'One-Time', monthly: 'Monthly', quarterly: 'Quarterly', term: 'Per Term', half_yearly: 'Half-Yearly', annual: 'Annual' }

// lines: [{ feeHeadId, amount(paise), cycle }] -> annualised estimate
export function annualise(lines = []) {
  const byCycle = {}
  for (const l of lines) {
    const cycle = l.cycle || 'monthly'
    const mult = CYCLE_INSTALLMENTS[cycle] ?? 1
    if (!byCycle[cycle]) byCycle[cycle] = { cycle, perInstallment: 0, installments: mult, annual: 0 }
    byCycle[cycle].perInstallment += Number(l.amount) || 0
  }
  const cycles = Object.values(byCycle).map((c) => ({ ...c, annual: c.perInstallment * c.installments }))
  const order = ['one_time', 'monthly', 'quarterly', 'term', 'half_yearly', 'annual']
  cycles.sort((a, b) => order.indexOf(a.cycle) - order.indexOf(b.cycle))
  const annualTotal = cycles.reduce((s, c) => s + c.annual, 0)
  return { annualTotal, cycles }
}
