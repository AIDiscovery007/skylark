import { Tooltip as TooltipPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

function TooltipProvider({ delayDuration = 0, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />;
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
	return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
	className,
	sideOffset = 0,
	children,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				data-slot="tooltip-content"
				sideOffset={sideOffset}
				className={cn(
					"z-[var(--z-tooltip)] w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-[var(--radius-sm)] bg-[color:var(--foreground)] px-3 py-1.5 text-xs text-balance text-[color:var(--background)] shadow-[var(--shadow-middle)] fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
					className,
				)}
				{...props}
			>
				{children}
				<TooltipPrimitive.Arrow className="z-[var(--z-tooltip)] size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-[color:var(--foreground)] fill-[color:var(--foreground)]" />
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	);
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
