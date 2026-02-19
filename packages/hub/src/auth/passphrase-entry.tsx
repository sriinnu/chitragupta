/**
 * Four-word passphrase entry component for device pairing.
 *
 * Renders four input fields in a row with autocomplete dropdowns that
 * filter a word list as the user types (after 2 characters). Tab/Enter
 * advances focus to the next field.
 * @module auth/passphrase-entry
 */

import { useState, useRef, useCallback } from "preact/hooks";

// ── Types ─────────────────────────────────────────────────────────

/** Props for the passphrase entry component. */
export interface PassphraseEntryProps {
	/** Callback invoked with the 4-word array on submission. */
	onSubmit: (words: string[]) => void;
	/** Whether submission is currently in progress. */
	loading?: boolean;
}

// ── Word list (subset for autocomplete) ───────────────────────────

const WORD_LIST = [
	"alpha", "anchor", "arrow", "atlas", "autumn",
	"beacon", "birch", "blaze", "bridge", "bronze",
	"canyon", "cedar", "cipher", "cobalt", "coral",
	"dawn", "delta", "drift", "dune", "dusk",
	"ember", "echo", "elder", "emerald", "epoch",
	"falcon", "fern", "flame", "flint", "forge",
	"glacier", "grove", "guard", "gust", "glyph",
	"harbor", "haven", "hawk", "haze", "helm",
	"iris", "iron", "ivory", "isle", "ignite",
	"jade", "jasper", "jewel", "jovial", "juniper",
	"karma", "kelp", "kernel", "kindle", "knot",
	"lark", "lava", "leaf", "lunar", "lynx",
	"maple", "marble", "marsh", "mist", "moth",
	"nebula", "nest", "nimbus", "noble", "nova",
	"oak", "oasis", "onyx", "orbit", "osprey",
	"pebble", "pine", "prism", "pulse", "pyre",
	"quartz", "quest", "quill", "quiet", "quirk",
	"raven", "reef", "ridge", "river", "rune",
	"sage", "sapphire", "shadow", "shore", "slate",
	"thorn", "tide", "timber", "torch", "trail",
	"umbra", "unity", "umber", "urchin", "utopia",
	"vale", "vapor", "vault", "vine", "violet",
	"warden", "wave", "whisper", "willow", "wren",
];

const WORD_COUNT = 4;

// ── Component ─────────────────────────────────────────────────────

/**
 * Four-word passphrase input with autocomplete suggestions.
 *
 * Each field shows a filtered dropdown after 2 characters are typed.
 * Tab and Enter advance focus to the next field. Submission is
 * triggered by the Submit button once all four words are filled.
 */
export function PassphraseEntry({ onSubmit, loading }: PassphraseEntryProps): preact.JSX.Element {
	const [words, setWords] = useState<string[]>(Array(WORD_COUNT).fill(""));
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

	const updateWord = useCallback((index: number, value: string) => {
		setWords((prev) => {
			const next = [...prev];
			next[index] = value.toLowerCase();
			return next;
		});
	}, []);

	const selectSuggestion = useCallback((index: number, word: string) => {
		updateWord(index, word);
		setActiveIndex(null);
		// Advance to next field
		if (index < WORD_COUNT - 1) {
			inputRefs.current[index + 1]?.focus();
		}
	}, [updateWord]);

	const handleKeyDown = useCallback((index: number, e: KeyboardEvent) => {
		if ((e.key === "Tab" || e.key === "Enter") && index < WORD_COUNT - 1) {
			e.preventDefault();
			setActiveIndex(null);
			inputRefs.current[index + 1]?.focus();
		}
	}, []);

	const canSubmit = words.every((w) => w.trim().length > 0) && !loading;

	return (
		<div>
			<div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
				{words.map((word, i) => {
					const filtered = word.length >= 2
						? WORD_LIST.filter((w) => w.startsWith(word) && w !== word).slice(0, 6)
						: [];
					const showDropdown = activeIndex === i && filtered.length > 0;

					return (
						<div key={i} style={{ position: "relative", flex: "1 1 120px" }}>
							<input
								ref={(el) => { inputRefs.current[i] = el; }}
								type="text"
								value={word}
								placeholder={`Word ${i + 1}`}
								onInput={(e) => updateWord(i, (e.target as HTMLInputElement).value)}
								onFocus={() => setActiveIndex(i)}
								onBlur={() => setTimeout(() => setActiveIndex(null), 150)}
								onKeyDown={(e) => handleKeyDown(i, e)}
								style={{
									width: "100%",
									padding: "10px 12px",
									background: "#16161e",
									border: "1px solid #2a2a3a",
									borderRadius: "6px",
									color: "#e8e8ed",
									fontSize: "14px",
									outline: "none",
								}}
							/>
							{showDropdown && (
								<div
									style={{
										position: "absolute",
										top: "100%",
										left: 0,
										right: 0,
										background: "#1e1e2a",
										border: "1px solid #2a2a3a",
										borderRadius: "0 0 6px 6px",
										zIndex: 10,
										maxHeight: "160px",
										overflowY: "auto",
									}}
								>
									{filtered.map((w) => (
										<div
											key={w}
											onMouseDown={() => selectSuggestion(i, w)}
											style={{
												padding: "6px 12px",
												cursor: "pointer",
												fontSize: "13px",
												color: "#e8e8ed",
											}}
										>
											{w}
										</div>
									))}
								</div>
							)}
						</div>
					);
				})}
			</div>

			<button
				disabled={!canSubmit}
				onClick={() => onSubmit(words)}
				style={{
					padding: "10px 24px",
					background: canSubmit ? "#6366f1" : "#2a2a3a",
					color: canSubmit ? "#fff" : "#8888a0",
					border: "none",
					borderRadius: "6px",
					fontSize: "14px",
					cursor: canSubmit ? "pointer" : "default",
					width: "100%",
				}}
			>
				{loading ? "Verifying..." : "Submit Passphrase"}
			</button>
		</div>
	);
}
