/// Connections section — section header with count badges + active/attention
/// indicators. Full ClientCard list for instances, RuntimeRow fallback
/// for raw connections, overflow indicator for long lists.
///
/// ## Expand/Collapse
///
/// The section has two collapsible groups:
/// - **Instances** (heartbeat clients): tap the chevron or header to expand/collapse
///   the full client card list. Collapsed state shows a compact summary row.
/// - **Sockets** (runtime connections): tap to expand all raw socket rows.
///   Collapsed by default when > 3 connections.

import SwiftUI

/// Displays all connected MCP clients, preferring rich `InstanceInfo` cards
/// (from heartbeat telemetry) over raw `RuntimeItem` rows (from socket tracking).
/// Both groups are independently expandable/collapsible with smooth spring animations.
struct ConnectionsSection: View {
    let active: ActiveInfo?
    let runtime: RuntimeInfo?
    let daemon: DaemonInfo
    @Binding var isExpanded: Bool

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

    @State private var socketsExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sp8) {
            // Section header with badges — tappable to expand/collapse
            Button(action: {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                    isExpanded.toggle()
                }
            }) {
                HStack(spacing: Theme.sp6) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(Theme.tertiaryLabel)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))

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
            }
            .buttonStyle(.plain)
            .padding(.horizontal, Theme.sp16)

            // Network topology visualization — always visible when connections exist
            if totalConnections > 0 || !instances.isEmpty {
                HStack {
                    Spacer()
                    NeuralMesh(
                        instances: instances,
                        runtimeItems: runtimeItems,
                        totalConnections: totalConnections
                    )
                    Spacer()
                }
                .padding(.vertical, Theme.sp4)
            }

            // Collapsed summary
            if !isExpanded && (totalConnections > 0 || !instances.isEmpty) {
                collapsedSummary
            }

            // Expanded content
            if isExpanded {
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
                .transition(.opacity.combined(with: .move(edge: .top)))

                // (Sockets now expand inline within instancesList overflow)
            }
        }
    }

    // MARK: - Collapsed Summary

    /// Compact one-line summary when collapsed — tap anywhere to expand.
    /// Uses `.onTapGesture` on the outer container (not just inside
    /// InsetGroupedSection) to ensure taps aren't swallowed by clipShape.
    private var collapsedSummary: some View {
        InsetGroupedSection {
            HStack(spacing: Theme.sp12) {
                Image(systemName: "app.connected.to.app.below.fill")
                    .font(.system(size: 14))
                    .foregroundColor(Theme.blue)

                VStack(alignment: .leading, spacing: 2) {
                    if !instances.isEmpty {
                        let activeOnes = instances.filter { $0.isCurrentlyActive }
                        Text("\(instances.count) client\(instances.count == 1 ? "" : "s")\(activeOnes.isEmpty ? "" : " · \(activeOnes.count) active")")
                            .font(.system(size: Theme.bodySize, weight: .medium))
                            .foregroundColor(Theme.label)
                    } else {
                        Text("\(totalConnections) connection\(totalConnections == 1 ? "" : "s")")
                            .font(.system(size: Theme.bodySize, weight: .medium))
                            .foregroundColor(Theme.label)
                    }

                    if !instances.isEmpty {
                        Text(instances.prefix(3).map { $0.displayName }.joined(separator: ", ")
                             + (instances.count > 3 ? " +\(instances.count - 3)" : ""))
                            .font(.system(size: Theme.captionSize))
                            .foregroundColor(Theme.tertiaryLabel)
                            .lineLimit(1)
                    }
                }

                Spacer()

                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(Theme.tertiaryLabel)
            }
            .padding(Theme.sp12)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                isExpanded = true
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

    /// Full expanded instance cards — sorted with active first.
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

        // Expandable overflow — shows remaining runtime socket connections.
        // Uses .onTapGesture + .contentShape instead of Button to avoid
        // hit-testing issues inside InsetGroupedSection's clipShape.
        let extra = totalConnections - instances.count
        if extra > 0 {
            Divider().padding(.leading, Theme.sp16)

            if socketsExpanded {
                // All runtime socket rows, expanded inline
                ForEach(Array(runtimeItems.enumerated()), id: \.element.id) { idx, item in
                    RuntimeRow(item: item)
                    if idx < runtimeItems.count - 1 {
                        Divider().padding(.leading, Theme.sp16)
                    }
                }

                // Collapse handle
                Divider().padding(.leading, Theme.sp16)
                HStack(spacing: Theme.sp6) {
                    Image(systemName: "chevron.up")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(Theme.blue)
                    Text("Collapse sockets")
                        .font(.system(size: Theme.captionSize, weight: .medium))
                        .foregroundColor(Theme.blue)
                }
                .frame(maxWidth: .infinity)
                .padding(Theme.sp8)
                .contentShape(Rectangle())
                .onTapGesture {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                        socketsExpanded = false
                    }
                }
            } else {
                // Tappable "show more" row
                HStack(spacing: Theme.sp6) {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(Theme.blue)
                    Text("+ \(extra) more connection\(extra == 1 ? "" : "s")")
                        .font(.system(size: Theme.captionSize, weight: .medium))
                        .foregroundColor(Theme.blue)
                    Spacer()
                }
                .padding(Theme.sp12)
                .contentShape(Rectangle())
                .onTapGesture {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                        socketsExpanded = true
                    }
                }
            }
        }
    }

    /// Fallback list using raw `RuntimeItem` data (no heartbeat telemetry).
    @ViewBuilder
    private var runtimeList: some View {
        ForEach(Array(runtimeItems.enumerated()), id: \.element.id) { idx, item in
            VStack(spacing: 0) {
                RuntimeRow(item: item)
                if idx < runtimeItems.count - 1 {
                    Divider().padding(.leading, Theme.sp16)
                }
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

    private func instanceSort(_ a: InstanceInfo, _ b: InstanceInfo) -> Bool {
        if a.isCurrentlyActive != b.isCurrentlyActive { return a.isCurrentlyActive }
        let aUp = a.uptime ?? 0
        let bUp = b.uptime ?? 0
        return aUp < bUp
    }
}

// MARK: - RuntimeRow (simpler connection data)

/// Compact row for a raw MCP socket connection (no heartbeat telemetry).
struct RuntimeRow: View {
    let item: RuntimeItem
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: Theme.sp12) {
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

                HStack(spacing: Theme.sp4) {
                    if let reqs = item.requestCount, reqs > 0 {
                        Text("\(reqs) req\(reqs == 1 ? "" : "s")")
                            .font(.system(size: Theme.captionSize))
                            .foregroundColor(Theme.tertiaryLabel)
                    }
                    if let notifs = item.notificationCount, notifs > 0 {
                        Text("\u{00B7}")
                            .foregroundColor(Theme.tertiaryLabel)
                        Text("\(notifs) notif\(notifs == 1 ? "" : "s")")
                            .font(.system(size: Theme.captionSize))
                            .foregroundColor(Theme.tertiaryLabel)
                    }
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

    private func formatElapsed(_ seconds: TimeInterval) -> String {
        if seconds < 10 { return "now" }
        if seconds < 60 { return "\(Int(seconds))s ago" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86400 { return "\(Int(seconds / 3600))h ago" }
        return "\(Int(seconds / 86400))d ago"
    }
}
