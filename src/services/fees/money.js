// Money core — all fee amounts are stored as INTEGER PAISE (1 rupee = 100 paise).
// Never do arithmetic on rupee floats. Convert user input at the edge with toPaise,
// render with fmtPaise, and only use fromPaise to seed a rupee-denominated <input>.

// Parse a user-typed rupee value (number or string like "1,28,500.50") into integer paise.
export const toPaise = (rupees) => {
  const n = typeof rupees === 'string' ? Number(rupees.replace(/[₹,\s]/g, '')) : Number(rupees)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

// Integer paise -> rupee number, for pre-filling a rupee input. Do NOT use for maths.
export const fromPaise = (paise) => (Number(paise) || 0) / 100

// Integer paise -> "₹1,28,500" (whole) or "₹1,28,500.50" (when paise are non-zero),
// grouped Indian-style.
export const fmtPaise = (paise) => {
  const p = Math.round(Number(paise) || 0)
  const hasPaise = p % 100 !== 0
  return '₹' + (p / 100).toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

// Percentage of a paise amount, rounded to whole paise (banker-free, half-up).
export const pctOfPaise = (paise, percent) => Math.round((Number(paise) || 0) * (Number(percent) || 0) / 100)
