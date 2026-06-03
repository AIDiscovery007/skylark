import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)] text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)] outline-none focus-visible:border-[color:var(--ring)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)] disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-[color:var(--destructive)] aria-invalid:ring-[color:color-mix(in_oklch,var(--destructive)_20%,transparent)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					"bg-[color:var(--primary)] text-[color:var(--primary-foreground)] shadow-[var(--shadow-minimal)] hover:bg-[color-mix(in_oklch,var(--primary)_92%,var(--background))]",
				destructive:
					"bg-[color:var(--destructive)] text-[color:var(--primary-foreground)] shadow-[var(--shadow-minimal)] hover:bg-[color-mix(in_oklch,var(--destructive)_88%,var(--background))] focus-visible:ring-[color:color-mix(in_oklch,var(--destructive)_22%,transparent)]",
				outline:
					"border border-[color:var(--border-subtle)] bg-[color:var(--background)] shadow-[var(--shadow-minimal)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)]",
				secondary:
					"bg-[color:var(--surface-2)] text-[color:var(--text-primary)] shadow-[var(--shadow-minimal)] hover:bg-[color:var(--surface-3)]",
				ghost: "text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)]",
				link: "text-[color:var(--accent)] underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-4 py-2 has-[>svg]:px-3",
				xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
				lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
				icon: "size-9",
				"icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-8",
				"icon-lg": "size-10",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot.Root : "button";

	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
