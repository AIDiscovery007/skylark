export const motionDurations = {
	instant: 0,
	fast: 0.12,
	normal: 0.2,
	slow: 0.25,
} as const;

export const motionEasings = {
	emphasized: [0.16, 1, 0.3, 1],
	standard: [0.4, 0, 0.2, 1],
} as const;

export const microSpring = {
	type: "spring",
	stiffness: 340,
	damping: 30,
	mass: 0.7,
} as const;

export const layoutSpring = {
	type: "spring",
	stiffness: 300,
	damping: 34,
	mass: 0.8,
} as const;

export const panelSpring = {
	type: "spring",
	stiffness: 600,
	damping: 49,
} as const;

export const noMotionTransition = {
	duration: motionDurations.instant,
} as const;

export const menuSurfaceTransition = {
	duration: motionDurations.fast,
	ease: motionEasings.standard,
} as const;

export const statusIconTransition = {
	duration: 0.18,
	ease: motionEasings.standard,
} as const;

export const reviewPanelTransition = {
	type: "tween",
	duration: motionDurations.slow,
	ease: motionEasings.emphasized,
} as const;

export const sidebarWidthTransition = {
	type: "tween",
	duration: 0.22,
	ease: motionEasings.emphasized,
} as const;

export const sidebarContentTransition = {
	duration: motionDurations.fast,
	ease: motionEasings.emphasized,
} as const;

export const collapsibleTransition = {
	duration: motionDurations.normal,
	ease: motionEasings.emphasized,
} as const;

export const activityDrawerTransition = {
	duration: 0.4,
	ease: motionEasings.emphasized,
} as const;

export const softRevealTransition = {
	duration: motionDurations.fast,
	ease: motionEasings.emphasized,
} as const;

export const viewRevealTransition = {
	duration: motionDurations.normal,
	ease: motionEasings.emphasized,
} as const;

export const subtleReveal = {
	animate: { opacity: 1, y: 0 },
	exit: { opacity: 0, y: 4 },
	initial: { opacity: 0, y: 4 },
	transition: softRevealTransition,
} as const;

export const collapsibleReveal = {
	animate: { height: "auto", opacity: 1, y: 0 },
	exit: { height: 0, opacity: 0, y: -3 },
	initial: { height: 0, opacity: 0, y: -3 },
	transition: collapsibleTransition,
} as const;

export const viewReveal = {
	animate: { opacity: 1, y: 0 },
	exit: { opacity: 0, y: 6 },
	initial: { opacity: 0, y: 6 },
	transition: viewRevealTransition,
} as const;
