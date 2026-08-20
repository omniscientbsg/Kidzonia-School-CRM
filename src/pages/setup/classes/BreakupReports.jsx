import { useState, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FileSpreadsheet, FileText, Percent } from 'lucide-react'
import { useGet } from '../../../api/hooks'
import { Spinner, Empty } from '../../../components/ui'
import { useStore } from '../../../store/useStore'
import { exportExcel, exportPDF } from '../../../lib/export'

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

// three <td> for a boys/girls/total triple; optional muted % under the total
function Triple({ t, sub }) {
  return (
    <>
      <td style={{ textAlign: 'center' }}>{t.boys}</td>
      <td style={{ textAlign: 'center' }}>{t.girls}</td>
      <td style={{ textAlign: 'center', fontWeight: 700, borderRight: '1px solid var(--line)' }}>
        {t.total}
        {sub != null && <div className="muted" style={{ fontSize: 10.5, fontWeight: 400 }}>{sub}</div>}
      </td>
    </>
  )
}

// grouped header: one label spanning Boys/Girls/Total
function GroupHead({ label }) {
  return <th colSpan={3} style={{ textAlign: 'center', borderRight: '1px solid var(--line)' }}>{label}</th>
}
function SubHead({ n }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <Fragment key={i}>
          <th style={{ textAlign: 'center', fontWeight: 600 }}>B</th>
          <th style={{ textAlign: 'center', fontWeight: 600 }}>G</th>
          <th style={{ textAlign: 'center', fontWeight: 600, borderRight: '1px solid var(--line)' }}>T</th>
        </Fragment>
      ))}
    </>
  )
}

function ReportCard({ title, onExcel, onPdf, children }) {
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-title">
        <h3>{title}</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn sm ghost" onClick={onExcel}><FileSpreadsheet size={13} /> Excel</button>
          <button className="btn sm ghost" onClick={onPdf}><FileText size={13} /> PDF</button>
        </div>
      </div>
      <div className="table-wrap" style={{ boxShadow: 'none' }}>{children}</div>
    </div>
  )
}

export default function BreakupReports() {
  const navigate = useNavigate()
  const { activeSessionId } = useStore()
  const { data: sessions = [] } = useGet('/academic-years')
  const [sessionId, setSessionId] = useState(activeSessionId || '')
  const [showPct, setShowPct] = useState(false)

  const path = `/reports/student-breakup${sessionId ? `?sessionId=${sessionId}` : ''}`
  const { data, isLoading, isError, error } = useGet(path)

  const nonArchived = sessions.filter((s) => !s.archived)

  const header = (
    <div className="page-head">
      <h1 style={{ fontSize: 18 }}>Student Breakup</h1>
      <div className="filters">
        <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          <option value="">Active session</option>
          {nonArchived.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? ' (active)' : ''}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={showPct} onChange={(e) => setShowPct(e.target.checked)} /> <Percent size={13} /> Show %
        </label>
      </div>
      <div className="spacer" />
      <button className="btn sm ghost" onClick={() => navigate('/setup/classes')}><ArrowLeft size={13} /> Back</button>
    </div>
  )

  if (isLoading) return <div>{header}<Spinner /></div>
  if (isError) return <div>{header}<div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load report'} /></div></div>
  if (!data?.session) return <div>{header}<div className="card"><Empty emoji="📊" text="No active session to report on" /></div></div>

  const { rows, totals, categories, ageBands, session } = data
  const allRows = [...rows, totals]

  // ---- flatten helpers for export ----
  const t1cols = [{ key: 'className', label: 'Class' }, { key: 'sB', label: 'Strength B' }, { key: 'sG', label: 'Strength G' }, { key: 'sT', label: 'Strength T' }, { key: 'eB', label: 'EWS B' }, { key: 'eG', label: 'EWS G' }, { key: 'eT', label: 'EWS T' }]
  const t1rows = allRows.map((r) => ({ className: r.className, sB: r.strength.boys, sG: r.strength.girls, sT: r.strength.total, eB: r.ews.boys, eG: r.ews.girls, eT: r.ews.total }))

  const t2cols = [{ key: 'className', label: 'Class' }, ...categories.flatMap((c) => [{ key: `${c}_b`, label: `${c} B` }, { key: `${c}_g`, label: `${c} G` }, { key: `${c}_t`, label: `${c} T` }])]
  const t2rows = allRows.map((r) => { const o = { className: r.className }; for (const c of categories) { o[`${c}_b`] = r.categories[c].boys; o[`${c}_g`] = r.categories[c].girls; o[`${c}_t`] = r.categories[c].total } return o })

  const t3cols = [{ key: 'className', label: 'Class' }, ...ageBands.flatMap((b) => [{ key: `${b}_b`, label: `${b} B` }, { key: `${b}_g`, label: `${b} G` }, { key: `${b}_t`, label: `${b} T` }]), { key: 'sn', label: 'Special Needs' }]
  const t3rows = allRows.map((r) => { const o = { className: r.className }; for (const b of ageBands) { o[`${b}_b`] = r.ageBands[b].boys; o[`${b}_g`] = r.ageBands[b].girls; o[`${b}_t`] = r.ageBands[b].total } o.sn = r.specialNeeds.total; return o })

  const fname = (t) => `${t}_${session.name}`.replace(/\s+/g, '_')

  const TotalRowStyle = { fontWeight: 800, background: 'var(--marmalade-soft)' }

  return (
    <div>
      {header}

      {/* Table 1 — Total Strength & EWS */}
      <ReportCard
        title="Total Strength & EWS"
        onExcel={() => exportExcel(fname('strength_ews'), `Total Strength & EWS — ${session.name}`, t1cols, t1rows)}
        onPdf={() => exportPDF(`Total Strength & EWS — ${session.name}`, t1cols, t1rows)}
      >
        <table>
          <thead>
            <tr><th rowSpan={2} style={{ borderRight: '1px solid var(--line)' }}>Class Name</th><GroupHead label="Total Strength" /><GroupHead label="EWS" /></tr>
            <tr><SubHead n={2} /></tr>
          </thead>
          <tbody>
            {allRows.map((r) => (
              <tr key={r.classId || 'total'} style={r.classId ? undefined : TotalRowStyle}>
                <td style={{ borderRight: '1px solid var(--line)' }}>{r.className}</td>
                <Triple t={r.strength} sub={showPct ? `${pct(r.strength.girls, r.strength.total)}% girls` : null} />
                <Triple t={r.ews} sub={showPct ? `${pct(r.ews.total, r.strength.total)}% EWS` : null} />
              </tr>
            ))}
          </tbody>
        </table>
      </ReportCard>

      {/* Table 2 — Category Wise */}
      <ReportCard
        title="Category Wise"
        onExcel={() => exportExcel(fname('category_wise'), `Category Wise — ${session.name}`, t2cols, t2rows)}
        onPdf={() => exportPDF(`Category Wise — ${session.name}`, t2cols, t2rows)}
      >
        <table>
          <thead>
            <tr><th rowSpan={2} style={{ borderRight: '1px solid var(--line)' }}>Class Name</th>{categories.map((c) => <GroupHead key={c} label={c} />)}</tr>
            <tr><SubHead n={categories.length} /></tr>
          </thead>
          <tbody>
            {allRows.map((r) => (
              <tr key={r.classId || 'total'} style={r.classId ? undefined : TotalRowStyle}>
                <td style={{ borderRight: '1px solid var(--line)' }}>{r.className}</td>
                {categories.map((c) => <Triple key={c} t={r.categories[c]} sub={showPct ? `${pct(r.categories[c].total, r.strength.total)}%` : null} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </ReportCard>

      {/* Table 3 — Age Band & Special Needs (improvement) */}
      <ReportCard
        title="Age Band & Special Needs"
        onExcel={() => exportExcel(fname('age_band'), `Age Band & Special Needs — ${session.name}`, t3cols, t3rows)}
        onPdf={() => exportPDF(`Age Band & Special Needs — ${session.name}`, t3cols, t3rows)}
      >
        <table>
          <thead>
            <tr><th rowSpan={2} style={{ borderRight: '1px solid var(--line)' }}>Class Name</th>{ageBands.map((b) => <GroupHead key={b} label={`${b}y`} />)}<th rowSpan={2} style={{ textAlign: 'center' }}>Special Needs</th></tr>
            <tr><SubHead n={ageBands.length} /></tr>
          </thead>
          <tbody>
            {allRows.map((r) => (
              <tr key={r.classId || 'total'} style={r.classId ? undefined : TotalRowStyle}>
                <td style={{ borderRight: '1px solid var(--line)' }}>{r.className}</td>
                {ageBands.map((b) => <Triple key={b} t={r.ageBands[b]} sub={showPct ? `${pct(r.ageBands[b].total, r.strength.total)}%` : null} />)}
                <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.specialNeeds.total}{showPct && <div className="muted" style={{ fontSize: 10.5, fontWeight: 400 }}>{pct(r.specialNeeds.total, r.strength.total)}%</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ReportCard>
    </div>
  )
}
