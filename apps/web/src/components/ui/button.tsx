import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#159A72] disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-[#159A72] text-white hover:bg-[#128361] shadow-xs active:translate-y-[1px]',
        secondary: 'bg-[#122A36] text-white hover:bg-[#1c3e4e] shadow-xs active:translate-y-[1px]',
        outline: 'border border-[#d1deda] bg-white text-[#122A36] hover:bg-[#f1f6f4] hover:border-[#b7cbcc]',
        ghost: 'text-[#122A36] hover:bg-[#e7efec]',
        destructive: 'bg-rose-600 text-white hover:bg-rose-700 shadow-xs',
        accent: 'bg-[#E8B04A] text-[#122A36] font-semibold hover:bg-[#dd9f32] shadow-xs',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
