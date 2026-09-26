import { Menu, Modal, Button, Stack, Text, UnstyledButton, List } from '@mantine/core';
import { comingSoonPath, registry } from '@kidzonia/shared';
import { IconLayoutGrid, IconLogout } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useSession } from '../auth/session';
import type { MeData } from '../auth/use-me';
import { AppIcon } from './icons';

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

export function TopBar({ data }: { data: MeData }) {
  const { me, nav } = data;
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
        <Stack>
          <Text>{blocked?.message}</Text>
          {blocked && blocked.blocks.length > 0 && (
            <List spacing="xs">
              {blocked.blocks.map((b) => (
                <List.Item key={b.path}>
                  <NavLink
                    to={b.path}
                    onClick={() => {
                      setBlocked(null);
                    }}
                  >
                    {b.title}
                  </NavLink>
                </List.Item>
              ))}
            </List>
          )}
          <Button
            onClick={() => {
              setBlocked(null);
            }}
          >
            OK
          </Button>
        </Stack>
      </Modal>
    </header>
  );
}
