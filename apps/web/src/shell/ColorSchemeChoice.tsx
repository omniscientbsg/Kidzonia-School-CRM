import { Menu, useMantineColorScheme } from '@mantine/core';
import type { MantineColorScheme } from '@mantine/core';
import { IconCheck, IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';

const CHOICES: { value: MantineColorScheme; label: string; icon: typeof IconSun }[] = [
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'dark', label: 'Dark', icon: IconMoon },
  { value: 'auto', label: 'Device', icon: IconDeviceDesktop },
];

/**
 * Light / Dark / Device inside the profile menu (audit D5). Mantine's
 * colour-scheme manager (main.tsx) keeps the choice in this browser's local
 * storage, so it is remembered per device rather than per person: a shared
 * school tablet and a personal phone can differ.
 */
export function ColorSchemeChoice() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <>
      <Menu.Label id="appearance-label">Appearance</Menu.Label>
      <div role="group" aria-labelledby="appearance-label">
        {CHOICES.map(({ value, label, icon: Icon }) => {
          const on = colorScheme === value;
          return (
            <Menu.Item
              key={value}
              // Mantine fixes the role to menuitem, where aria-checked isn't
              // allowed, so the chosen one is announced as current instead.
              aria-current={on ? 'true' : undefined}
              closeMenuOnClick={false}
              leftSection={<Icon size={16} />}
              rightSection={on ? <IconCheck size={16} aria-hidden /> : null}
              onClick={() => {
                setColorScheme(value);
              }}
            >
              {label}
            </Menu.Item>
          );
        })}
      </div>
    </>
  );
}
