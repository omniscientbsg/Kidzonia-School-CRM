// What people are asked at the end of their day.
//
// Before this there was ONE hardcoded question — "Anything your manager should
// know?" — for every person in every school. A bus driver, a teacher and the
// office manager all got the same box, so the reports were unusable as anything
// but free text.
//
// SCOPE IS A MATCH, NOT A TREE. A form names a school, a role, both, or neither,
// and the most specific match wins: this school AND this role, then this school,
// then this role anywhere, then the group-wide default. Nothing matching at all
// is the built-in single note, which is what every school had before.
//
// A form that names a ROLE gets its own generated template, because the question
// set is snapshotted onto every occurrence and one template cannot ask two
// different things. That is invisible here and deliberate.
import { useState } from 'react'
import {
  Stack, Group, Text, Title, Card, Table, Button, ActionIcon, Modal,
  TextInput, Textarea, Select, Badge, Loader, Alert, Checkbox,
} from '@mantine/core'
import { Plus, Pencil, Trash2, Info } from 'lucide-react'
import { useGet, useAct } from '../../../api/hooks'
import { useStore } from '../../../store/useStore'
import { useOrgTree, useOrgLevels } from '../../../services/org/api'
import { flattenTree } from '../../../services/org/tree'
import { QuestionListEditor } from '../../tasks/CompletionEditor'
import { blankQuestion } from '../../../services/tasks/conditions'

const MANAGE_ROLES = ['super_admin', 'branch_admin', 'hq_coordinator', 'school_owner']

const blank = () => ({
  name: '',
  nodeId: null,
  levelId: null,
  statement: '',
  questions: [blankQuestion('text')],
  active: true,
})

function EditModal({ row, onClose, nodes, levels }) {
  const editing = !!row
  const act = useAct(['/day-end-forms'])
  const [form, setForm] = useState(() => (row ? { ...blank(), ...row } : blank()))
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const ready = form.name.trim() && form.questions.length
    && form.questions.every((q) => (q.prompt || '').trim())

  const save = () => act.mutate({
    method: editing ? 'put' : 'post',
    path: editing ? `/day-end-forms/${row.id}` : '/day-end-forms',
    body: form,
    success: editing ? 'Form saved' : 'Form created',
  }, { onSuccess: onClose })

  return (
    <Modal opened onClose={onClose} size="lg" title={editing ? `Edit “${row.name}”` : 'New day-end form'}>
      <Stack gap="md">
        <TextInput
          label="Name" required placeholder="e.g. Teaching staff — end of day"
          description="Only ever seen here. The people filling it in see the questions."
          value={form.name} onChange={(e) => set({ name: e.currentTarget.value })}
        />

        <Group grow align="flex-start">
          <Select
            label="Which school" placeholder="Every school" clearable searchable
            data={nodes} value={form.nodeId} onChange={(v) => set({ nodeId: v })}
          />
          <Select
            label="Which role" placeholder="Every role" clearable searchable
            data={levels} value={form.levelId} onChange={(v) => set({ levelId: v })}
          />
        </Group>
        <Alert variant="light" color="ink" icon={<Info size={15} />} p="xs">
          <Text size="xs">
            The most specific form wins: a school-and-role form beats a school one, which beats a
            role one, which beats the form that names neither. Leave both blank for the form
            everybody gets unless something more specific applies.
          </Text>
        </Alert>

        <Textarea
          label="A line above the questions" autosize minRows={2}
          placeholder="Your day, summarised for your reporting manager."
          value={form.statement || ''} onChange={(e) => set({ statement: e.currentTarget.value })}
        />

        <div>
          <Text size="sm" fw={600} mb={6}>What they are asked</Text>
          <Text size="xs" c="dimmed" mb="xs">
            The roll-up above these — what they finished, what is still open — is computed for them
            and cannot be typed over. These are the parts only they can answer.
          </Text>
          <QuestionListEditor
            questions={form.questions}
            onChange={(questions) => set({ questions })}
            emptyHint="A form with no questions cannot be filed. Add at least one."
          />
        </div>

        <Checkbox
          label="In use" checked={form.active !== false}
          description="Turn it off to stop it matching without deleting it — the reports already filed keep their own copy of the questions."
          onChange={(e) => set({ active: e.currentTarget.checked })}
        />

        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button loading={act.isPending} disabled={!ready} onClick={save}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

export default function DayEndForms() {
  const { data: rows = [], isLoading } = useGet('/day-end-forms')
  const { data: tree } = useOrgTree()
  const { data: levelRows = [] } = useOrgLevels()
  const act = useAct(['/day-end-forms'])
  const user = useStore((s) => s.user)
  const [editing, setEditing] = useState(null)
  const [confirm, setConfirm] = useState(null)

  const mayManage = MANAGE_ROLES.includes(user?.role)
  const { flat } = flattenTree(tree?.tree)
  const nodes = flat.map((n) => ({ value: n.id, label: n.name }))
  const levels = levelRows.map((l) => ({ value: l.id, label: l.name }))
  const nameOf = (list_, id) => list_.find((x) => x.value === id)?.label

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>Day-end report forms</Title>
          <Text size="sm" c="dimmed" maw={640}>
            The questions people answer when they file their day-end report, on top of the roll-up
            the system computes for them. A school with no form of its own gets a single
            “anything your manager should know?” box.
          </Text>
        </div>
        {mayManage && (
          <Button leftSection={<Plus size={15} />} onClick={() => setEditing(blank())}>New form</Button>
        )}
      </Group>

      {isLoading ? <Loader size="sm" /> : !rows.length ? (
        <Card withBorder padding="lg">
          <Text size="sm" c="dimmed">
            No forms yet — everybody gets the built-in single note. Add one to ask your teachers
            something different from your office staff.
          </Text>
        </Card>
      ) : (
        <Card withBorder padding={0}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>School</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Questions</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <b>{r.name}</b>
                    {r.active === false && <Badge ml={6} color="gray" variant="light">off</Badge>}
                  </Table.Td>
                  <Table.Td>{nameOf(nodes, r.nodeId) || <Text size="sm" c="dimmed">every school</Text>}</Table.Td>
                  <Table.Td>{nameOf(levels, r.levelId) || <Text size="sm" c="dimmed">every role</Text>}</Table.Td>
                  <Table.Td>{(r.questions || []).length}</Table.Td>
                  <Table.Td>
                    {mayManage && (
                      <Group gap={4} justify="flex-end">
                        <ActionIcon variant="subtle" color="ink" aria-label="Edit" onClick={() => setEditing(r)}>
                          <Pencil size={14} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="berry" aria-label="Delete" onClick={() => setConfirm(r)}>
                          <Trash2 size={14} />
                        </ActionIcon>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      {editing && (
        <EditModal
          row={editing.id ? editing : null}
          nodes={nodes} levels={levels}
          onClose={() => setEditing(null)}
        />
      )}

      {confirm && (
        <Modal opened onClose={() => setConfirm(null)} title={`Delete “${confirm.name}”?`}>
          <Stack gap="md">
            <Text size="sm">
              People it applied to fall back to the next form that matches, or to the built-in note.
              Reports already filed keep the questions they were asked.
            </Text>
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button color="berry" loading={act.isPending} onClick={() => act.mutate(
                { method: 'del', path: `/day-end-forms/${confirm.id}`, success: 'Form deleted' },
                { onSuccess: () => setConfirm(null), onError: () => setConfirm(null) },
              )}>Delete</Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  )
}
