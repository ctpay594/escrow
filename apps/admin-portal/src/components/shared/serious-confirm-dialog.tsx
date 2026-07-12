'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface SeriousConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface SeriousConfirmDialogProps {
  open: boolean;
  options: SeriousConfirmOptions | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SeriousConfirmDialog({
  open,
  options,
  onConfirm,
  onCancel,
}: SeriousConfirmDialogProps) {
  if (!options) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{options.title}</DialogTitle>
          <DialogDescription>{options.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            {options.cancelLabel ?? 'No'}
          </Button>
          <Button
            variant={options.destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {options.confirmLabel ?? 'Yes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
