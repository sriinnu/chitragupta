/// Capsule badge showing instance state with optional pulsing dot
/// for busy/consolidating states. Uses appearance-adaptive colors.

import SwiftUI

/// Capsule-shaped badge that displays the human-readable state of an MCP instance.
///
/// Active instances get a pulsing dot (breathing animation) to draw attention.
/// State strings from the daemon (e.g. "thinking", "consolidating", "deep_sleep")
/// are normalized to user-friendly labels via `humanLabel`.
///
/// - Parameters:
///   - state: Raw state string from the daemon.
///   - isActive: Whether the instance is currently doing work (controls pulse dot visibility).
struct StateBadge: View {
    let state: String
    let isActive: Bool
    /// Drives the breathing animation on the activity dot.
    @State private var isPulsing = false

    var body: some View {
        HStack(spacing: 4) {
            if isActive {
                // Pulsing dot: animates opacity between 0.3 and 1.0 in a continuous loop.
                Circle()
                    .fill(badgeColor)
                    .frame(width: 6, height: 6)
                    .opacity(isPulsing ? 1.0 : 0.3)
                    .onAppear {
                        withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
                            isPulsing = true
                        }
                    }
            }
            Text(humanLabel.lowercased())
                .font(.system(size: Theme.miniSize, weight: .medium))
                .foregroundColor(badgeColor)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(badgeColor.opacity(0.12))
        .clipShape(Capsule())
    }

    /// Maps daemon state codes to concise user-facing labels.
    /// Multiple backend states collapse into a single display label
    /// (e.g. "thinking" and "busy" both show as "Active").
    private var humanLabel: String {
        switch state.lowercased() {
        case "active", "thinking", "busy": return "Active"
        case "idle": return "Idle"
        case "error": return "Error"
        case "consolidating", "dreaming": return "Learning"
        case "sleeping", "deep_sleep": return "Sleeping"
        default: return state
        }
    }

    /// Semantic color matching the state's urgency/category.
    private var badgeColor: Color {
        switch state.lowercased() {
        case "active", "thinking", "busy": return Theme.alive
        case "idle": return Theme.secondaryLabel
        case "error": return Theme.coral
        case "consolidating", "dreaming": return Theme.purple
        default: return Theme.tertiaryLabel
        }
    }
}
