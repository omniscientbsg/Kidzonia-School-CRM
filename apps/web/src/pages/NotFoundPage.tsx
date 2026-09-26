import { Button } from '@mantine/core';
import { IconMapOff } from '@tabler/icons-react';
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="noaccess">
      <div className="big" aria-hidden="true">
        <IconMapOff size={30} stroke={1.8} />
      </div>
      <h1>We can’t find that page</h1>
      <p>It may have moved, or the link may be wrong.</p>
      <Button component={Link} to="/" mt="lg">
        Go to Home
      </Button>
    </div>
  );
}
