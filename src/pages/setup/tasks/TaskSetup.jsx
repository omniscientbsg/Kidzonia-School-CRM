// Task setup — the master data the Tasks module runs on.
//
// Until now none of this had a screen at all: categories could only be read by
// the assign form, and escalationPolicies had zero rows because there was no way
// to write one. Every screen here is the same MasterScreen with a different field
// spec, except escalation policies, whose stages need their own editor.
import { NavLink, Outlet } from 'react-router-dom'
import { Stack, Title, Text } from '@mantine/core'
import MasterScreen from './MasterScreen'

const SUB_NAV = [
  { to: '/setup/task-setup', text: 'Categories', end: true },
  { to: '/setup/task-setup/priorities', text: 'Priorities' },
  { to: '/setup/task-setup/tags', text: 'Tags' },
  { to: '/setup/task-setup/templates', text: 'Task templates' },
  { to: '/setup/task-setup/day-end-forms', text: 'Day-end report forms' },
  { to: '/setup/task-setup/escalation', text: 'Escalation policies' },
]

export function TaskSetupLayout() {
  return (
    <Stack gap="md">
      <div className="tabs">
        {SUB_NAV.map((s) => (
          <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {s.text}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </Stack>
  )
}

export function TaskCategories() {
  return (
    <MasterScreen
      path="/task-categories"
      title="Categories"
      blurb="What kind of work a task is. A category can also carry a default escalation policy."
      fields={[
        { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Compliance' },
        { name: 'color', label: 'Colour', type: 'color', default: '#f4772e' },
      ]}
      columns={['name', 'color']}
      emptyText="No categories yet. They are optional — a task without one still works."
    />
  )
}

export function TaskPriorities() {
  return (
    <MasterScreen
      path="/task-priorities"
      title="Priorities"
      blurb="Lower order is more urgent. Everything that sorts “worst first” reads this number, never the name — so renaming one never reorders anything."
      fields={[
        { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Urgent' },
        { name: 'rank', label: 'Order', type: 'number', min: 0, max: 999, default: 50, help: 'Lower comes first. The four shipped ones are 10, 20, 30 and 40, so there is room between them.' },
        { name: 'color', label: 'Colour', type: 'color' },
        { name: 'isDefault', label: 'Use for new tasks', type: 'checkbox', help: 'The one a task gets when nobody picks. Only one should carry this.' },
      ]}
      columns={['name', 'rank', 'color', 'isDefault']}
      sort={(a, b) => (a.rank ?? 999) - (b.rank ?? 999)}
      deleteWarning="Tasks already using it keep the value they were saved with; it simply stops being offered. Do not remove the one marked “use for new tasks” without marking another first."
    />
  )
}

export function TaskTags() {
  return (
    <MasterScreen
      path="/task-tags"
      title="Tags"
      blurb="A controlled list on purpose. Free text becomes forty spellings of “compliance” inside a month."
      fields={[
        { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Parent-facing' },
        { name: 'color', label: 'Colour', type: 'color' },
      ]}
      columns={['name', 'color']}
      emptyText="No tags yet. Add one and it appears in the assign form."
    />
  )
}

export function TaskTemplates() {
  return (
    <Stack gap="md">
      <MasterScreen
        path="/task-templates"
        title="Task templates"
        blurb="A saved blueprint. Nobody is assigned and nothing is generated until somebody applies one — and applying COPIES it, so editing a template never rewrites work already handed out."
        fields={[
          { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Daily attendance' },
          { name: 'description', label: 'What it is for', type: 'textarea' },
        ]}
        columns={['name', 'description']}
        emptyText="No templates yet. Save one from the assign form with “Save as template”."
        deleteWarning="Only the blueprint goes. Tasks built from it are untouched — there is no live link."
      />
      <Text size="sm" c="dimmed">
        Templates are created from the assign form, not here — this screen is for renaming and
        removing them.
      </Text>
    </Stack>
  )
}

export function DayEndForms() {
  return (
    <Stack gap="md">
      <Title order={2}>Day-end report forms</Title>
      <Text size="sm" c="dimmed">
        The questions people answer when they file their day-end report, on top of the roll-up the
        system computes for them. The question editor arrives with the completion rework; until then
        every node uses the built-in single-note form.
      </Text>
    </Stack>
  )
}
