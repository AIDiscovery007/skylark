import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ComponentProps, FormEventHandler, KeyboardEventHandler, MouseEvent, ReactNode } from "react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface FloatingDialogBaseProps {
	children: ReactNode;
	className?: string;
	dataSlot?: string;
	isOpen: boolean;
	labelledBy: string;
	onClose: () => void;
	overlayClassName?: string;
}

type FloatingDialogProps =
	| (FloatingDialogBaseProps & {
			as?: "div";
			onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
			onSubmit?: never;
	  })
	| (FloatingDialogBaseProps & {
			as: "form";
			onKeyDown?: KeyboardEventHandler<HTMLFormElement>;
			onSubmit: FormEventHandler<HTMLFormElement>;
	  });

const FLOATING_DIALOG_TRANSITION = { duration: 0.16, ease: [0.16, 1, 0.3, 1] } as const;

function FloatingDialog(props: FloatingDialogProps) {
	const { children, className, dataSlot, isOpen, labelledBy, onClose, overlayClassName } = props;

	useEffect(() => {
		if (!isOpen) {
			return undefined;
		}

		function handleKeyDown(event: globalThis.KeyboardEvent): void {
			if (event.key === "Escape") {
				onClose();
			}
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	const panelClassName = cn(
		"uix-flat-panel grid w-[min(680px,calc(100vw-40px))] gap-2 overflow-hidden p-2.5",
		className,
	);

	return (
		<AnimatePresence>
			{isOpen ? (
				<motion.div
					animate={{ opacity: 1 }}
					className={cn(
						"fixed inset-0 z-50 grid place-items-start justify-center bg-background/35 px-5 pt-[14vh] backdrop-blur-[2px]",
						overlayClassName,
					)}
					exit={{ opacity: 0 }}
					initial={{ opacity: 0 }}
					onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
						if (event.target === event.currentTarget) {
							onClose();
						}
					}}
					transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
				>
					{props.as === "form" ? (
						<motion.form
							aria-labelledby={labelledBy}
							aria-modal="true"
							animate={{ opacity: 1, scale: 1, y: 0 }}
							className={panelClassName}
							data-slot={dataSlot}
							exit={{ opacity: 0, scale: 0.985, y: 8 }}
							initial={{ opacity: 0, scale: 0.985, y: 8 }}
							onKeyDown={props.onKeyDown}
							onMouseDown={(event: MouseEvent<HTMLFormElement>) => event.stopPropagation()}
							onSubmit={props.onSubmit}
							role="dialog"
							transition={FLOATING_DIALOG_TRANSITION}
						>
							{children}
						</motion.form>
					) : (
						<motion.div
							aria-labelledby={labelledBy}
							aria-modal="true"
							animate={{ opacity: 1, scale: 1, y: 0 }}
							className={panelClassName}
							data-slot={dataSlot}
							exit={{ opacity: 0, scale: 0.985, y: 8 }}
							initial={{ opacity: 0, scale: 0.985, y: 8 }}
							onKeyDown={props.onKeyDown}
							onMouseDown={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
							role="dialog"
							transition={FLOATING_DIALOG_TRANSITION}
						>
							{children}
						</motion.div>
					)}
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}

function FloatingDialogHeader({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-1.5 pt-1", className)}
			{...props}
		/>
	);
}

function FloatingDialogTitle({ className, ...props }: ComponentProps<"h2">) {
	return <h2 className={cn("text-[13px] font-medium text-foreground", className)} {...props} />;
}

function FloatingDialogCloseButton({ className, ...props }: ComponentProps<"button">) {
	return (
		<button
			className={cn(
				"flex size-7 items-center justify-center rounded-[var(--uix-flat-radius-control)] bg-transparent text-[color:var(--text-tertiary)] transition-colors hover:bg-[color:var(--uix-flat-control-surface)] hover:text-[color:var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--uix-flat-focus-ring)]",
				className,
			)}
			type="button"
			{...props}
		>
			<X className="size-3.5" />
		</button>
	);
}

export { FloatingDialog, FloatingDialogCloseButton, FloatingDialogHeader, FloatingDialogTitle };
