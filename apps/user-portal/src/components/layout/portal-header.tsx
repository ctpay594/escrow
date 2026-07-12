'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  ChevronDown,
  History,
  KeyRound,
  LogOut,
  Menu,
  Send,
  Settings,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CTPayLogo } from '@/components/ctpay-logo';
import {
  AccountStatusBadge,
} from '@/components/account-status-banner';
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
import { glassHeaderBar } from '@/lib/glass-styles';
import type { MerchantProfile, SessionUser } from '@/lib/types';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Account', icon: Wallet },
  { href: '/transfer', label: 'Transfer', icon: Send },
  { href: '/history', label: 'History', icon: History },
];

interface PortalHeaderProps {
  activePath: string;
  user: SessionUser;
  merchant: MerchantProfile | null;
  processingCount?: number;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function PortalHeader({
  activePath,
  user,
  merchant,
  processingCount = 0,
}: PortalHeaderProps) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const displayName = merchant?.merchant_name ?? user.username;
  const transfersBlocked =
    merchant?.account_status === 'on_hold' ||
    merchant?.account_status === 'terminated';

  async function handleLogout() {
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className={cn('sticky top-0 z-40', glassHeaderBar())}>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <CTPayLogo linked />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {navItems.map((item) => {
            const isActive =
              item.href === '/'
                ? activePath === '/'
                : activePath.startsWith(item.href);
            const Icon = item.icon;
            const isTransfer = item.href === '/transfer';

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-slate-900 text-primary-foreground shadow-[0_2px_8px_rgba(15,23,42,0.22)]'
                    : 'text-muted-foreground hover:bg-white/55 hover:text-accent-foreground',
                  isTransfer && transfersBlocked && 'opacity-70',
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1 sm:gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9"
            aria-label={
              processingCount > 0
                ? `${processingCount} notifications`
                : 'Notifications'
            }
            onClick={() =>
              toast.info(
                processingCount > 0
                  ? `${processingCount} transfer(s) in progress`
                  : 'No new notifications',
              )
            }
          >
            <Bell className="h-4 w-4" />
            {processingCount > 0 ? (
              <Badge
                variant="warning"
                className="absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center px-1 text-[10px]"
              >
                {processingCount > 9 ? '9+' : processingCount}
              </Badge>
            ) : null}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="hidden h-9 gap-2 px-2 sm:inline-flex"
                aria-label="Open profile menu"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
                    {initials(displayName)}
                  </AvatarFallback>
                </Avatar>
                <span className="max-w-[120px] truncate text-sm font-medium">
                  {displayName}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{displayName}</span>
                    {merchant ? (
                      <AccountStatusBadge
                        status={merchant.account_status ?? 'active'}
                      />
                    ) : null}
                  </div>
                  <span className="text-xs font-normal text-muted-foreground">
                    {user.username}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/">
                  <User className="mr-2 h-4 w-4" />
                  My profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  toast.message('API keys', {
                    description: 'API key management is admin-only for CTPay.',
                  })
                }
              >
                <KeyRound className="mr-2 h-4 w-4" />
                API keys
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  toast.message('Settings', {
                    description: 'Contact your admin to update account settings.',
                  })
                }
              >
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={loggingOut}
                onClick={() => void handleLogout()}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                {loggingOut ? 'Signing out…' : 'Logout'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 md:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileOpen ? (
        <nav
          className="border-t border-white/50 bg-white/60 px-4 py-3 backdrop-blur-xl md:hidden"
          aria-label="Mobile"
        >
          {merchant ? (
            <div className="mb-3 flex items-center gap-2 border-b border-white/50 pb-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
                  {initials(displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <div className="mt-1">
                  <AccountStatusBadge status={merchant.account_status ?? 'active'} />
                </div>
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive =
                item.href === '/'
                  ? activePath === '/'
                  : activePath.startsWith(item.href);
              const Icon = item.icon;
              const isTransfer = item.href === '/transfer';

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-slate-900 text-primary-foreground'
                      : 'text-muted-foreground hover:bg-white/55',
                    isTransfer && transfersBlocked && 'opacity-70',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-destructive"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
