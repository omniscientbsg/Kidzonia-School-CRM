import { Loader } from '@mantine/core';
import type { Home, NotificationGroup } from '@kidzonia/shared';
import {
  IconCheck,
  IconChecks,
  IconClock,
  IconHourglass,
  IconLock,
  IconMoon,
  IconRepeat,
} from '@tabler/icons-react';
import type { ComponentType } from 'react';
import { Link, useNavigate } from 'react-router';
import { SetupChecklist } from './SetupChecklist';
import { useHome, useMarkRead } from '../home/api';
import { useMeData } from '../shell/AppLayout';
import { NotificationItem, timeAgo } from '../shell/Bell';
import { NarrowedChip } from '../shell/SchoolSwitcher';
import { CopyRowButton, TaskDrawers } from '../tasks/TasksPage';
import { initialsOf, PersonCell, ProgressBar } from '../tasks/bits';
import { ErrorAlert } from '../ui/errors';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** The hour in the organisation's time zone, and the day as "Saturday, 26 September". */
function whenIn(timeZone: string, date: string) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(
      new Date(),
    ),
  );
  const d = new Date(`${date}T12:00:00Z`);
  const part = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o }).format(d);
  return {
    hour,
    label: `${part({ weekday: 'long' })}, ${part({ day: 'numeric', month: 'long' })}`,
  };
}

const ATTENTION_ICON: Record<string, ComponentType<{ size?: number }>> = {
  blocking: IconLock,
  approvals: IconChecks,
  team_overdue: IconClock,
  day_end: IconMoon,
  waiting_for_role: IconHourglass,
};

const pct = (p: { total: number; done: number; submitted: number }) =>
  p.total ? Math.round(((p.done + p.submitted) / p.total) * 100) : 0;
const barCls = (n: number) => (n >= 75 ? '' : n >= 50 ? 'warn' : 'bad');

function Attention({ home }: { home: Home }) {
  if (home.attention.length === 0) {
    return (
      <div className="banner info" role="status">
        <IconCheck size={20} aria-hidden="true" />
        Nothing needs your attention right now.
      </div>
    );
  }
  return (
    <div className="attn">
      {home.attention.slice(0, 4).map((a) => {
        const Icon = ATTENTION_ICON[a.key] ?? IconClock;
        return (
          <Link key={a.key} to={a.path} className={a.hot ? 'attn-card hot' : 'attn-card'}>
            <span className="attn-i">
              <Icon size={20} aria-hidden="true" />
            </span>
            <span className="attn-t">
              <b>{a.count}</b>
              <small>{a.label}</small>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function Schools({ home }: { home: Home }) {
  const navigate = useNavigate();
  const rows = [...(home.schools ?? [])].sort((a, b) => pct(a.progress) - pct(b.progress));
  return (
    <section className="panel" aria-labelledby="h-schools">
      <div className="panel-h">
        <h2 id="h-schools">Your schools</h2>
        <span className="small muted">Lowest first</span>
      </div>
      <div className="tbl-wrap">
        <table className="plain">
          <thead>
            <tr>
              <th scope="col">School</th>
              <th scope="col">Principal</th>
              <th scope="col">Tasks on track</th>
              <th scope="col">Overdue</th>
              <th scope="col">Day-end</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const p = pct(s.progress);
              return (
                <tr
                  key={s.id}
                  className="click"
                  onClick={() => void navigate(`/tasks/reports?schoolId=${s.id}`)}
                >
                  <td>
                    <Link to={`/tasks/reports?schoolId=${s.id}`} className="rowlink">
                      {s.name}
                    </Link>{' '}
                    <span className={`chip chip-${s.type}`}>
                      {s.type === 'coco' ? 'COCO' : 'Franchise'}
                    </span>
                  </td>
                  <td>{s.principal ?? <span className="muted">Not set</span>}</td>
                  <td>
                    <span className="row">
                      <span className={`bar ${barCls(p)}`} style={{ width: 90 }} aria-hidden="true">
                        <i style={{ width: `${String(p)}%` }} />
                      </span>
                      <span className="small">{p}%</span>
                    </span>
                  </td>
                  <td>
                    {s.progress.overdue ? (
                      <span className="chip st-overdue">{s.progress.overdue}</span>
                    ) : (
                      <span className="muted">None</span>
                    )}
                  </td>
                  <td>
                    {s.dayEnd.done}/{s.dayEnd.total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SetTasks({ home }: { home: Home }) {
  const items = home.setTasks ?? [];
  return (
    <section className="panel" aria-labelledby="h-set">
      <div className="panel-h">
        <h2 id="h-set">Tasks you’ve set</h2>
      </div>
      {items.length === 0 ? (
        <p className="empty">No tasks yet.</p>
      ) : (
        <div className="tlist">
          {items.map((t) => (
            <Link key={t.taskId} to={`/tasks/assigned?task=${t.taskId}`} className="trow set-row">
              <span className="tr-body">
                <span className="title">{t.title}</span>
                <span className="meta">
                  <span>
                    <IconRepeat size={14} aria-hidden="true" />
                    {t.repeat}
                  </span>
                </span>
              </span>
              <span className="by-school">
                {t.bySchool.map((s) => {
                  const p = s.total ? Math.round((s.done / s.total) * 100) : 0;
                  return (
                    <span key={s.schoolName} className="row small">
                      <span className="sname">{s.schoolName}</span>
                      <span className={`bar ${barCls(p)}`} style={{ width: 60 }} aria-hidden="true">
                        <i style={{ width: `${String(p)}%` }} />
                      </span>
                      <span className="muted">
                        {s.done}/{s.total}
                      </span>
                    </span>
                  );
                })}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function Team({ home }: { home: Home }) {
  const navigate = useNavigate();
  const team = home.team ?? [];
  return (
    <section className="panel" aria-labelledby="h-team">
      <div className="panel-h">
        <h2 id="h-team">Your team today</h2>
        <Link to="/tasks/reports?range=today" className="lnk">
          Full report
        </Link>
      </div>
      <div className="tbl-wrap">
        <table className="plain">
          <tbody>
            {team.map((m) => (
              <tr
                key={m.person.id}
                className="click"
                onClick={() => void navigate(`/tasks/reports?range=today&person=${m.person.id}`)}
              >
                <td>
                  <PersonCell person={m.person} />
                </td>
                <td>
                  <span className="row">
                    <ProgressBar progress={m.progress} width={80} />
                  </span>
                </td>
                <td>
                  {m.dayEnd === 'in' && <span className="chip st-done">Day-end in</span>}
                  {m.dayEnd === 'due' && <span className="chip">Day-end due</span>}
                </td>
              </tr>
            ))}
            {team.length === 0 && (
              <tr>
                <td className="empty">No one in your team yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Today({ home, tz }: { home: Home; tz: string }) {
  const today = home.today;
  if (!today) return null;
  const done = today.progress.done + today.progress.submitted;
  return (
    <section className="panel" aria-labelledby="h-today">
      <div className="panel-h">
        <h2 id="h-today">Today</h2>
        <span className="small muted">
          {done} of {today.progress.total} done
        </span>
      </div>
      <div className="today-bar">
        <span className="bar wide" aria-hidden="true">
          <i style={{ width: `${String(pct(today.progress))}%` }} />
        </span>
      </div>
      <div className="tlist">
        {today.items.map((c) => (
          <CopyRowButton key={c.id} c={c} tz={tz} />
        ))}
      </div>
    </section>
  );
}

function Feed({ home }: { home: Home }) {
  return (
    <section className="panel" aria-labelledby="h-feed">
      <div className="panel-h">
        <h2 id="h-feed">Updates</h2>
      </div>
      {home.feed.length === 0 && <p className="empty">No updates yet.</p>}
      {home.feed.map((f) => (
        <div key={f.id} className="feed-i">
          <span className="av sm" aria-hidden="true">
            {f.actor ? initialsOf(f.actor.fullName) : '?'}
          </span>
          <div>
            <p>{f.href ? <Link to={f.href}>{f.text}</Link> : f.text}</p>
            <span className="small muted">{timeAgo(f.createdAt)}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

function Notifications({ items }: { items: NotificationGroup[] }) {
  const markRead = useMarkRead();
  const navigate = useNavigate();
  return (
    <section className="panel" aria-labelledby="h-notif">
      <div className="panel-h">
        <h2 id="h-notif">Notifications</h2>
        <span className="chip">{items.filter((n) => n.unread > 0).length}</span>
      </div>
      <div className="notif-list pad">
        {items.map((n) => (
          <NotificationItem
            key={n.key}
            n={n}
            onOpen={(x) => {
              if (x.unread > 0) markRead.mutate([x.key]);
              if (x.href) void navigate(x.href);
            }}
          />
        ))}
        {items.length === 0 && <p className="empty">You’re all caught up.</p>}
      </div>
    </section>
  );
}

function YourTasks({ home, tz }: { home: Home; tz: string }) {
  return (
    <section className="panel" aria-labelledby="h-mine">
      <div className="panel-h">
        <h2 id="h-mine">Your tasks</h2>
        <Link to="/tasks" className="lnk">
          See all
        </Link>
      </div>
      {home.myTasks.length === 0 ? (
        <p className="empty">Nothing on your plate right now.</p>
      ) : (
        <div className="tlist">
          {home.myTasks.map((c) => (
            <CopyRowButton key={c.id} c={c} tz={tz} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Home (brief 7.3), from one call: greeting, what needs attention, a snapshot
 * chosen from permissions and reach (never role names), Updates,
 * Notifications and Your tasks.
 */
export function HomePage() {
  const { me, access } = useMeData();
  const home = useHome();
  const tz = me.organisation.timezone;
  const first = me.user.fullName.split(' ')[0] ?? me.user.fullName;
  const data = home.data;
  const when = whenIn(tz, data?.greeting.date ?? new Date().toISOString().slice(0, 10));
  const onlyToday = data?.sections.length === 1 && data.sections[0] === 'today';

  return (
    <>
      <NarrowedChip />
      <header className="hello">
        <div>
          <p className="date">{when.label}</p>
          <h1>
            {greeting(when.hour)}, {data?.greeting.firstName ?? first}
          </h1>
          <p className="sub">{data?.greeting.summary ?? `Welcome to ${me.organisation.name}.`}</p>
        </div>
      </header>
      {access.can('organisation', 'edit') && !access.readOnly && <SetupChecklist />}
      <ErrorAlert error={home.error} />
      {!data && home.isLoading && (
        <div className="fullpage-inline" role="status">
          <Loader size="sm" />
          <span className="muted">Loading your day…</span>
        </div>
      )}
      {data && (
        <>
          <Attention home={data} />
          <div className="grid2">
            <div className="col">
              {data.sections.includes('schools') && <Schools home={data} />}
              {data.sections.includes('set_tasks') && <SetTasks home={data} />}
              {data.sections.includes('team') && <Team home={data} />}
              {data.sections.includes('today') && <Today home={data} tz={tz} />}
              <Feed home={data} />
            </div>
            <div className="col">
              <Notifications items={data.notifications} />
              {!onlyToday && <YourTasks home={data} tz={tz} />}
            </div>
          </div>
        </>
      )}
      <TaskDrawers />
    </>
  );
}
