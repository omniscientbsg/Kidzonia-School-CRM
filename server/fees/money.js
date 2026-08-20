// Money core (server) — all fee amounts are stored as INTEGER PAISE (1 rupee = 100 paise).
// Keep this in sync with src/services/fees/money.js.

// Parse a rupee value (number or string) into integer paise.
export const toPaise = (rupees) => {
  const n = typeof rupees === 'string' ? Number(rupees.replace(/[₹,\s]/g, '')) : Number(rupees)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

// Integer paise -> rupee number (display/seed convenience only, not for maths).
export const fromPaise = (paise) => (Number(paise) || 0) / 100

// Integer paise -> "₹1,28,500" / "₹1,28,500.50", grouped Indian-style. For notifications/reports.
export const fmtPaise = (paise) => {
  const p = Math.round(Number(paise) || 0)
  const hasPaise = p % 100 !== 0
  return '₹' + (p / 100).toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

// Percentage of a paise amount, rounded to whole paise.
export const pctOfPaise = (paise, percent) => Math.round((Number(paise) || 0) * (Number(percent) || 0) / 100)

// Seed helper: whole/rupee literal -> integer paise. Keeps seed data readable.
export const rupees = (r) => Math.round((Number(r) || 0) * 100)
