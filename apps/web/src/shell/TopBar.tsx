import { Menu, Modal, Button, Stack, Text, Textarea, UnstyledButton } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { comingSoonPath, registry } from '@kidzonia/shared';
import {
  IconBellCog,
  IconChecks,
  IconLayoutGrid,
  IconLogout,
  IconPlus,
  IconUser,
} from '@tabler/icons-react';
import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { api, ApiError } from '../api/client';
import { errorMessage } from '../ui/errors';
import { useSession } from '../auth/session';
import type { MeData } from '../auth/use-me';
import { AppIcon } from './icons';
import { Bell } from './Bell';
import { SchoolSwitcher } from './SchoolSwitcher';
import { SearchBox } from './SearchBox';

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

interface Blocked {
  message: string;
  blocks: { title: string; path: string }[];
}

function blockedFrom(err: ApiError): Blocked {
  const raw = err.details.blocks;
  const blocks = Array.isArray(raw)
    ? raw.filter(
        (b): b is { title: string; path: string } =>
          typeof b === 'object' && b !== null && 'title' in b && 'path' in b,
      )
    : [];
  return { message: err.message, blocks };
}

/**
 * The logout screen when blocking work is open (brief 9.7): what to submit,
 * a button to open each, and "Ask for release" to tell the manager.
 */
function BlockedLogout({
  blocked,
  onOpen,
  onClose,
}: {
  blocked: Blocked;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const ask = useMutation({
    mutationFn: () =>
      api('/release-requests', z.object({ askedOf: z.object({ fullName: z.string() }) }), {
        method: 'POST',
        body: { note: note.trim() || null },
        noPreview: true,
      }),
  });
  return (
    <Stack>
      <Text>Please submit these first:</Text>
      {blocked.blocks.map((b) => (
        <div className="check" key={b.path}>
          <span className="grow">{b.title}</span>
          <Button
            size="compact-sm"
            variant="default"
            onClick={() => {
              onOpen(b.path);
            }}
          >
            Open
          </Button>
        </div>
      ))}
      {blocked.blocks.length === 0 && <Text>{blocked.message}</Text>}
      {ask.data ? (
        <Text role="status">
          We’ve asked {ask.data.askedOf.fullName} to release you. You can log out once they do.
        </Text>
      ) : (
        blocked.blocks.length > 0 && (
          <>
            <Textarea
              label="Need to leave? Ask for release"
              placeholder="Say why (optional)"
              value={note}
              onChange={(e) => {
                setNote(e.currentTarget.value);
              }}
              autosize
              minRows={2}
            />
            {ask.error && (
              <Text c="red" size="sm" role="alert">
                {errorMessage(ask.error)}
              </Text>
            )}
          </>
        )
      )}
      <div className="drawer-actions">
        <Button variant="default" onClick={onClose}>
          Stay logged in
        </Button>
        {!ask.data && blocked.blocks.length > 0 && (
          <Button
            loading={ask.isPending}
            onClick={() => {
              ask.mutate();
            }}
          >
            Ask for release
          </Button>
        )}
      </div>
    </Stack>
  );
}

export function TopBar({ data }: { data: MeData }) {
  const { me, nav, access } = data;
  const { signOut } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const logout = async () => {
    setSigningOut(true);
    try {
      await signOut();
      void navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'logout_blocked') setBlocked(blockedFrom(err));
      else setBlocked({ message: 'We couldn’t log you out. Please try again.', blocks: [] });
    } finally {
      setSigningOut(false);
    }
  };

  const roleLine = [me.role?.roleName ?? 'No access yet', me.user.homeSchoolName ?? 'Head office']
    .filter(Boolean)
    .join(', ');
  const appPath = (key: string) => nav.apps.find((a) => a.app.key === key)?.path;

  return (
    <header className="appbar">
      <NavLink to="/" className="logo" aria-label="Kidzonia 360 home">
        <span className="mark">K</span>
        <span className="logo-t">Kidzonia 360</span>
      </NavLink>

      {nav.hasAccess && (
        <nav className="apptabs" aria-label="Apps">
          <NavLink to="/" end className="apptab">
            Home
          </NavLink>
          {nav.apps.map((a) => {
            const root = a.app.comingSoon ? a.path : `/${a.app.key}`;
            const current = location.pathname === root || location.pathname.startsWith(`${root}/`);
            return (
              // A plain Link: the tab is current for every page of its app, not only its first.
              <Link
                key={a.app.key}
                to={a.path}
                className="apptab"
                aria-current={current ? 'page' : undefined}
              >
                {a.app.name}
              </Link>
            );
          })}
        </nav>
      )}
      <span className="sp" />

      {nav.hasAccess && <SearchBox />}
      {nav.hasAccess && <SchoolSwitcher data={data} />}
      {access.can('tasks', 'create') && !access.readOnly && (
        <UnstyledButton
          className="barbtn"
          aria-label="New task"
          title="New task"
          onClick={() => void navigate('/tasks?new=1')}
        >
          <IconPlus size={20} stroke={1.8} />
        </UnstyledButton>
      )}
      <Bell />

      {nav.hasAccess && (
        <Menu position="bottom-end" width={340} shadow="lg" radius="lg">
          <Menu.Target>
            <UnstyledButton className="barbtn" aria-label="All apps">
              <IconLayoutGrid size={20} stroke={1.8} />
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>All apps</Menu.Label>
            <div className="appgrid">
              {registry.apps.map((a) => {
                const target = appPath(a.key) ?? comingSoonPath(a.key);
                return (
                  <Menu.Item
                    key={a.key}
                    className={a.comingSoon ? 'soon' : undefined}
                    onClick={() => void navigate(target)}
                  >
                    <span className="ai">
                      <AppIcon name={a.icon} size={22} />
                    </span>
                    <span className="an">{a.name}</span>
                    {a.comingSoon && <small>Coming soon</small>}
                  </Menu.Item>
                );
              })}
            </div>
          </Menu.Dropdown>
        </Menu>
      )}

      <Menu position="bottom-end" width={290} shadow="lg" radius="lg">
        <Menu.Target>
          <UnstyledButton className="barbtn" aria-label="Your profile">
            <span className="av sm">{initials(me.user.fullName)}</span>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <div className="profile-head">
            <span className="av">{initials(me.user.fullName)}</span>
            <div>
              <Text fw={600}>{me.user.fullName}</Text>
              <Text size="xs" c="dimmed">
                {roleLine}
              </Text>
            </div>
          </div>
          <Text size="sm" c="dimmed" px="sm" pb="xs">
            {me.organisation.name}
          </Text>
          <Menu.Divider />
          <Menu.Item leftSection={<IconUser size={16} />} onClick={() => void navigate('/profile')}>
            Your details
          </Menu.Item>
          <Menu.Item
            leftSection={<IconBellCog size={16} />}
            onClick={() => void navigate('/notifications/settings')}
          >
            Notification settings
          </Menu.Item>
          {(me.changesToApprove > 0 || me.role?.isOwner === true || me.teamUserIds.length > 0) && (
            <Menu.Item
              leftSection={<IconChecks size={16} />}
              onClick={() => void navigate('/changes')}
              rightSection={
                me.changesToApprove > 0 ? (
                  <span className="count">{me.changesToApprove}</span>
                ) : null
              }
            >
              Changes to approve
            </Menu.Item>
          )}
          <Menu.Item
            leftSection={<IconLogout size={16} />}
            onClick={() => void logout()}
            disabled={signingOut}
          >
            Log out
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <Modal
        opened={blocked !== null}
        onClose={() => {
          setBlocked(null);
        }}
        title="You can’t log out yet"
        centered
        radius="lg"
      >
        {blocked && (
          <BlockedLogout
            blocked={blocked}
            onOpen={(path) => {
              setBlocked(null);
              void navigate(path);
            }}
            onClose={() => {
              setBlocked(null);
            }}
          />
        )}
      </Modal>
    </header>
  );
}
