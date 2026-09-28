import { Button } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { reportError } from '../lib/error-reporting';

/**
 * Shown when a page crashes while rendering. React Router catches these before
 * they reach the window, so this is where they're sent to error tracking.
 */
export function RouteErrorPage() {
  const error = useRouteError();

  useEffect(() => {
    // Route responses (a 404 thrown on purpose) are answers, not crashes.
    if (!isRouteErrorResponse(error)) reportError(error, { source: 'route' });
  }, [error]);

  return (
    <div className="noaccess" role="alert">
      <div className="big" aria-hidden="true">
        <IconAlertTriangle size={30} stroke={1.8} />
      </div>
      <h1>Something went wrong</h1>
      <p>This page couldn’t be shown. Reloading usually fixes it.</p>
      <Button
        mt="lg"
        onClick={() => {
          window.location.reload();
        }}
      >
        Reload
      </Button>
    </div>
  );
}
