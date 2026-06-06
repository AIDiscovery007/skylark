import type * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"h-9 w-full min-w-0 select-text rounded-[var(--radius-md)] border border-[color:var(--border-strong)] bg-[color:var(--surface-1)] px-3 py-1 text-base text-[color:var(--text-primary)] shadow-[var(--shadow-minimal)] transition-[background-color,border-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)] outline-none selection:bg-[color:var(--accent)] selection:text-[color:var(--primary-foreground)] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[color:var(--text-primary)] placeholder:text-[color:var(--text-tertiary)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 md:text-sm",
				"focus-visible:border-[color:var(--border-strong)] focus-visible:shadow-[var(--control-focus-shadow)]",
				"aria-invalid:border-[color:var(--destructive)] aria-invalid:ring-[color:color-mix(in_oklch,var(--destructive)_20%,transparent)]",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
