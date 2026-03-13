/// Multi-line client card for connected MCP instances.
///
/// Line 1: icon + name + state badge
/// Line 2: workspace . transport . model
/// Line 3: PID . uptime . tools . turns
/// Line 4: context pressure bar (if >0)
/// Line 5: attention warnings (if any)
///
/// Smooth spring hover with subtle scale lift.

import SwiftUI

/// Renders a multi-line summary card for a single connected MCP client instance.
///
/// Adapts its content dynamically -- lines 2-5 only appear when their
/// backing data is non-nil, so dormant or minimal instances stay compact.
struct ClientCard: View {
    let instance: InstanceInfo
    /// Tracks pointer hover for the spring-based scale lift animation.
    @State private var isHovered = false

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sp6) {
            // Line 1: icon + name + state badge
            HStack(spacing: Theme.sp8) {
                clientIcon
                    .frame(width: 28, height: 28)
                    .background(Theme.label.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSm, style: .continuous))

                Text(instance.displayName)
                    .font(.system(size: Theme.bodySize, weight: .semibold))
                    .foregroundColor(Theme.label)
                    .lineLimit(1)

                Spacer()

                if let state = instance.state {
                    StateBadge(state: state, isActive: instance.isCurrentlyActive)
                }
            }

            // Line 2: workspace . transport . model
            HStack(spacing: Theme.sp4) {
                if let ws = instance.workspaceName {
                    Label(ws, systemImage: "folder")
                        .font(.system(size: Theme.captionSize))
                        .foregroundColor(Theme.secondaryLabel)
                        .lineLimit(1)
                }
                if let transport = instance.transport {
                    dotSeparator
                    Text(transport)
                        .font(.system(size: Theme.captionSize))
                        .foregroundColor(Theme.tertiaryLabel)
                }
                if let model = instance.shortModel {
                    dotSeparator
                    Text(model)
                        .font(.system(size: Theme.captionSize, weight: .medium, design: .monospaced))
                        .foregroundColor(Theme.secondaryLabel)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Theme.label.opacity(0.06))
                        .clipShape(Capsule())
                }
            }

            // Line 3: PID . uptime . tools . turns
            HStack(spacing: Theme.sp4) {
                if let pid = instance.pid {
                    Text("PID \(pid)")
                        .font(.system(size: Theme.miniSize, design: .monospaced))
                        .foregroundColor(Theme.tertiaryLabel)
                }
                if let uptime = instance.uptimeString {
                    dotSeparator
                    Text(uptime)
                        .font(.system(size: Theme.miniSize))
                        .foregroundColor(Theme.tertiaryLabel)
                }
                if let tools = instance.toolCallCount {
                    dotSeparator
                    HStack(spacing: 2) {
                        Image(systemName: "wrench.and.screwdriver")
                            .font(.system(size: 8))
                        Text("\(tools)")
                            .font(.system(size: Theme.miniSize, design: .monospaced))
                    }
                    .foregroundColor(Theme.tertiaryLabel)
                }
                if let turns = instance.turnCount, turns > 0 {
                    dotSeparator
                    Text("\(turns) trn")
                        .font(.system(size: Theme.miniSize))
                        .foregroundColor(Theme.tertiaryLabel)
                }
            }

            // Line 4: context pressure bar
            if let pressure = instance.contextPressure, pressure > 0 {
                ContextPressureBar(pressure: pressure)
            }

            // Line 5: attention warnings
            if instance.needsAttention == true, let reasons = instance.attentionReasons, !reasons.isEmpty {
                HStack(spacing: Theme.sp4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 10))
                        .foregroundColor(Theme.coral)
                    Text(reasons.map { humanizeReason($0) }.joined(separator: ", "))
                        .font(.system(size: Theme.miniSize))
                        .foregroundColor(Theme.coral)
                        .lineLimit(2)
                }
            }
        }
        .padding(Theme.sp12)
        .background(isHovered ? Theme.label.opacity(0.05) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
        .scaleEffect(isHovered ? 1.008 : 1.0)
        .onHover { hovering in
            withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
                isHovered = hovering
            }
        }
    }

    // MARK: - Client Icon

    /// Resolves an SF Symbol icon based on the instance's display name or agent string.
    /// Falls back to a generic "connected apps" icon for unrecognized clients.
    @ViewBuilder
    private var clientIcon: some View {
        let name = instance.displayName.lowercased()
        let agent = instance.agent?.lowercased() ?? ""

        if name.contains("claude") || agent.contains("claude") {
            Image(systemName: "terminal")
                .font(.system(size: 13))
                .foregroundColor(Theme.amber)
        } else if name.contains("cursor") {
            Image(systemName: "cursorarrow.rays")
                .font(.system(size: 13))
                .foregroundColor(Theme.blue)
        } else if name.contains("vscode") || name.contains("code") {
            Image(systemName: "chevron.left.forwardslash.chevron.right")
                .font(.system(size: 11))
                .foregroundColor(Theme.blue)
        } else if name.contains("vaayu") || agent.contains("vaayu") {
            Image(systemName: "wind")
                .font(.system(size: 13))
                .foregroundColor(Theme.purple)
        } else if agent == "mcp" {
            Image(systemName: "server.rack")
                .font(.system(size: 12))
                .foregroundColor(Theme.secondaryLabel)
        } else {
            Image(systemName: "app.connected.to.app.below.fill")
                .font(.system(size: 13))
                .foregroundColor(Theme.secondaryLabel)
        }
    }

    /// Middle-dot separator (U+00B7) used between metadata items on lines 2 and 3.
    private var dotSeparator: some View {
        Text("\u{00B7}")
            .font(.system(size: Theme.captionSize, weight: .bold))
            .foregroundColor(Theme.tertiaryLabel)
    }

    /// Converts snake_case attention reason codes from the daemon into user-facing labels.
    /// Known codes get curated copy; unknown ones are auto-capitalized with underscores replaced.
    private func humanizeReason(_ reason: String) -> String {
        switch reason {
        case "missing_session_identity": return "Missing session identity"
        case "missing_model": return "Missing model"
        case "busy_too_long": return "Busy too long"
        default: return reason.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}
