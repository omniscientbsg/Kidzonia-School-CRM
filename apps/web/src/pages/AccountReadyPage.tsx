import { IconHourglassHigh } from '@tabler/icons-react';
import type { MeData } from '../auth/use-me';
import { initials } from '../shell/TopBar';

/** Shown to anyone signed in without a role, or with a role that can see nothing (rule 1). */
export function AccountReadyPage({ data }: { data: MeData }) {
  const boss = data.me.askForAccess;
  const firstName = boss?.fullName.split(' ')[0];
  return (
    <div className="noaccess">
      <div className="big" aria-hidden="true">
        <IconHourglassHigh size={30} stroke={1.8} />
      </div>
      <h1>Your account is ready</h1>
      <p>
        You don’t have access to anything yet. Once your admin gives you a role, your tasks and menu
        will appear here.
      </p>
      {boss && (
        <div className="panel ask">
          <span className="av sm" aria-hidden="true">
            {initials(boss.fullName)}
          </span>
          <div>
            <b>{boss.fullName}</b>
            <span>Ask {firstName} to give you a role</span>
          </div>
        </div>
      )}
    </div>
  );
}
