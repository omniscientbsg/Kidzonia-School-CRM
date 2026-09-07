import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ComposedChart, Line, Legend,
} from 'recharts'
import {
  Stack, Group, Text, Card, Badge, Button, Select, Alert, Loader, SimpleGrid,
  Table, Progress, ScrollArea,
} from '@mantine/core'
import { Download, Flame, Lock, Clock, TrendingUp, AlertTriangle } from 'lucide-react'
import { fmtDateTime } from '../../api/hooks'
import { exportCSV, exportXLSX, exportPDF } from '../../lib/export'
import { useAnalytics } from '../../services/tasks/api'
import { STATUS_LABEL } from '../../services/tasks/status'

const shift = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'This year']]
// 'rejected' is not a stored status — a rejection hands the work straight back
// as in_progress and the pill is derived — so filtering on it matched nothing.
const STATUS_FILTERS = ['assigned', 'in_progress', 'submitted', 'approved', 'overdue', 'deferred', 'cancelled', 'expired']

// One export control reused by every table on the page.
function Exports({ name, columns, rows }) {
  if (!rows.length) return null
  return (
    <Group gap={6} align="center">
      <Download size={13} style={{ color: 'var(--ink-faint)' }} />
      <Button size="compact-xs" variant="subtle" color="ink" onClick={() => exportCSV(name, columns, rows)}>CSV</Button>
      <Button size="compact-xs" variant="subtle" color="ink" onClick={() => exportXLSX(name, columns, rows)}>Excel</Button>
      <Button size="compact-xs" variant="subtle" color="ink" onClick={() => exportPDF(name, columns, rows)}>PDF</Button>
    </Group>
  )
}

const pctColor = (pct) => (pct >= 80 ? 'teal' : pct >= 50 ? 'marmalade' : 'berry')

function Bar100({ pct }) {
  return (
    <Group gap="xs" align="center" wrap="nowrap">
      <Progress value={pct} color={pctColor(pct)} size="sm" radius="xl" style={{ flex: 1, minWidth: 60 }} />
      <Text fw={700} size="xs">{pct}%</Text>
    </Group>
  )
}

// A number and what it counts. Not a bordered box each — a row of them above a
// page of bordered cards is a row of things to look past.
function Stat({ label, value, tone, sub }) {
  return (
    <div>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} size="xl" c={tone} style={{ fontFamily: 'var(--font-display)', lineHeight: 1.15 }}>{value}</Text>
      {sub && <Text size="xs" c="dimmed">{sub}</Text>}
    </div>
  )
}

const Stats = ({ children }) => (
  <Card withBorder padding="md">
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="lg">{children}</SimpleGrid>
  </Card>
)

const SectionLabel = ({ children }) => (
  <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: 0.4 }}>{children}</Text>
)

function RollupTable({ title, subtitle, rows, labelKey, labelHead, extraCols = [], exportName }) {
  const columns = [
    { key: labelKey, label: labelHead },
    ...extraCols,
    { key: 'total', label: 'Assigned' },
    { key: 'done', label: 'Done' },
    { key: 'open', label: 'Open' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'pct', label: 'Completion %' },
  ]
  return (
    <Card withBorder padding="md">
      <Group justify="space-between" wrap="wrap" mb="sm">
        <Group gap="xs" align="baseline">
          <Text fw={700} size="sm">{title}</Text>
          {subtitle && <Text size="xs" c="dimmed">{subtitle}</Text>}
        </Group>
        <Exports name={exportName} columns={columns} rows={rows} />
      </Group>
      {!rows.length ? <Text size="sm" c="dimmed">Nothing in this range.</Text> : (
        <ScrollArea type="auto">
          <Table striped highlightOnHover miw={640}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{labelHead}</Table.Th>
                {extraCols.map((c) => <Table.Th key={c.key}>{c.label}</Table.Th>)}
                <Table.Th>Assigned</Table.Th><Table.Th>Done</Table.Th><Table.Th>Open</Table.Th>
                <Table.Th>Overdue</Table.Th><Table.Th>Closed</Table.Th><Table.Th>Completion</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r, i) => (
                <Table.Tr key={r[labelKey] + i}>
                  <Table.Td><Text fw={700} size="sm">{r[labelKey]}</Text></Table.Td>
                  {extraCols.map((c) => <Table.Td key={c.key}><Text size="sm" c="dimmed">{r[c.key]}</Text></Table.Td>)}
                  <Table.Td>{r.total}</Table.Td>
                  <Table.Td>{r.done}</Table.Td>
                  <Table.Td>{r.open || '—'}</Table.Td>
                  <Table.Td>{r.overdue ? <Badge size="sm" variant="light" color="berry">{r.overdue}</Badge> : '—'}</Table.Td>
                  {/* closed without being done — out of the completion denominator,
                      so it needs a column of its own or it vanishes entirely */}
                  <Table.Td>{r.expired ? <Badge size="sm" variant="light" color="plum">{r.expired}</Badge> : '—'}</Table.Td>
                  <Table.Td miw={130}><Bar100 pct={r.pct} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Card>
  )
}

export default function TaskReports() {
  const [range, setRange] = useState('30')
  const [nodeId, setNodeId] = useState('')
  const [levelId, setLevelId] = useState('')
  const [status, setStatus] = useState('')
  const [recurring, setRecurring] = useState('')
  const today = new Date().toISOString().slice(0, 10)

  const { data, isLoading, isError, error } = useAnalytics({
    from: shift(Number(range)), to: today, nodeId, levelId, status, recurring,
  })

  if (isLoading) return <Loader size="sm" />
  if (isError) {
    return (
      <Alert color="berry" variant="light" icon={<AlertTriangle size={17} />}>
        {error?.message || 'Could not load the dashboard'}
      </Alert>
    )
  }

  const { me, team, scope, approvalTurnaround: turn, blockedNow = [], series = [] } = data
  const hasTeam = team.total > 0 || scope.canSeeTeam

  const nodeOptions = scope.nodes.map((n) => ({
    value: n.id, label: `${'— '.repeat(n.depth)}${n.name}${n.isFranchise ? ' (franchise)' : ''}`,
  }))

  return (
    <Stack gap="md">
      <Group gap="xs" wrap="wrap">
        <Select size="xs" w={150} value={range} onChange={(v) => setRange(v || '30')}
          data={RANGES.map(([v, l]) => ({ value: v, label: l }))} allowDeselect={false} />
        <Select size="xs" w={230} value={nodeId || null} onChange={(v) => setNodeId(v || '')}
          placeholder="All schools / nodes you can see" clearable searchable data={nodeOptions} />
        <Select size="xs" w={160} value={levelId || null} onChange={(v) => setLevelId(v || '')}
          placeholder="All role-tiers" clearable
          data={scope.tiers.map((l) => ({ value: l.id, label: l.name }))} />
        <Select size="xs" w={160} value={status || null} onChange={(v) => setStatus(v || '')}
          placeholder="All statuses" clearable
          data={STATUS_FILTERS.map((v) => ({ value: v, label: STATUS_LABEL[v] }))} />
        <Select size="xs" w={180} value={recurring || null} onChange={(v) => setRecurring(v || '')}
          placeholder="Recurring + one-off" clearable
          data={[{ value: 'true', label: 'Recurring only' }, { value: 'false', label: 'One-off only' }]} />
      </Group>

      {/* ---------------- assignee view: always shown ---------------- */}
      <SectionLabel>Your own work</SectionLabel>
      <Stats>
        <Stat label="Your completion" value={`${me.completionPct}%`}
          sub={`${me.done} of ${me.total - (me.total - me.done - me.open - me.awaitingApproval)} closed`}
          tone={me.completionPct >= 80 ? 'teal' : 'marmalade'} />
        <Stat label="Overdue" value={me.overdue} tone={me.overdue ? 'berry' : 'teal'} />
        <Stat label="Current streak" value={`${me.streak.current} ${me.streak.current === 1 ? 'day' : 'days'}`}
          sub={`best ${me.streak.longest} · ${me.streak.daysTracked} days tracked`} tone="marmalade" />
        <Stat label="Awaiting approval" value={me.awaitingApproval} tone="yellow" />
      </Stats>

      {me.streak.current >= 3 && (
        <Alert variant="light" color="marmalade" icon={<Flame size={16} />} p="xs">
          <Text size="sm"><b>{me.streak.current}-day streak</b> — every task closed on the day it was due.</Text>
        </Alert>
      )}
      {me.blockingOpen > 0 && (
        <Alert variant="light" color="berry" icon={<Lock size={16} />} p="xs">
          <Text size="sm">
            {me.blockingOpen} mandatory task{me.blockingOpen > 1 ? 's' : ''} still open — your logout is blocked.
          </Text>
        </Alert>
      )}

      {series.length > 1 && (
        <Card withBorder padding="md">
          <Group justify="space-between" wrap="wrap" mb="sm">
            <Group gap="xs" align="baseline">
              <Text fw={700} size="sm">Completion over time</Text>
              <Text size="xs" c="dimmed">{data.range.from} → {data.range.to} · {data.range.timezone}</Text>
            </Group>
            <Exports
              name="task-completion-over-time"
              columns={[{ key: 'date', label: 'Date' }, { key: 'assigned', label: 'Assigned' }, { key: 'done', label: 'Done' }, { key: 'open', label: 'Open' }, { key: 'overdue', label: 'Overdue' }, { key: 'pct', label: 'Completion %' }]}
              rows={series}
            />
          </Group>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="done" name="Done" stackId="a" fill="#12907e" />
                <Bar yAxisId="left" dataKey="open" name="Open" stackId="a" fill="#f4772e" />
                <Bar yAxisId="left" dataKey="overdue" name="Overdue" stackId="a" fill="#e5484d" radius={[5, 5, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="pct" name="Completion %" stroke="#5b4a99" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ---------------- manager / HQ view ---------------- */}
      {!hasTeam ? (
        <Card withBorder padding="lg">
          <Text ta="center" c="dimmed">You have nobody below you, so there is no team roll-up to show.</Text>
        </Card>
      ) : (
        <>
          <SectionLabel>
            Your downline {nodeId ? '· filtered to one node' : `· ${scope.nodes.length} node${scope.nodes.length === 1 ? '' : 's'}`}
          </SectionLabel>
          <Stats>
            <Stat label="Team completion" value={`${team.completionPct}%`} sub={`${team.done} of ${team.total}`}
              tone={team.completionPct >= 80 ? 'teal' : 'marmalade'} />
            <Stat label="Open" value={team.open} tone="yellow" />
            <Stat label="Overdue" value={team.overdue} tone={team.overdue ? 'berry' : 'teal'} />
            <Stat label="Blocked right now" value={blockedNow.filter((b) => !b.isSelf).length}
              tone={blockedNow.length ? 'berry' : 'teal'} />
          </Stats>

          {blockedNow.length > 0 && (
            <Card withBorder padding="md">
              <Group justify="space-between" wrap="wrap" mb="sm">
                <Group gap="xs" align="baseline">
                  <Text fw={700} size="sm">Who is blocked right now</Text>
                  <Text size="xs" c="dimmed">open mandatory work due today or earlier</Text>
                </Group>
                <Exports
                  name="blocked-now"
                  columns={[{ key: 'userName', label: 'Person' }, { key: 'tier', label: 'Tier' }, { key: 'nodeName', label: 'School' }, { key: 'count', label: 'Tasks' }, { key: 'oldestDate', label: 'Oldest' }, { key: 'daysStuck', label: 'Days' }, { key: 'state', label: 'State' }]}
                  rows={blockedNow.map((b) => ({ ...b, state: b.armed ? 'writes frozen' : 'logout blocked' }))}
                />
              </Group>
              <ScrollArea type="auto">
                <Table striped highlightOnHover miw={620}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Person</Table.Th><Table.Th>Tier</Table.Th><Table.Th>School</Table.Th>
                      <Table.Th>Tasks</Table.Th><Table.Th>Oldest</Table.Th><Table.Th>State</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {blockedNow.map((b) => (
                      <Table.Tr key={b.userId}>
                        <Table.Td>
                          <Group gap={6} align="center">
                            <Text fw={700} size="sm">{b.userName}</Text>
                            {b.isSelf && <Badge size="sm" variant="light" color="plum">you</Badge>}
                          </Group>
                          <Text size="xs" c="dimmed">{b.titles.join(' · ')}</Text>
                        </Table.Td>
                        <Table.Td>{b.tier}</Table.Td>
                        <Table.Td>{b.nodeName}</Table.Td>
                        <Table.Td>{b.count}</Table.Td>
                        <Table.Td><Text size="sm" c="dimmed">{b.oldestDate}{b.daysStuck > 0 ? ` (${b.daysStuck}d)` : ''}</Text></Table.Td>
                        <Table.Td>
                          {b.armed
                            ? <Badge size="sm" variant="light" color="berry">writes frozen</Badge>
                            : <Badge size="sm" variant="light" color="yellow">logout blocked</Badge>}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Card>
          )}

          <Card withBorder padding="md">
            <Group justify="space-between" wrap="wrap" mb="sm">
              <Text fw={700} size="sm">Approval turnaround</Text>
              <Text size="xs" c="dimmed">submitted → decided</Text>
            </Group>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="lg" mb={turn.byApprover.length ? 'md' : 0}>
              <Stat label="Average" value={turn.avgHours != null ? `${turn.avgHours} h` : '—'} tone="sky"
                sub={`${turn.decisions} decisions`} />
              <Stat label="Median" value={turn.medianHours != null ? `${turn.medianHours} h` : '—'} />
              <Stat label="90th percentile" value={turn.p90Hours != null ? `${turn.p90Hours} h` : '—'} tone="yellow" />
              <Stat label="Waiting now" value={turn.pendingNow}
                tone={turn.pendingNow ? 'marmalade' : 'teal'}
                sub={turn.oldestPendingHours != null ? `oldest ${turn.oldestPendingHours} h` : ''} />
            </SimpleGrid>
            {turn.byApprover.length > 0 && (
              <ScrollArea type="auto">
                <Table striped highlightOnHover miw={620}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Approver</Table.Th><Table.Th>Decisions</Table.Th><Table.Th>Approved</Table.Th>
                      <Table.Th>Sent back</Table.Th><Table.Th>Overrides</Table.Th><Table.Th>Avg turnaround</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {turn.byApprover.map((a) => (
                      <Table.Tr key={a.userId}>
                        <Table.Td><Text fw={700} size="sm">{a.userName}</Text></Table.Td>
                        <Table.Td>{a.decisions}</Table.Td>
                        <Table.Td>{a.approved}</Table.Td>
                        <Table.Td>{a.rejected || '—'}</Table.Td>
                        <Table.Td>{a.overrides ? <Badge size="sm" variant="light" color="plum">{a.overrides}</Badge> : '—'}</Table.Td>
                        <Table.Td>
                          <Clock size={12} style={{ verticalAlign: -1, color: 'var(--ink-faint)' }} /> {a.avgHours} h
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )}
          </Card>

          {team.overdueLeaderboard.length > 0 && (
            <RollupTable
              title="Overdue leaderboard"
              subtitle="most overdue first"
              rows={team.overdueLeaderboard}
              labelKey="userName" labelHead="Person"
              extraCols={[{ key: 'tier', label: 'Tier' }, { key: 'nodeName', label: 'School' }]}
              exportName="task-overdue-leaderboard"
            />
          )}

          <RollupTable
            title="By school / node" rows={team.nodes}
            labelKey="nodeName" labelHead="Node"
            extraCols={[{ key: 'nodeType', label: 'Type' }, { key: 'depth', label: 'Level' }]}
            exportName="task-completion-by-node"
          />

          <RollupTable
            title="By role-tier" rows={team.tiers}
            labelKey="tier" labelHead="Tier"
            exportName="task-completion-by-tier"
          />

          <RollupTable
            title="By person" subtitle="lowest completion first" rows={team.people}
            labelKey="userName" labelHead="Person"
            extraCols={[{ key: 'tier', label: 'Tier' }, { key: 'nodeName', label: 'School' }]}
            exportName="task-completion-by-person"
          />

          <Group gap={6} align="center" mb={30}>
            <TrendingUp size={13} style={{ color: 'var(--ink-faint)' }} />
            <Text size="xs" c="dimmed">
              Roll-ups cover only people below you in the org tree. Generated {fmtDateTime(new Date().toISOString())}.
            </Text>
          </Group>
        </>
      )}
    </Stack>
  )
}
