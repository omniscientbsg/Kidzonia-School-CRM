// One screen for every task master.
//
// Categories, priorities and tags are the same screen with different columns, so
// they are one component driven by a field spec rather than three copies that
// drift. Written in Mantine because it is new surface — the rest of Setup is
// still on the hand-rolled classes and converting it is a separate job.
//
// The field spec drives BOTH the table and the form, which is the point: adding
// a column and forgetting the input is the bug this shape makes impossible.
import { useState } from 'react'
import {
  Stack, Group, Text, Title, Card, Table, Button, ActionIcon, Modal,
  TextInput, NumberInput, Checkbox, ColorInput, Textarea, Badge, Loader, Alert,
} from '@mantine/core'
import { Plus, Pencil, Trash2, Info } from 'lucide-react'
import { useGet, useAct } from '../../../api/hooks'
import { useStore } from '../../../store/useStore'

const MANAGE_ROLES = ['super_admin', 'branch_admin', 'hq_coordinator', 'school_owner']

function Field({ field, value, onChange }) {
  const common = { label: field.label, description: field.help, required: field.required }
  if (field.type === 'number') {
    return <NumberInput {...common} min={field.min} max={field.max} value={value ?? ''} onChange={onChange} />
  }
  if (field.type === 'checkbox') {
    return <Checkbox label={field.label} description={field.help} checked={!!value} onChange={(e) => onChange(e.currentTarget.checked)} />
  }
  if (field.type === 'color') {
    return <ColorInput {...common} format="hex" swatches={['#e5484d', '#f4772e', '#f5b93c', '#12907e', '#3b76d0', '#5b4a99', '#8b84a3']} value={value || ''} onChange={onChange} />
  }
  if (field.type === 'textarea') {
    return <Textarea {...common} autosize minRows={2} value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value)} />
  }
  return <TextInput {...common} placeholder={field.placeholder} value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value)} />
}

function EditModal({ row, fields, path, title, onClose }) {
  const editing = !!row
  const act = useAct([path])
  const [form, setForm] = useState(() =>
    Object.fromEntries(fields.map((f) => [f.name, row?.[f.name] ?? f.default ?? (f.type === 'checkbox' ? false : '')])))
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const missing = fields.filter((f) => f.required && !String(form[f.name] ?? '').trim())
  const save = () => {
    const body = { ...form, active: row?.active ?? true }
    if (editing) act.mutate({ method: 'put', path: `${path}/${row.id}`, body, success: `${title} updated` }, { onSuccess: onClose })
    else act.mutate({ path, body, success: `${title} added` }, { onSuccess: onClose })
  }

  return (
    <Modal opened onClose={onClose} title={editing ? `Edit ${title.toLowerCase()}` : `Add ${title.toLowerCase()}`}>
      <Stack gap="sm">
        {fields.map((f) => (
          <Field key={f.name} field={f} value={form[f.name]} onChange={(v) => set(f.name, v)} />
        ))}
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button disabled={missing.length > 0} loading={act.isPending} onClick={save}>
            {editing ? 'Save' : 'Add'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

export default function MasterScreen({
  path, title, blurb, fields, columns, sort, emptyText, renderCell, deleteWarning,
}) {
  const { user } = useStore()
  const canManage = MANAGE_ROLES.includes(user?.role)
  const { data: rows = [], isLoading, isError, error } = useGet(path)
  const act = useAct([path])
  const [modal, setModal] = useState(null)     // { row } | {}
  const [confirm, setConfirm] = useState(null)

  if (isLoading) return <Loader />
  if (isError) {
    return <Alert color="berry" icon={<Info size={16} />}>{error?.message || `Could not load ${title.toLowerCase()}`}</Alert>
  }

  const ordered = sort ? [...rows].sort(sort) : [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const cols = columns || fields.map((f) => f.name)

  const cell = (row, name) => {
    if (renderCell) {
      const custom = renderCell(row, name)
      if (custom !== undefined) return custom
    }
    const v = row[name]
    if (typeof v === 'boolean') return v ? <Badge color="teal" variant="light">yes</Badge> : <Text size="sm" c="dimmed">—</Text>
    if (v === null || v === undefined || v === '') return <Text size="sm" c="dimmed">—</Text>
    if (name === 'color') {
      return (
        <Group gap={6}>
          <span style={{ width: 13, height: 13, borderRadius: 4, background: v, display: 'inline-block' }} />
          <Text size="sm" ff="monospace">{v}</Text>
        </Group>
      )
    }
    return <Text size="sm">{String(v)}</Text>
  }

  const labelOf = (name) => fields.find((f) => f.name === name)?.label || name

  return (
    <Stack gap="md">
      <Group align="flex-start" wrap="nowrap">
        <div style={{ flex: 1 }}>
          <Title order={2}>{title}</Title>
          {blurb && <Text size="sm" c="dimmed" mt={2}>{blurb}</Text>}
        </div>
        {canManage && (
          <Button leftSection={<Plus size={15} />} onClick={() => setModal({})}>Add</Button>
        )}
      </Group>

      {ordered.length === 0 ? (
        <Card withBorder padding="lg"><Text c="dimmed" ta="center">{emptyText || `No ${title.toLowerCase()} yet`}</Text></Card>
      ) : (
        <Card withBorder padding={0}>
          <Table.ScrollContainer minWidth={480}>
            <Table verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  {cols.map((c) => <Table.Th key={c}>{labelOf(c)}</Table.Th>)}
                  {canManage && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {ordered.map((row) => (
                  <Table.Tr key={row.id}>
                    {cols.map((c) => <Table.Td key={c}>{cell(row, c)}</Table.Td>)}
                    {canManage && (
                      <Table.Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <ActionIcon variant="subtle" color="ink" aria-label="Edit" onClick={() => setModal({ row })}>
                          <Pencil size={14} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="berry" aria-label="Remove" ml={4} onClick={() => setConfirm(row)}>
                          <Trash2 size={14} />
                        </ActionIcon>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}

      {modal && (
        <EditModal row={modal.row} fields={fields} path={path} title={title.replace(/s$/, '')} onClose={() => setModal(null)} />
      )}

      <Modal opened={!!confirm} onClose={() => setConfirm(null)} title={`Remove “${confirm?.name}”?`}>
        <Stack gap="sm">
          <Text size="sm">
            {deleteWarning || 'It is soft-deleted, so nothing that already refers to it changes. It just stops being offered.'}
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button color="berry" loading={act.isPending}
              onClick={() => act.mutate({ method: 'del', path: `${path}/${confirm.id}`, success: 'Removed' }, { onSuccess: () => setConfirm(null) })}>
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
