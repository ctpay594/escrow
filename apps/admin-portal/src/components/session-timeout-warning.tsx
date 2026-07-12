'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const IDLE_MS = 25 * 60 * 1000;
const WARN_MS = 28 * 60 * 1000;

export function SessionTimeoutWarning() {
  const [open, setOpen] = useState(false);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    function bump() {
      lastActivity.current = Date.now();
      setOpen(false);
    }

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((event) => window.addEventListener(event, bump));

    const interval = window.setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= WARN_MS) {
        setOpen(true);
      } else if (idle >= IDLE_MS && idle < WARN_MS) {
        toast.message('Session idle', {
          description: 'You will be signed out soon due to inactivity.',
          id: 'session-idle',
        });
      }
    }, 60_000);

    return () => {
      events.forEach((event) => window.removeEventListener(event, bump));
      window.clearInterval(interval);
    };
  }, []);

  async function staySignedIn() {
    lastActivity.current = Date.now();
    setOpen(false);
    toast.dismiss('session-idle');
  }

  async function signOutNow() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Session expiring</DialogTitle>
          <DialogDescription>
            You have been inactive. Sign out now or stay signed in to continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => void signOutNow()}>
            Sign out
          </Button>
          <Button onClick={() => void staySignedIn()}>Stay signed in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
