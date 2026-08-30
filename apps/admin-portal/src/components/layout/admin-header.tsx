'use client';

import { useRouter } from 'next/navigation';
import { Bell, BarChart3, ChevronDown, History, LogOut, Menu, Send, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AdminLogo } from '@/components/admin-logo';
import { UserPortalLiveLink } from '@/components/user-portal-live-link';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { glassHeaderBar } from '@/lib/glass-styles';

interface AdminHeaderProps {
  adminUsername: string;
  activePath: string;
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

export function AdminHeader({ adminUsername, activePath }: AdminHeaderProps) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    void fetch('/api/transfers?status=PENDING_APPROVAL')
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setPendingCount(data.length);
        }
      })
      .catch(() => undefined);
  }, [activePath]);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const navItems = [
    { href: '/', label: 'Merchants', icon: Users },
    { href: '/transfers', label: 'Transfer', icon: Send },
    { href: '/history', label: 'History', icon: History },
    { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  ];

  return (
    <header className={cn('sticky top-0 z-40', glassHeaderBar())}>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <AdminLogo linked />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active =
              href === '/'
                ? activePath === '/' || activePath.startsWith('/merchants')
                : activePath === href;

            return (
              <Button
                key={href}
                variant={active ? 'default' : 'ghost'}
                size="sm"
                className={cn(
                  'gap-2 rounded-full',
                  active &&
                    'bg-slate-900 shadow-[0_2px_8px_rgba(15,23,42,0.22)] hover:bg-slate-900/90',
                  !active && 'text-muted-foreground hover:bg-white/55',
                )}
                onClick={() => router.push(href)}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" />
                {label}
                {href === '/' && pendingCount > 0 ? (
                  <Badge variant="warning" className="ml-1 px-1.5 py-0 text-[10px]">
                    {pendingCount}
                  </Badge>
                ) : null}
              </Button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <UserPortalLiveLink compact className="sm:hidden" />
          <UserPortalLiveLink className="hidden sm:inline-flex" />

          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              pendingCount > 0
                ? `${pendingCount} pending approvals`
                : 'Pending approvals'
            }
            onClick={() => router.push('/?needsApproval=1')}
          >
            <Bell className="h-5 w-5" />
            {pendingCount > 0 ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500" />
            ) : null}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="hidden gap-2 sm:inline-flex">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{initials(adminUsername)}</AvatarFallback>
                </Avatar>
                <span className="max-w-[120px] truncate text-sm">{adminUsername}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Admin</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={loggingOut}
                onClick={() => void handleLogout()}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="border-t border-border bg-card px-4 py-3 md:hidden">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Button
              key={href}
              variant="ghost"
              className="mb-1 w-full justify-start gap-2"
              onClick={() => {
                setMobileOpen(false);
                router.push(href);
              }}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
          <div className="mt-2 border-t border-border pt-2">
            <UserPortalLiveLink />
            <Button
              variant="ghost"
              className="mb-1 w-full justify-start gap-2"
              onClick={() => {
                setMobileOpen(false);
                router.push('/?needsApproval=1');
              }}
            >
              <Bell className="h-4 w-4" />
              Pending approvals
              {pendingCount > 0 ? (
                <Badge variant="warning" className="ml-auto px-1.5 py-0 text-[10px]">
                  {pendingCount}
                </Badge>
              ) : null}
            </Button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
