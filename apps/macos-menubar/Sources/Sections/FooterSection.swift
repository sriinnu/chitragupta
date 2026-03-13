/// Footer — action buttons. Consolidate (amber primary), Hub (secondary),
/// Stop (red circle), Quit (gray circle). Fixed at bottom.
/// Buttons have smooth hover scale feedback.

import SwiftUI

/// Pinned footer toolbar with context-sensitive actions.
/// When connected: Consolidate (triggers nidra consolidation cycle), Hub (opens dashboard),
/// Stop (kills the daemon process). Always visible: Quit (terminates the menubar app).
struct FooterSection: View {
    @ObservedObject var client: DaemonClient

    var body: some View {
        HStack(spacing: Theme.sp8) {
            // Primary actions — only available when the daemon is reachable
            if client.isConnected {
                LiquidButton(
                    label: "Consolidate",
                    icon: "sparkles",
                    foreground: .black,
                    background: Theme.amber
                ) {
                    Task { await client.consolidate() }
                }

                LiquidButton(
                    label: "Hub",
                    icon: "globe",
                    foreground: Theme.label,
                    background: Theme.label.opacity(0.08)
                ) {
                    client.openHub()
                }
            }

            Spacer()

            // Destructive / app-level actions on the trailing edge
            if client.isConnected {
                LiquidCircleButton(
                    icon: "power",
                    foreground: Theme.coral,
                    background: Theme.coral.opacity(0.1),
                    help: "Stop daemon"
                ) {
                    Task { await client.stopDaemon() }
                }
            }

            LiquidCircleButton(
                icon: "xmark",
                iconSize: 9,
                foreground: Theme.secondaryLabel,
                background: Theme.label.opacity(0.06),
                help: "Quit menubar app"
            ) {
                NSApplication.shared.terminate(nil)
            }
        }
        .padding(.horizontal, Theme.sp16)
        .padding(.vertical, Theme.sp12)
    }
}

// MARK: - Liquid Button (capsule, with hover scale)

/// Capsule-shaped button with icon + label. Spring-animated hover scale and
/// a subtle shadow glow provide tactile feedback in the popover context.
///
/// - Parameters:
///   - label: Button text.
///   - icon: SF Symbol name.
///   - foreground: Text/icon color.
///   - background: Fill color (also used for hover shadow tint).
///   - action: Tap handler.
private struct LiquidButton: View {
    let label: String
    let icon: String
    let foreground: Color
    let background: Color
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.sp4) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))
                Text(label)
                    .font(.system(size: Theme.captionSize, weight: .semibold))
            }
            .foregroundColor(foreground)
            .padding(.horizontal, Theme.sp12)
            .padding(.vertical, Theme.sp6)
            .background(background)
            .clipShape(Capsule())
            .scaleEffect(isHovered ? 1.04 : 1.0)
            .shadow(color: isHovered ? background.opacity(0.3) : .clear, radius: 4, y: 1)
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                isHovered = hovering
            }
        }
    }
}

// MARK: - Liquid Circle Button (icon only, with hover scale)

/// Icon-only circular button with hover scale and shadow feedback.
/// Includes a native tooltip via `.help()`.
private struct LiquidCircleButton: View {
    let icon: String
    var iconSize: CGFloat = 11
    let foreground: Color
    let background: Color
    let help: String
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: iconSize, weight: .medium))
                .foregroundColor(foreground)
                .frame(width: 28, height: 28)
                .background(background)
                .clipShape(Circle())
                .scaleEffect(isHovered ? 1.1 : 1.0)
                .shadow(color: isHovered ? foreground.opacity(0.2) : .clear, radius: 3, y: 1)
        }
        .buttonStyle(.plain)
        .help(help)
        .onHover { hovering in
            withAnimation(.spring(response: 0.2, dampingFraction: 0.7)) {
                isHovered = hovering
            }
        }
    }
}
