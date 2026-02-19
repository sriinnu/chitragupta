/**
 * Visual match pairing component.
 *
 * Displays a 4x4 grid of icons. The user selects 4 icons in order
 * to form a visual passphrase. Selected icons are shown below the
 * grid. A Clear button resets the selection.
 * @module auth/visual-match
 */

import { useState, useCallback } from "preact/hooks";

// ── Types ─────────────────────────────────────────────────────────

/** Props for the visual match component. */
export interface VisualMatchProps {
	/** Icon set from the server challenge to display in the grid. */
	iconSet: string[];
	/** Callback invoked with the selected icon strings on submission. */
	onSubmit: (icons: string[]) => void;
	/** Whether submission is in progress. */
	loading?: boolean;
}

const REQUIRED_COUNT = 4;

// ── Component ─────────────────────────────────────────────────────

/**
 * Icon grid picker for visual-match device pairing.
 *
 * The user taps/clicks icons from a 4x4 grid to select exactly 4 in
 * order. The selection is displayed below the grid and can be cleared.
 * Submission is automatic once 4 icons are selected, or manual via button.
 */
export function VisualMatch({ iconSet, onSubmit, loading }: VisualMatchProps): preact.JSX.Element {
	const [selected, setSelected] = useState<number[]>([]);

	const handleIconClick = useCallback((index: number) => {
		setSelected((prev) => {
			if (prev.length >= REQUIRED_COUNT) return prev;
			if (prev.includes(index)) return prev;
			return [...prev, index];
		});
	}, []);

	const handleClear = useCallback(() => {
		setSelected([]);
	}, []);

	const canSubmit = selected.length === REQUIRED_COUNT && !loading;

	return (
		<div>
			{/* Icon grid */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(4, 1fr)",
					gap: "8px",
					marginBottom: "16px",
				}}
			>
				{iconSet.map((icon, i) => {
					const isSelected = selected.includes(i);
					const order = isSelected ? selected.indexOf(i) + 1 : null;

					return (
						<button
							key={i}
							onClick={() => handleIconClick(i)}
							disabled={isSelected || selected.length >= REQUIRED_COUNT}
							style={{
								width: "56px",
								height: "56px",
								fontSize: "24px",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								background: isSelected ? "rgba(99, 102, 241, 0.2)" : "#16161e",
								border: isSelected ? "2px solid #6366f1" : "1px solid #2a2a3a",
								borderRadius: "8px",
								cursor: isSelected || selected.length >= REQUIRED_COUNT ? "default" : "pointer",
								position: "relative",
								margin: "0 auto",
							}}
						>
							{icon}
							{order !== null && (
								<span
									style={{
										position: "absolute",
										top: "-6px",
										right: "-6px",
										background: "#6366f1",
										color: "#fff",
										borderRadius: "50%",
										width: "18px",
										height: "18px",
										fontSize: "11px",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
									}}
								>
									{order}
								</span>
							)}
						</button>
					);
				})}
			</div>

			{/* Selection display */}
			<div
				style={{
					display: "flex",
					gap: "8px",
					marginBottom: "16px",
					minHeight: "40px",
					alignItems: "center",
				}}
			>
				<span style={{ color: "#8888a0", fontSize: "13px", marginRight: "4px" }}>
					Selected:
				</span>
				{selected.map((idx, i) => (
					<span key={i} style={{ fontSize: "20px" }}>{iconSet[idx]}</span>
				))}
				{selected.length < REQUIRED_COUNT && (
					<span style={{ color: "#8888a0", fontSize: "13px" }}>
						({REQUIRED_COUNT - selected.length} more)
					</span>
				)}
			</div>

			{/* Actions */}
			<div style={{ display: "flex", gap: "8px" }}>
				<button
					onClick={handleClear}
					style={{
						padding: "10px 20px",
						background: "#2a2a3a",
						color: "#e8e8ed",
						border: "none",
						borderRadius: "6px",
						fontSize: "14px",
						cursor: "pointer",
						flex: "0 0 auto",
					}}
				>
					Clear
				</button>
				<button
					disabled={!canSubmit}
					onClick={() => onSubmit(selected.map((idx) => iconSet[idx]))}
					style={{
						padding: "10px 24px",
						background: canSubmit ? "#6366f1" : "#2a2a3a",
						color: canSubmit ? "#fff" : "#8888a0",
						border: "none",
						borderRadius: "6px",
						fontSize: "14px",
						cursor: canSubmit ? "pointer" : "default",
						flex: 1,
					}}
				>
					{loading ? "Verifying..." : "Submit Visual Match"}
				</button>
			</div>
		</div>
	);
}
