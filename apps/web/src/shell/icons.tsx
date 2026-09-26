import {
  IconAdjustmentsHorizontal,
  IconBuilding,
  IconCalendar,
  IconChartBar,
  IconChecks,
  IconEye,
  IconFlag,
  IconHome,
  IconLayoutGrid,
  IconMessage,
  IconMoon,
  IconReceipt,
  IconSchool,
  IconShieldCheck,
  IconSquareCheck,
  IconUsers,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

/** Registry icon names are plain words; the web app maps them to icons. */
const ICONS: Record<string, Icon> = {
  home: IconHome,
  tasks: IconSquareCheck,
  flag: IconFlag,
  users: IconUsers,
  eye: IconEye,
  check: IconChecks,
  moon: IconMoon,
  chart: IconChartBar,
  sliders: IconAdjustmentsHorizontal,
  building: IconBuilding,
  school: IconSchool,
  shield: IconShieldCheck,
  receipt: IconReceipt,
  msg: IconMessage,
  calendar: IconCalendar,
  grid: IconLayoutGrid,
};

export function AppIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Component = ICONS[name] ?? IconLayoutGrid;
  return <Component size={size} stroke={1.8} aria-hidden="true" />;
}
