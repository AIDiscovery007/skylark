import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IconButtonSize = "sm" | "md";

interface IconButtonProps extends Omit<React.ComponentProps<typeof Button>, "size"> {
	"aria-label": string;
	size?: IconButtonSize;
}

function IconButton({ className, size = "md", variant = "ghost", ...props }: IconButtonProps) {
	return (
		<Button
			className={cn(
				"rounded-[var(--radius-sm)] text-[color:var(--text-secondary)] shadow-none transition-[background-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--text-primary)] hover:shadow-[var(--shadow-minimal)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--focus-ring)] disabled:opacity-45",
				size === "sm" ? "size-7" : "size-8",
				className,
			)}
			data-slot="icon-button"
			size="icon-sm"
			type="button"
			variant={variant}
			{...props}
		/>
	);
}

export { IconButton };
