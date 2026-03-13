/// Consolidation progress bar with phase label.
/// Animated fill with smooth spring transitions.

import SwiftUI

/// Progress bar for the Nidra (sleep/consolidation) cycle.
///
/// Shows the current consolidation phase label above a gradient-filled bar.
/// When active, uses a purple gradient; when inactive, a muted amber gradient
/// to indicate a paused or completed state.
///
/// - Parameters:
///   - progress: Completion percentage (0..100).
///   - phase: Current phase name (e.g. "embedding", "compaction"). Shown above the bar when non-empty.
///   - isActive: Whether consolidation is currently running. Controls gradient color and label tint.
struct NidraProgressBar: View {
    let progress: Double
    let phase: String?
    let isActive: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sp4) {
            if let phase, !phase.isEmpty {
                Text(phase.capitalized)
                    .font(.system(size: Theme.miniSize))
                    .foregroundColor(isActive ? Theme.purple : Theme.tertiaryLabel)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    // Track (background)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Theme.label.opacity(0.06))
                    // Fill: width derived from progress (0..100), clamped to avoid overflow.
                    RoundedRectangle(cornerRadius: 3)
                        .fill(
                            LinearGradient(
                                colors: isActive
                                    ? [Theme.purple, Theme.purple.opacity(0.6)]
                                    : [Theme.amber.opacity(0.4), Theme.amber.opacity(0.2)],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: max(0, geo.size.width * CGFloat(min(progress, 100)) / 100))
                        .animation(.spring(response: 0.6, dampingFraction: 0.8), value: progress)
                }
            }
            .frame(height: 5)
        }
    }
}
