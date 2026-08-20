// Client-side export helpers: CSV, real .xlsx (SheetJS), Excel (.xls HTML), printable PDF.
// columns: [{ key, label }]; rows: array of objects.
import * as XLSX from 'xlsx'

// real .xlsx via SheetJS
export function exportXLSX(filename, columns, rows) {
  const data = rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, r[c.key]])))
  const ws = XLSX.utils.json_to_sheet(data, { header: columns.map((c) => c.label) })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Report')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const esc = (v) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportCSV(filename, columns, rows) {
  const header = columns.map((c) => esc(c.label)).join(',')
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\n')
  // BOM so Excel reads UTF-8 correctly
  triggerDownload(`${filename}.csv`, new Blob(['﻿' + header + '\n' + body], { type: 'text/csv;charset=utf-8' }))
}

const htmlEsc = (v) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

function tableHTML(title, columns, rows) {
  const head = columns.map((c) => `<th>${htmlEsc(c.label)}</th>`).join('')
  const body = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${htmlEsc(r[c.key])}</td>`).join('')}</tr>`)
    .join('')
  return `<h2>${htmlEsc(title)}</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

// Excel via HTML table with an .xls extension — opens natively in Excel.
export function exportExcel(filename, title, columns, rows) {
  const html = `<html><head><meta charset="utf-8"></head><body>${tableHTML(title, columns, rows)}</body></html>`
  triggerDownload(`${filename}.xls`, new Blob([html], { type: 'application/vnd.ms-excel' }))
}

// PDF via a printable window — user chooses "Save as PDF" in the print dialog.
export function exportPDF(title, columns, rows) {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(`<html><head><title>${htmlEsc(title)}</title><style>
    body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#2b2b2b}
    h2{margin:0 0 12px}
    table{border-collapse:collapse;width:100%;font-size:13px}
    th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
    th{background:#f5efe6}
  </style></head><body>${tableHTML(title, columns, rows)}
  <scr` + `ipt>window.onload=function(){window.print()}</scr` + `ipt></body></html>`)
  w.document.close()
}
