import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)] focus-visible:border-[color:var(--accent)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)] aria-invalid:border-[color:var(--destructive)] aria-invalid:ring-[color:color-mix(in_oklch,var(--destructive)_20%,transparent)] [&>svg]:pointer-events-none [&>svg]:size-3",
	{
		variants: {
			variant: {
				default: "bg-[color:var(--primary)] text-[color:var(--primary-foreground)] [a&]:hover:opacity-90",
				neutral:
					"border-[color:var(--border-subtle)] bg-[color:var(--surface-2)] text-[color:var(--text-secondary)] [a&]:hover:bg-[color:var(--surface-3)]",
				accent:
					"border-[color:color-mix(in_oklch,var(--accent)_22%,transparent)] bg-[color-mix(in_oklch,var(--accent)_10%,var(--background))] text-[color:var(--accent)] [a&]:hover:bg-[color-mix(in_oklch,var(--accent)_15%,var(--background))]",
				info: "border-[color:color-mix(in_oklch,var(--info)_22%,transparent)] bg-[color-mix(in_oklch,var(--info)_10%,var(--background))] text-[color:var(--info)] [a&]:hover:bg-[color-mix(in_oklch,var(--info)_15%,var(--background))]",
				success:
					"border-[color:color-mix(in_oklch,var(--success)_22%,transparent)] bg-[color-mix(in_oklch,var(--success)_10%,var(--background))] text-[color:var(--success)] [a&]:hover:bg-[color-mix(in_oklch,var(--success)_15%,var(--background))]",
				warning:
					"border-[color:color-mix(in_oklch,var(--warning)_26%,transparent)] bg-[color-mix(in_oklch,var(--warning)_10%,var(--background))] text-[color:var(--warning)] [a&]:hover:bg-[color-mix(in_oklch,var(--warning)_15%,var(--background))]",
				error: "border-[color:color-mix(in_oklch,var(--destructive)_22%,transparent)] bg-[color-mix(in_oklch,var(--destructive)_10%,var(--background))] text-[color:var(--destructive)] [a&]:hover:bg-[color-mix(in_oklch,var(--destructive)_15%,var(--background))]",
				secondary:
					"bg-[color:var(--surface-2)] text-[color:var(--text-primary)] [a&]:hover:bg-[color:var(--surface-3)]",
				destructive:
					"border-[color:color-mix(in_oklch,var(--destructive)_26%,transparent)] bg-[color-mix(in_oklch,var(--destructive)_12%,var(--background))] text-[color:var(--destructive)] focus-visible:ring-[color:color-mix(in_oklch,var(--destructive)_22%,transparent)] [a&]:hover:bg-[color-mix(in_oklch,var(--destructive)_16%,var(--background))]",
				outline:
					"border-[color:var(--border-subtle)] text-[color:var(--text-primary)] [a&]:hover:bg-[color:var(--surface-2)]",
				ghost: "text-[color:var(--text-secondary)] [a&]:hover:bg-[color:var(--surface-2)] [a&]:hover:text-[color:var(--text-primary)]",
				link: "text-[color:var(--accent)] underline-offset-4 [a&]:hover:underline",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant = "default",
	asChild = false,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "span";

	return (
		<Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
	);
}

export { Badge, badgeVariants };
