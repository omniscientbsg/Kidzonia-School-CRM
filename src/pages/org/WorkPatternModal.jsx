// A person's working pattern: which days they work, when their day ends, and
// whether they are here at all.
//
// This is the first edit affordance the positions table has ever had — the only
// per-row action was "end position", and PUT /org/positions/:id had no caller.
//
// Working days and hours are on the POSITION, not the person, because one person
// can hold two positions at two schools with different weeks. Leaving a field
// blank means "same as the school", and the form says so rather than silently
// copying the school's values down — copying would freeze the fallback, so
// changing the school's week would stop reaching anyone.
import { useState } from 'react'
import {
  Modal, Stack, Group, Text, Button, Checkbox, Select, Alert, Divider, Badge,
} from '@mantine/core'
import { TimeInput } from '@mantine/dates'
import { Info } from 'lucide-react'
import { useOrgAct } from '../../services/org/api'

const DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 0, label: 'Sun' },
]

const STATUS = [
  { value: 'active', label: 'Working' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'left', label: 'Has left' },
]

export default function WorkPatternModal({ position, onClose }) {
  const act = useOrgAct()
  // `workWeekOwn` / `hoursOwn` are what THEY set; `workWeek` / `hours` are those
  // resolved through the school. Editing the former, showing the latter.
  const [ownWeek, setOwnWeek] = useState(position.workWeekOwn)
  const [ownHours, setOwnHours] = useState(position.hoursOwn || {})
  const [status, setStatus] = useState(position.status || 'active')

  const inheritedWeek = position.workWeek || []
  const week = ownWeek ?? inheritedWeek
  const usingOwnWeek = ownWeek !== null && ownWeek !== undefined
  const usingOwnHours = Object.keys(ownHours).length > 0

  const toggleDay = (n) => {
    const base = usingOwnWeek ? ownWeek : inheritedWeek
    setOwnWeek(base.includes(n) ? base.filter((d) => d !== n) : [...base, n].sort((a, b) => a - b))
  }
  const setHour = (n, key, value) =>
    setOwnHours((h) => ({ ...h, [String(n)]: { ...(h[String(n)] || { from: '09:00', to: '17:00' }), [key]: value } }))
  const clearHour = (n) => setOwnHours((h) => { const next = { ...h }; delete next[String(n)]; return next })

  const save = () => act.mutate({
    method: 'put',
    path: `/org/positions/${position.id}`,
    body: {
      workWeek: usingOwnWeek ? ownWeek : null,
      hours: usingOwnHours ? ownHours : null,
      status,
    },
    success: `${position.userName}'s working pattern saved`,
  }, { onSuccess: onClose })

  return (
    <Modal opened onClose={onClose} size="lg" title={`${position.userName} — ${position.tier} at ${position.nodeName}`}>
      <Stack gap="md">
        <Select label="Employment" data={STATUS} value={status} onChange={(v) => setStatus(v || 'active')}
          description={
            status === 'on_leave'
              ? 'Still in the org chart and still assignable — they simply are not in today. Vanishing from every downline and roll-up without warning is worse than being visible and away.'
              : status === 'left'
                ? 'Stops matching every kind of task target. Past work keeps pointing at them.'
                : undefined
          } />

        <Divider label="Working days" labelPosition="left" />
        <Group gap={6}>
          {DAYS.map((d) => (
            <Button key={d.n} size="compact-sm"
              variant={week.includes(d.n) ? 'filled' : 'default'}
              onClick={() => toggleDay(d.n)}>
              {d.label}
            </Button>
          ))}
        </Group>
        {usingOwnWeek ? (
          <Group gap="xs">
            <Badge color="marmalade" variant="light">their own</Badge>
            <Button size="compact-xs" variant="subtle" onClick={() => setOwnWeek(null)}>
              Use the school’s week instead
            </Button>
          </Group>
        ) : (
          <Text size="xs" c="dimmed">Same as {position.nodeName}. Change a day and it becomes theirs.</Text>
        )}

        <Divider label="Working hours" labelPosition="left" />
        <Text size="xs" c="dimmed">
          A task due “by end of their day” is due when their shift ends. Leave a day blank and it
          falls back to the end of the calendar day.
        </Text>
        <Stack gap={6}>
          {DAYS.filter((d) => week.includes(d.n)).map((d) => {
            const slot = ownHours[String(d.n)]
            return (
              <Group key={d.n} gap="sm" wrap="nowrap">
                <Text size="sm" w={36}>{d.label}</Text>
                <TimeInput size="xs" w={110} value={slot?.from || ''} placeholder="from"
                  onChange={(e) => setHour(d.n, 'from', e.currentTarget.value)} />
                <TimeInput size="xs" w={110} value={slot?.to || ''} placeholder="to"
                  onChange={(e) => setHour(d.n, 'to', e.currentTarget.value)} />
                {slot && (
                  <Button size="compact-xs" variant="subtle" color="ink" onClick={() => clearHour(d.n)}>clear</Button>
                )}
              </Group>
            )
          })}
        </Stack>

        <Alert variant="light" color="ink" icon={<Info size={15} />} p="xs">
          <Text size="xs">
            A shift cannot cross midnight — the deadline has to land on the same day the task is for,
            which the logout gate and the day-end report both rely on.
          </Text>
        </Alert>

        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button loading={act.isPending} onClick={save}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
