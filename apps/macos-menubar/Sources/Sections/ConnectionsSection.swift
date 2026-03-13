/// Connections section — section header with count badges + active/attention
/// indicators. Full ClientCard list for instances, RuntimeRow fallback
/// for raw connections, overflow indicator for long lists.

import SwiftUI

/// Displays all connected MCP clients, preferring rich `InstanceInfo` cards
/// (from heartbeat telemetry) over raw `RuntimeItem` rows (from socket tracking).
/// Falls back gracefully through four display states: instances list, runtime list,
/// count-only summary, or empty placeholder.
struct ConnectionsSection: View {
    let active: ActiveInfo?
    let runtime: RuntimeInfo?
    let daemon: DaemonInfo

    /// Rich client instances from heartbeat telemetry (preferred display path).
    private var instances: [InstanceInfo] {
        active?.instances ?? []
    }

    /// Raw socket-level connections, used when no heartbeat instances are available.
    private var runtimeItems: [RuntimeItem] {
        runtime?.items ?? []
    }

    /// Best-effort total: daemon-reported count takes priority, then runtime socket count.
    private var totalConnections: Int {
        daemon.connections ?? runtime?.connected ?? 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sp8) {
            // Section header with badges
            HStack(spacing: Theme.sp6) {
                Text("CONNECTIONS")
                    .font(.system(size: Theme.miniSize, weight: .medium))
                    .foregroundColor(Theme.secondaryLabel)
                    .tracking(0.5)

                if !instances.isEmpty {
                    headerBadge("\(instances.count) instance\(instances.count == 1 ? "" : "s")")
                }

                if totalConnections > 0 {
                    headerBadge("\(totalConnections) socket\(totalConnections == 1 ? "" : "s")")
                }

                Spacer()

                if let activeNow = active?.activeNowCount, activeNow > 0 {
                    HStack(spacing: 3) {
                        Circle()
                            .fill(Theme.alive)
                            .frame(width: 6, height: 6)
                        Text("\(activeNow) active")
                            .font(.system(size: Theme.miniSize, weight: .medium))
                            .foregroundColor(Theme.alive)
                    }
                }

                if let attention = active?.attentionCount, attention > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 9))
                            .foregroundColor(Theme.coral)
                        Text("\(attention)")
                            .font(.system(size: Theme.miniSize, weight: .medium))
                            .foregroundColor(Theme.coral)
                    }
                }
            }
            .padding(.horizontal, Theme.sp16)

            // Network topology visualization — shows when there are connections
            if totalConnections > 0 || !instances.isEmpty {
                HStack {
                    Spacer()
                    ConnectionTopology(
                        instances: instances,
                        runtimeItems: runtimeItems,
                        totalConnections: totalConnections
                    )
                    Spacer()
                }
                .padding(.vertical, Theme.sp4)
            }

            // Content — cascading fallback: instances > runtime items > count-only > empty
            InsetGroupedSection {
                if totalConnections == 0 && instances.isEmpty {
                    emptyState
                } else if !instances.isEmpty {
                    instancesList
                } else if !runtimeItems.isEmpty {
                    runtimeList
                } else {
                    countOnlyState
                }
            }
        }
    }

    // MARK: - Subviews

    private var emptyState: some View {
        HStack(spacing: Theme.sp12) {
            Image(systemName: "person.slash")
                .font(.system(size: 16))
                .foregroundColor(Theme.tertiaryLabel)
            Text("No clients connected")
                .font(.system(size: Theme.bodySize))
                .foregroundColor(Theme.tertiaryLabel)
        }
        .frame(maxWidth: .infinity)
        .padding(Theme.sp16)
    }

    /// Sorted instance cards: active instances first, then by ascending uptime
    /// (newest on top). Shows an overflow indicator when daemon reports more
    /// connections than the heartbeat list contains.
    @ViewBuilder
    private var instancesList: some View {
        let sorted = instances.sorted { instanceSort($0, $1) }
        ForEach(Array(sorted.enumerated()), id: \.element.id) { idx, inst in
            VStack(spacing: 0) {
                ClientCard(instance: inst)
                if idx < sorted.count - 1 {
                    Divider().padding(.leading, Theme.sp16)
                }
            }
        }

        // Overflow: daemon may track more connections than heartbeat instances
        let extra = totalConnections - instances.count
        if extra > 0 {
            VStack(spacing: 0) {
                Divider().padding(.leading, Theme.sp16)
                HStack(spacing: Theme.sp6) {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 10))
                        .foregroundColor(Theme.tertiaryLabel)
                    Text("+ \(extra) more connection\(extra == 1 ? "" : "s")")
                        .font(.system(size: Theme.captionSize))
                        .foregroundColor(Theme.tertiaryLabel)
                }
                .padding(Theme.sp12)
            }
        }
    }

    /// Fallback list using raw `RuntimeItem` data (no heartbeat telemetry).
    /// Capped at 6 visible rows to keep the popover compact.
    @ViewBuilder
    private var runtimeList: some View {
        ForEach(Array(runtimeItems.prefix(6).enumerated()), id: \.element.id) { idx, item in
            VStack(spacing: 0) {
                RuntimeRow(item: item)
                if idx < min(runtimeItems.count, 6) - 1 {
                    Divider().padding(.leading, Theme.sp16)
                }
            }
        }

        if runtimeItems.count > 6 {
            VStack(spacing: 0) {
                Divider().padding(.leading, Theme.sp16)
                HStack(spacing: Theme.sp6) {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 10))
                        .foregroundColor(Theme.tertiaryLabel)
                    Text("+ \(runtimeItems.count - 6) more")
                        .font(.system(size: Theme.captionSize))
                        .foregroundColor(Theme.tertiaryLabel)
                }
                .padding(Theme.sp12)
            }
        }
    }

    private var countOnlyState: some View {
        HStack(spacing: Theme.sp12) {
            Image(systemName: "link")
                .font(.system(size: 16))
                .foregroundColor(Theme.blue)
            Text("\(totalConnections) client\(totalConnections == 1 ? "" : "s") connected")
                .font(.system(size: Theme.bodySize, weight: .medium))
                .foregroundColor(Theme.label)
            Spacer()
        }
        .padding(Theme.sp16)
    }

    // MARK: - Helpers

    private func headerBadge(_ text: String) -> some View {
        Text(text)
            .font(.system(size: Theme.miniSize, weight: .medium))
            .foregroundColor(Theme.tertiaryLabel)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Theme.label.opacity(0.06))
            .clipShape(Capsule())
    }

    /// Sort order: active instances bubble to top, then ascending uptime
    /// (most recently started first) among peers of equal activity status.
    private func instanceSort(_ a: InstanceInfo, _ b: InstanceInfo) -> Bool {
        if a.isCurrentlyActive != b.isCurrentlyActive { return a.isCurrentlyActive }
        let aUp = a.uptime ?? 0
        let bUp = b.uptime ?? 0
        return aUp < bUp
    }
}

// MARK: - RuntimeRow (simpler connection data)

/// Compact row for a raw MCP socket connection (no heartbeat telemetry).
/// Shows transport icon, truncated connection ID, activity dot, request count,
/// and relative "last seen" timestamp. Used as a fallback when `InstanceInfo`
/// data is not available.
struct RuntimeRow: View {
    let item: RuntimeItem
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: Theme.sp12) {
            // Transport icon
            transportIcon
                .frame(width: 24, height: 24)
                .background(Theme.label.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSm, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Theme.sp4) {
                    Text(item.transport ?? "socket")
                        .font(.system(size: Theme.bodySize, weight: .medium))
                        .foregroundColor(Theme.label)

                    Text("\u{00B7}")
                        .foregroundColor(Theme.tertiaryLabel)

                    Text(String(item.id.prefix(8)))
                        .font(.system(size: Theme.captionSize, design: .monospaced))
                        .foregroundColor(Theme.tertiaryLabel)

                    if item.isRecentlyActive {
                        Circle()
                            .fill(Theme.alive)
                            .frame(width: 6, height: 6)
                    }
                }

                if let reqs = item.requestCount, reqs > 0 {
                    Text("\(reqs) request\(reqs == 1 ? "" : "s")")
                        .font(.system(size: Theme.captionSize))
                        .foregroundColor(Theme.tertiaryLabel)
                }
            }

            Spacer()

            if let elapsed = item.secondsSinceLastSeen {
                Text(formatElapsed(elapsed))
                    .font(.system(size: Theme.captionSize))
                    .foregroundColor(Theme.tertiaryLabel)
            }
        }
        .padding(.horizontal, Theme.sp12)
        .padding(.vertical, Theme.sp8)
        .background(isHovered ? Theme.label.opacity(0.04) : Color.clear)
        .scaleEffect(isHovered ? 1.005 : 1.0)
        .onHover { hovering in
            withAnimation(.easeOut(duration: 0.15)) {
                isHovered = hovering
            }
        }
    }

    /// Maps transport type to a themed SF Symbol:
    /// socket/sse -> network (blue), stdio -> terminal (amber), unknown -> link (gray).
    @ViewBuilder
    private var transportIcon: some View {
        let t = item.transport?.lowercased() ?? ""
        if t == "socket" || t == "sse" {
            Image(systemName: "network")
                .font(.system(size: 11))
                .foregroundColor(Theme.blue)
        } else if t == "stdio" {
            Image(systemName: "terminal")
                .font(.system(size: 11))
                .foregroundColor(Theme.amber)
        } else {
            Image(systemName: "link")
                .font(.system(size: 11))
                .foregroundColor(Theme.secondaryLabel)
        }
    }

    /// Formats elapsed seconds into a human-friendly relative timestamp.
    /// Under 10s shows "now"; otherwise picks the largest fitting unit (s/m/h/d).
    private func formatElapsed(_ seconds: TimeInterval) -> String {
        if seconds < 10 { return "now" }
        if seconds < 60 { return "\(Int(seconds))s ago" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86400 { return "\(Int(seconds / 3600))h ago" }
        return "\(Int(seconds / 86400))d ago"
    }
}
