import { Link } from 'react-router';
import { IconChecks } from '@tabler/icons-react';
import { SetupChecklist } from './SetupChecklist';
import { useMeData } from '../shell/AppLayout';
import { AppIcon } from '../shell/icons';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Hour and date in the organisation's time zone, not the browser's. */
function nowIn(timeZone: string) {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now),
  );
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone, ...options }).format(now);
  // "Saturday, 26 September", as in the demo.
  const date = `${part({ weekday: 'long' })}, ${part({ day: 'numeric', month: 'long' })}`;
  return { hour, date };
}

/**
 * Home. Phase 1 shows the greeting and the apps this person can open; the
 * attention cards, snapshot, updates and notifications arrive in Phase 5.
 */
export function HomePage() {
  const { me, nav, access } = useMeData();
  const { hour, date } = nowIn(me.organisation.timezone);
  const first = me.user.fullName.split(' ')[0] ?? me.user.fullName;

  return (
    <>
      <header className="hello">
        <div>
          <p className="date">{date}</p>
          <h1>
            {greeting(hour)}, {first}
          </h1>
          <p className="sub">Welcome to {me.organisation.name}.</p>
        </div>
      </header>
      {access.can('organisation', 'edit') && !access.readOnly && <SetupChecklist />}
      {me.changesToApprove > 0 && (
        <div className="attn">
          <Link to="/changes" className="attn-card">
            <span className="attn-i">
              <IconChecks size={20} aria-hidden="true" />
            </span>
            <span className="attn-t">
              <b>{me.changesToApprove}</b>
              <small>
                {me.changesToApprove === 1
                  ? 'change waiting for your approval'
                  : 'changes waiting for your approval'}
              </small>
            </span>
          </Link>
        </div>
      )}
      <section className="panel" aria-labelledby="your-apps">
        <div className="panel-h">
          <h2 id="your-apps">Your apps</h2>
        </div>
        <div className="app-links">
          {nav.apps.map((a) => (
            <Link key={a.app.key} to={a.path} className="app-link">
              <span className="ai">
                <AppIcon name={a.app.icon} size={22} />
              </span>
              <span>
                <b>{a.app.name}</b>
                <small>{a.app.comingSoon ? 'Coming soon' : a.app.description}</small>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
