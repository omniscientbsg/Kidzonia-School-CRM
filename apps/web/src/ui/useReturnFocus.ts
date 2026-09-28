import { useEffect, useState } from 'react';

/**
 * Puts keyboard focus back on whatever opened a drawer once it goes away
 * (audit D6).
 *
 * Mantine's Drawer only does this when its `opened` prop changes while it
 * stays mounted. Our task drawers are mounted already open (they follow the
 * address) and the user drawer is re-keyed on every open, so Mantine never
 * sees the change and focus would fall to the page body. Call this in a
 * component that mounts open: the opener is read on first render, before the
 * drawer's focus trap moves focus inside it.
 */
export function useReturnFocus(active = true): void {
  const [opener] = useState<Element | null>(() =>
    active && typeof document !== 'undefined' ? document.activeElement : null,
  );
  useEffect(() => {
    if (!opener) return;
    return () => {
      // After the drawer's own clean-up; only if nothing else took focus
      // meanwhile, and not when another drawer replaced this one (saving a new
      // task opens it straight away).
      window.setTimeout(() => {
        const now = document.activeElement;
        const anotherDialog = document.querySelector('[role="dialog"][aria-modal="true"]');
        if (
          opener instanceof HTMLElement &&
          opener.isConnected &&
          !anotherDialog &&
          (!now || now === document.body)
        ) {
          opener.focus({ preventScroll: true });
        }
      }, 0);
    };
  }, [opener]);
}
