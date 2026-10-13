import { useEffect, useState } from 'react';
import { api } from '../api/client';

/** Whether this server takes new sign-ups (an admin can close it); asked each time a page needs it. */
export function useRegistrationOpen(): boolean | undefined {
  const [open, setOpen] = useState<boolean>();
  useEffect(() => {
    let active = true;
    api.health().then(
      (h) => active && setOpen(h.registrationOpen !== false),
      () => active && setOpen(true),
    );
    return () => {
      active = false;
    };
  }, []);
  return open;
}
