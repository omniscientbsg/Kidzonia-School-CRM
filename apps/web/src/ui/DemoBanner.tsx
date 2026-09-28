/** Set at build time for the public demo (Render): made-up data, a fixed sign-in code. */
export const isDemo = import.meta.env.VITE_DEMO_MODE === '1';

/**
 * Says plainly that this is a demo, so nobody mistakes it for the real thing
 * or types real data into it.
 */
export function DemoBanner() {
  if (!isDemo) return null;
  return (
    <div className="preview-banner demo-banner" role="note">
      <span className="grow">
        Demo with made-up data. Sign in with any demo number and the code 123456. Don’t enter real
        people’s details.
      </span>
    </div>
  );
}
