import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App.tsx";
import { markRendererPerformance } from "./lib/performance-marks.ts";
import "./styles/globals.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Root element not found");
}

markRendererPerformance("renderer:bootstrap:start");

createRoot(rootElement).render(
	<StrictMode>
		<MotionConfig reducedMotion="user">
			<TooltipProvider delayDuration={120}>
				<App />
			</TooltipProvider>
		</MotionConfig>
	</StrictMode>,
);
