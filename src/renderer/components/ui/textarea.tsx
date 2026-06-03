import type * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"flex field-sizing-content min-h-16 w-full select-text rounded-[var(--radius-md)] border border-[color:var(--border-strong)] bg-[color:var(--surface-1)] px-3 py-2 text-base text-[color:var(--text-primary)] shadow-[var(--shadow-minimal)] transition-[background-color,border-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)] outline-none placeholder:text-[color:var(--text-tertiary)] focus-visible:border-[color:var(--accent)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-[color:var(--destructive)] aria-invalid:ring-[color:color-mix(in_oklch,var(--destructive)_20%,transparent)] md:text-sm",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
