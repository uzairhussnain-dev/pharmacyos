import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'bg-[#159A72]/15 text-[#0e6d50] border border-[#159A72]/20',
        secondary: 'bg-[#122A36]/10 text-[#122A36] border border-[#122A36]/15',
        accent: 'bg-[#E8B04A]/20 text-[#8e610b] border border-[#E8B04A]/30',
        destructive: 'bg-rose-50 text-rose-700 border border-rose-200',
        warning: 'bg-amber-50 text-amber-800 border border-amber-200',
        outline: 'text-[#122A36] border border-[#d1deda]',
        success: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
