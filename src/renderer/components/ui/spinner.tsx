import { LoaderCircle } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

interface SpinnerProps extends Omit<React.ComponentProps<"output">, "children"> {
	label?: string;
}

function Spinner({ className, label = "Loading", ...props }: SpinnerProps) {
	return (
		<output
			aria-label={label}
			className={cn("inline-grid size-4 place-items-center text-current", className)}
			data-slot="spinner"
			{...props}
		>
			<LoaderCircle aria-hidden="true" className="size-full animate-spin" />
		</output>
	);
}

export { Spinner };
