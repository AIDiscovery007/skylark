"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import type { ComponentProps, CSSProperties, HTMLAttributes } from "react";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { BundledLanguage, BundledTheme, HighlighterGeneric, ThemedToken } from "shiki/bundle/full";
import { getSingletonHighlighter } from "shiki/bundle/full";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Shiki uses bitflags for font styles: 1=italic, 2=bold, 4=underline
// oxlint-disable-next-line eslint(no-bitwise)
const isItalic = (fontStyle: number | undefined) => fontStyle && fontStyle & 1;
// oxlint-disable-next-line eslint(no-bitwise)
const isBold = (fontStyle: number | undefined) => fontStyle && fontStyle & 2;
const isUnderline = (fontStyle: number | undefined) =>
	// oxlint-disable-next-line eslint(no-bitwise)
	fontStyle && fontStyle & 4;

// Transform tokens to include pre-computed keys to avoid noArrayIndexKey lint
interface KeyedToken {
	token: ThemedToken;
	key: string;
}
interface KeyedLine {
	tokens: KeyedToken[];
	key: string;
}

const addKeysToTokens = (lines: ThemedToken[][]): KeyedLine[] =>
	lines.map((line, lineIdx) => ({
		key: `line-${lineIdx}`,
		tokens: line.map((token, tokenIdx) => ({
			key: `line-${lineIdx}-${tokenIdx}`,
			token,
		})),
	}));

// Token rendering component
const TokenSpan = ({ token }: { token: ThemedToken }) => (
	<span
		className="dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]"
		style={
			{
				backgroundColor: token.bgColor,
				color: token.color,
				fontStyle: isItalic(token.fontStyle) ? "italic" : undefined,
				fontWeight: isBold(token.fontStyle) ? "bold" : undefined,
				textDecoration: isUnderline(token.fontStyle) ? "underline" : undefined,
				...token.htmlStyle,
			} as CSSProperties
		}
	>
		{token.content}
	</span>
);

// Line number styles using CSS counters
const LINE_NUMBER_CLASSES = cn(
	"block",
	"before:content-[counter(line)]",
	"before:inline-block",
	"before:[counter-increment:line]",
	"before:w-8",
	"before:mr-4",
	"before:text-right",
	"before:text-muted-foreground/50",
	"before:font-mono",
	"before:select-none",
);

// Line rendering component
const LineSpan = ({ keyedLine, showLineNumbers }: { keyedLine: KeyedLine; showLineNumbers: boolean }) => (
	<span className={showLineNumbers ? LINE_NUMBER_CLASSES : "block"}>
		{keyedLine.tokens.length === 0
			? "\n"
			: keyedLine.tokens.map(({ token, key }) => <TokenSpan key={key} token={token} />)}
	</span>
);

// Types
export type CodeBlockLanguage = BundledLanguage | "text";

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
	bodyClassName?: string;
	code: string;
	contentClassName?: string;
	language: CodeBlockLanguage;
	showLineNumbers?: boolean;
	waitForHighlight?: boolean;
};

interface TokenizedCode {
	tokens: ThemedToken[][];
	fg: string;
	bg: string;
}

interface CodeBlockContextType {
	code: string;
}

// Context
const CodeBlockContext = createContext<CodeBlockContextType>({
	code: "",
});

// Highlighter cache (singleton per language)
const highlighterCache = new Map<string, Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>>();

// Token cache
const tokensCache = new Map<string, TokenizedCode>();

// Subscribers for async token updates
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>();
const errorSubscribers = new Map<string, Set<(error: Error) => void>>();

const getTokensCacheKey = (code: string, language: CodeBlockLanguage) => {
	const start = code.slice(0, 100);
	const end = code.length > 100 ? code.slice(-100) : "";
	return `${language}:${code.length}:${start}:${end}`;
};

const getCachedTokens = (code: string, language: CodeBlockLanguage): TokenizedCode | null =>
	tokensCache.get(getTokensCacheKey(code, language)) ?? null;

const highlighterEngine = createJavaScriptRegexEngine();

const getHighlighter = (language: BundledLanguage): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> => {
	const cached = highlighterCache.get(language);
	if (cached) {
		return cached;
	}

	const highlighterPromise = getSingletonHighlighter({
		engine: highlighterEngine,
		langs: [language],
		themes: ["github-light", "github-dark"],
	});

	highlighterCache.set(language, highlighterPromise);
	return highlighterPromise;
};

// Create raw tokens for immediate display while highlighting loads
const createRawTokens = (code: string): TokenizedCode => ({
	bg: "transparent",
	fg: "inherit",
	tokens: code.split("\n").map((line) =>
		line === ""
			? []
			: [
					{
						color: "inherit",
						content: line,
					} as ThemedToken,
				],
	),
});

// Synchronous highlight with callback for async results
export const highlightCode = (
	code: string,
	language: CodeBlockLanguage,
	// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
	callback?: (result: TokenizedCode) => void,
	// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
	onError?: (error: Error) => void,
): TokenizedCode | null => {
	const tokensCacheKey = getTokensCacheKey(code, language);

	if (language === "text") {
		const rawTokens = createRawTokens(code);
		tokensCache.set(tokensCacheKey, rawTokens);
		return rawTokens;
	}

	// Return cached result if available
	const cached = tokensCache.get(tokensCacheKey);
	if (cached) {
		return cached;
	}

	// Subscribe callback if provided
	if (callback) {
		if (!subscribers.has(tokensCacheKey)) {
			subscribers.set(tokensCacheKey, new Set());
		}
		subscribers.get(tokensCacheKey)?.add(callback);
	}
	if (onError) {
		if (!errorSubscribers.has(tokensCacheKey)) {
			errorSubscribers.set(tokensCacheKey, new Set());
		}
		errorSubscribers.get(tokensCacheKey)?.add(onError);
	}

	// Start highlighting in background - fire-and-forget async pattern
	getHighlighter(language)
		// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
		.then((highlighter) => {
			const availableLangs = highlighter.getLoadedLanguages();
			const langToUse = availableLangs.includes(language) ? language : "text";

			const result = highlighter.codeToTokens(code, {
				lang: langToUse,
				themes: {
					dark: "github-dark",
					light: "github-light",
				},
			});

			const tokenized: TokenizedCode = {
				bg: result.bg ?? "transparent",
				fg: result.fg ?? "inherit",
				tokens: result.tokens,
			};

			// Cache the result
			tokensCache.set(tokensCacheKey, tokenized);

			// Notify all subscribers
			const subs = subscribers.get(tokensCacheKey);
			if (subs) {
				for (const sub of subs) {
					sub(tokenized);
				}
				subscribers.delete(tokensCacheKey);
			}
			errorSubscribers.delete(tokensCacheKey);
		})
		// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(prefer-await-to-callbacks)
		.catch((error) => {
			console.error("Failed to highlight code:", error);
			highlighterCache.delete(language);
			subscribers.delete(tokensCacheKey);
			const subs = errorSubscribers.get(tokensCacheKey);
			if (subs) {
				const normalizedError = error instanceof Error ? error : new Error(String(error));
				for (const sub of subs) {
					sub(normalizedError);
				}
				errorSubscribers.delete(tokensCacheKey);
			}
		});

	return null;
};

const CodeBlockBody = memo(
	({
		tokenized,
		showLineNumbers,
		className,
	}: {
		tokenized: TokenizedCode;
		showLineNumbers: boolean;
		className?: string;
	}) => {
		const preStyle = useMemo(
			() => ({
				backgroundColor: tokenized.bg,
				color: tokenized.fg,
			}),
			[tokenized.bg, tokenized.fg],
		);

		const keyedLines = useMemo(() => addKeysToTokens(tokenized.tokens), [tokenized.tokens]);

		return (
			<pre
				className={cn("dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)] m-0 p-4 text-sm", className)}
				style={preStyle}
			>
				<code
					className={cn("font-mono text-sm", showLineNumbers && "[counter-increment:line_0] [counter-reset:line]")}
				>
					{keyedLines.map((keyedLine) => (
						<LineSpan key={keyedLine.key} keyedLine={keyedLine} showLineNumbers={showLineNumbers} />
					))}
				</code>
			</pre>
		);
	},
	(prevProps, nextProps) =>
		prevProps.tokenized === nextProps.tokenized &&
		prevProps.showLineNumbers === nextProps.showLineNumbers &&
		prevProps.className === nextProps.className,
);

CodeBlockBody.displayName = "CodeBlockBody";

export const CodeBlockContainer = ({
	className,
	language,
	style,
	...props
}: HTMLAttributes<HTMLDivElement> & { language: string }) => (
	<div
		className={cn("group relative w-full overflow-hidden rounded-md border bg-background text-foreground", className)}
		data-language={language}
		style={{
			containIntrinsicSize: "auto 200px",
			contentVisibility: "auto",
			...style,
		}}
		{...props}
	/>
);

export const CodeBlockHeader = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex items-center justify-between border-b bg-muted/80 px-3 py-2 text-muted-foreground text-xs",
			className,
		)}
		{...props}
	>
		{children}
	</div>
);

export const CodeBlockTitle = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex items-center gap-2", className)} {...props}>
		{children}
	</div>
);

export const CodeBlockFilename = ({ children, className, ...props }: HTMLAttributes<HTMLSpanElement>) => (
	<span className={cn("font-mono", className)} {...props}>
		{children}
	</span>
);

export const CodeBlockActions = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("-my-1 -mr-1 flex items-center gap-2", className)} {...props}>
		{children}
	</div>
);

export const CodeBlockContent = ({
	bodyClassName,
	code,
	className,
	language,
	showLineNumbers = false,
	waitForHighlight = false,
}: {
	bodyClassName?: string;
	code: string;
	className?: string;
	language: CodeBlockLanguage;
	showLineNumbers?: boolean;
	waitForHighlight?: boolean;
}) => {
	// Memoized raw tokens for immediate display
	const rawTokens = useMemo(() => createRawTokens(code), [code]);

	// Synchronous cache lookup — avoids setState in effect for cached results
	const syncTokens = useMemo(() => {
		const cached = getCachedTokens(code, language);
		if (cached) {
			return cached;
		}
		if (waitForHighlight) {
			return language === "text" ? highlightCode(code, language) : null;
		}
		return highlightCode(code, language) ?? rawTokens;
	}, [code, language, rawTokens, waitForHighlight]);

	// Async highlighting result (populated after shiki loads)
	const [asyncTokens, setAsyncTokens] = useState<TokenizedCode | null>(null);
	const [highlightError, setHighlightError] = useState<Error | undefined>();
	const asyncKeyRef = useRef({ code, language });

	// Invalidate stale async tokens synchronously during render
	if (asyncKeyRef.current.code !== code || asyncKeyRef.current.language !== language) {
		asyncKeyRef.current = { code, language };
		setAsyncTokens(null);
		setHighlightError(undefined);
	}

	useEffect(() => {
		let cancelled = false;

		const immediateTokens = highlightCode(
			code,
			language,
			(result) => {
				if (!cancelled) {
					setAsyncTokens(result);
					setHighlightError(undefined);
				}
			},
			(error) => {
				if (!cancelled) {
					setHighlightError(error);
				}
			},
		);
		if (immediateTokens && !cancelled) {
			setAsyncTokens(immediateTokens);
			setHighlightError(undefined);
		}

		return () => {
			cancelled = true;
		};
	}, [code, language]);

	const tokenized = asyncTokens ?? syncTokens;
	const shouldShowLoading = waitForHighlight && !tokenized && !highlightError;
	const shouldShowErrorFallback = waitForHighlight && !tokenized && highlightError;

	return (
		<div className={cn("relative overflow-auto", className)}>
			{shouldShowLoading ? (
				<div
					className="grid min-h-32 place-items-center gap-2 px-4 py-6 text-muted-foreground text-sm"
					data-slot="code-block-highlight-loading"
				>
					<Spinner className="size-4" />
					<span>Rendering code...</span>
				</div>
			) : null}
			{shouldShowErrorFallback ? (
				<div>
					<div
						className="border-b border-border/60 px-4 py-2 text-muted-foreground text-xs"
						data-slot="code-block-highlight-error"
					>
						Syntax highlighting failed. Showing plain text.
					</div>
					<CodeBlockBody className={bodyClassName} showLineNumbers={showLineNumbers} tokenized={rawTokens} />
				</div>
			) : null}
			{tokenized ? (
				<CodeBlockBody className={bodyClassName} showLineNumbers={showLineNumbers} tokenized={tokenized} />
			) : null}
		</div>
	);
};

export const CodeBlock = ({
	bodyClassName,
	code,
	contentClassName,
	language,
	showLineNumbers = false,
	waitForHighlight = false,
	className,
	children,
	...props
}: CodeBlockProps) => {
	const contextValue = useMemo(() => ({ code }), [code]);

	return (
		<CodeBlockContext.Provider value={contextValue}>
			<CodeBlockContainer className={className} language={language} {...props}>
				{children}
				<CodeBlockContent
					bodyClassName={bodyClassName}
					className={contentClassName}
					code={code}
					language={language}
					showLineNumbers={showLineNumbers}
					waitForHighlight={waitForHighlight}
				/>
			</CodeBlockContainer>
		</CodeBlockContext.Provider>
	);
};

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
	onCopy?: () => void;
	onError?: (error: Error) => void;
	timeout?: number;
};

export const CodeBlockCopyButton = ({
	onCopy,
	onError,
	timeout = 2000,
	children,
	className,
	...props
}: CodeBlockCopyButtonProps) => {
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<number>(0);
	const { code } = useContext(CodeBlockContext);

	const copyToClipboard = useCallback(async () => {
		if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
			onError?.(new Error("Clipboard API not available"));
			return;
		}

		try {
			if (!isCopied) {
				await navigator.clipboard.writeText(code);
				setIsCopied(true);
				onCopy?.();
				timeoutRef.current = window.setTimeout(() => setIsCopied(false), timeout);
			}
		} catch (error) {
			onError?.(error as Error);
		}
	}, [code, onCopy, onError, timeout, isCopied]);

	useEffect(
		() => () => {
			window.clearTimeout(timeoutRef.current);
		},
		[],
	);

	const Icon = isCopied ? CheckIcon : CopyIcon;

	return (
		<Button className={cn("shrink-0", className)} onClick={copyToClipboard} size="icon" variant="ghost" {...props}>
			{children ?? <Icon size={14} />}
		</Button>
	);
};

export type CodeBlockLanguageSelectorProps = ComponentProps<typeof Select>;

export const CodeBlockLanguageSelector = (props: CodeBlockLanguageSelectorProps) => <Select {...props} />;

export type CodeBlockLanguageSelectorTriggerProps = ComponentProps<typeof SelectTrigger>;

export const CodeBlockLanguageSelectorTrigger = ({ className, ...props }: CodeBlockLanguageSelectorTriggerProps) => (
	<SelectTrigger
		className={cn("h-7 border-none bg-transparent px-2 text-xs shadow-none", className)}
		size="sm"
		{...props}
	/>
);

export type CodeBlockLanguageSelectorValueProps = ComponentProps<typeof SelectValue>;

export const CodeBlockLanguageSelectorValue = (props: CodeBlockLanguageSelectorValueProps) => (
	<SelectValue {...props} />
);

export type CodeBlockLanguageSelectorContentProps = ComponentProps<typeof SelectContent>;

export const CodeBlockLanguageSelectorContent = ({
	align = "end",
	...props
}: CodeBlockLanguageSelectorContentProps) => <SelectContent align={align} {...props} />;

export type CodeBlockLanguageSelectorItemProps = ComponentProps<typeof SelectItem>;

export const CodeBlockLanguageSelectorItem = (props: CodeBlockLanguageSelectorItemProps) => <SelectItem {...props} />;
