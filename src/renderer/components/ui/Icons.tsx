import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function PiMarkIcon(props: IconProps) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.8"
			viewBox="0 0 24 24"
			{...props}
		>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M9.25 10.5h.01" />
			<path d="M14.75 10.5h.01" />
			<path d="M9.4 14.1c.9 1 2 1.4 2.6 1.4s1.7-.4 2.6-1.4" />
			<path d="M12 3.5v1.8" />
		</svg>
	);
}
