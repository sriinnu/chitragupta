/// Connections section — all heartbeat instances visible, stale sockets hidden.
///
/// ## Stale Filtering
///
/// **Instances** (heartbeat clients) are always shown — if the daemon received
/// a heartbeat, the agent is alive regardless of idle/active state.
/// **Sockets** (raw connections) are filtered: only active + idle sockets are
/// shown by default. Stale sockets (no traffic >5min) are hidden behind a
/// tappable "N inactive hidden" indicator.
///
/// ## Expand/Collapse
///
/// - **Instances**: chevron header to expand/collapse full card list.
/// - **Sockets**: inline expand for overflow.
/// - **Stale reveal**: "N stale hidden" row toggles stale socket visibility.

import SwiftUI

/// Displays connected MCP clients, filtering stale agents by default.
/// Prefers rich `InstanceInfo` cards (heartbeat telemetry) over raw
/// `RuntimeItem` rows (socket tracking). Both groups are independently
/// expandable/collapsible with smooth spring animations.
struct ConnectionsSection: View {
    let active: ActiveInfo?
    let runtime: RuntimeInfo?
    let daemon: DaemonInfo
    @Binding var isExpanded: Bool
    @State private var isHeaderHovered = false

    // MARK: - Derived Data

    /// All heartbeat instances — always shown (heartbeat = alive).
    private var instances: [InstanceInfo] {
        active?.instances ?? []
    }

    /// Active instances (state: active/busy/thinking) — used for badges/counts.
    private var activeInstanceCount: Int {
        instances.filter { $0.isCurrentlyActive }.count
    }

    /// All runtime socket connections.
    private var allRuntimeItems: [RuntimeItem] {
        runtime?.items ?? []
    }

    /// Live sockets (active + idle, seen within 5min).
    private var liveRuntimeItems: [RuntimeItem] {
        allRuntimeItems.filter { !$0.isStale }
    }

    /// Stale sockets only (no traffic for >5min).
    private var staleRuntimeItems: [RuntimeItem] {
        allRuntimeItems.filter { $0.isStale }
    }

    /// Count of stale sockets (instances are never stale — they have heartbeats).
    private var staleCount: Int {
        staleRuntimeItems.count
    }

    /// Best-effort total: daemon-reported or runtime socket count.
    private var totalConnections: Int {
        daemon.connections ?? runtime?.connected ?? 0
    }

    @State private var socketsExpanded = false
    @State private var showStale = false

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.sp8) {
            sectionHeader

            // Neural mesh — always visible when connections exist
            if totalConnections > 0 || !instances.isEmpty {
                HStack {
                    Spacer()
                    NeuralMesh(
                        instances: instances,
                        runtimeItems: liveRuntimeItems,
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
                    if instances.isEmpty && liveRuntimeItems.isEmpty && totalConnections == 0 {
                        if staleCount > 0 {
                            allStaleState
                        } else {
                            emptyState
                        }
                    } else if !instances.isEmpty {
                        instancesList
                    } else if !liveRuntimeItems.isEmpty {
                        runtimeList
                    } else if totalConnections > 0 {
                        countOnlyState
                    } else {
                        emptyState
                    }

                    // Stale agents indicator
                    if staleCount > 0 {
                        staleIndicator
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    // MARK: - Section Header

    /// Header row with chevron, badges, and live counts.
    private var sectionHeader: some View {
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
        .onHover { isHeaderHovered = $0 }
        .background(isHeaderHovered ? Theme.label.opacity(0.04) : Color.clear)
        .cornerRadius(Theme.radiusSm)
        .padding(.horizontal, Theme.sp16)
    }

    // MARK: - Collapsed Summary

    /// Compact one-line summary when collapsed — tap anywhere to expand.
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
                    } else if totalConnections > 0 {
                        Text("\(totalConnections) connection\(totalConnections == 1 ? "" : "s")")
                            .font(.system(size: Theme.bodySize, weight: .medium))
                            .foregroundColor(Theme.label)
                    } else {
                        Text("No connections")
                            .font(.system(size: Theme.bodySize, weight: .medium))
                            .foregroundColor(Theme.tertiaryLabel)
                    }

                    if !instances.isEmpty {
                        Text(instances.prefix(3).map { $0.displayName }.joined(separator: ", ")
                             + (instances.count > 3 ? " +\(instances.count - 3)" : ""))
                            .font(.system(size: Theme.captionSize))
                            .foregroundColor(Theme.tertiaryLabel)
                            .lineLimit(1)
                    }

                    if staleCount > 0 {
                        Text("\(staleCount) inactive (>5min) hidden")
                            .font(.system(size: Theme.miniSize))
                            .foregroundColor(Theme.quaternaryLabel)
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

    /// All connections are stale — show a message instead of empty state.
    private var allStaleState: some View {
        HStack(spacing: Theme.sp12) {
            Image(systemName: "moon.zzz")
                .font(.system(size: 16))
                .foregroundColor(Theme.tertiaryLabel)
            VStack(alignment: .leading, spacing: 2) {
                Text("All connections inactive")
                    .font(.system(size: Theme.bodySize, weight: .medium))
                    .foregroundColor(Theme.tertiaryLabel)
                Text("\(staleCount) stale — no traffic for >5min")
                    .font(.system(size: Theme.captionSize))
                    .foregroundColor(Theme.quaternaryLabel)
            }
            Spacer()
        }
        .padding(Theme.sp16)
    }

    /// All heartbeat instance cards — sorted with active first, then idle.
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

        // Expandable live sockets overflow
        if !liveRuntimeItems.isEmpty {
            Divider().padding(.leading, Theme.sp16)

            if socketsExpanded {
                ForEach(Array(liveRuntimeItems.enumerated()), id: \.element.id) { idx, item in
                    RuntimeRow(item: item)
                    if idx < liveRuntimeItems.count - 1 {
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
                HStack(spacing: Theme.sp6) {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(Theme.blue)
                    Text("+ \(liveRuntimeItems.count) socket\(liveRuntimeItems.count == 1 ? "" : "s")")
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

    /// Fallback list using raw `RuntimeItem` data — only live (non-stale) items.
    @ViewBuilder
    private var runtimeList: some View {
        ForEach(Array(liveRuntimeItems.enumerated()), id: \.element.id) { idx, item in
            VStack(spacing: 0) {
                RuntimeRow(item: item)
                if idx < liveRuntimeItems.count - 1 {
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

    // MARK: - Stale Indicator

    /// Subtle row showing how many inactive connections are hidden.
    /// Tappable to reveal stale agents with a smooth expand animation.
    @ViewBuilder
    private var staleIndicator: some View {
        Divider().padding(.leading, Theme.sp16)

        VStack(spacing: 0) {
            // Toggle row
            HStack(spacing: Theme.sp6) {
                Image(systemName: showStale ? "eye.slash" : "eye")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(Theme.quaternaryLabel)
                Text(showStale ? "Hide \(staleCount) inactive" : "\(staleCount) inactive (>5min) hidden")
                    .font(.system(size: Theme.captionSize, weight: .medium))
                    .foregroundColor(Theme.quaternaryLabel)
                Spacer()
                Image(systemName: showStale ? "chevron.up" : "chevron.down")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundColor(Theme.quaternaryLabel)
            }
            .padding(.horizontal, Theme.sp12)
            .padding(.vertical, Theme.sp8)
            .contentShape(Rectangle())
            .onTapGesture {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                    showStale.toggle()
                }
            }

            // Stale sockets (expanded)
            if showStale {
                ForEach(Array(staleRuntimeItems.enumerated()), id: \.element.id) { idx, item in
                    Divider().padding(.leading, Theme.sp16)
                    RuntimeRow(item: item)
                        .opacity(0.5)
                }
            }
        }
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

// MARK: - RuntimeRow (enriched socket connection data)

/// Multi-line row for a raw MCP socket connection.
///
/// Layout:
/// ```
///   [icon]  socket · a1b2c3d4               [active]
///           chitragupta · anthropic
///           2h 15m · 61 reqs · 3 notifs
/// ```
///
/// Line 1: transport icon + transport type + truncated ID + activity badge
/// Line 2: workspace + provider (when available from daemon)
/// Line 3: duration · requests · notifications
///
/// Activity levels are color-coded:
/// - Active (< 30s): green
/// - Idle (< 5min): amber
/// - Stale (> 5min): gray (dimmed at 50% opacity by ConnectionsSection)
struct RuntimeRow: View {
    let item: RuntimeItem
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: Theme.sp12) {
            // Transport icon with activity ring
            ZStack {
                Circle()
                    .stroke(activityColor.opacity(0.25), lineWidth: 1.5)
                    .frame(width: 28, height: 28)
                transportIcon
                    .frame(width: 24, height: 24)
                    .background(Theme.label.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSm, style: .continuous))
            }
            .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 3) {
                // Line 1: transport + ID + activity badge
                HStack(spacing: Theme.sp4) {
                    Text(item.transport ?? "socket")
                        .font(.system(size: Theme.bodySize, weight: .medium))
                        .foregroundColor(Theme.label)

                    Text(String(item.id.prefix(8)))
                        .font(.system(size: Theme.captionSize, design: .monospaced))
                        .foregroundColor(Theme.tertiaryLabel)

                    Spacer()

                    // Activity badge
                    HStack(spacing: 3) {
                        Circle()
                            .fill(activityColor)
                            .frame(width: 5, height: 5)
                        Text(item.activityLevel)
                            .font(.system(size: Theme.miniSize, weight: .medium))
                            .foregroundColor(activityColor)
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(activityColor.opacity(0.1))
                    .clipShape(Capsule())
                }

                // Line 2: workspace + provider (when daemon sends them)
                if item.workspaceName != nil || item.provider != nil {
                    HStack(spacing: Theme.sp4) {
                        if let ws = item.workspaceName {
                            HStack(spacing: 2) {
                                Image(systemName: "folder")
                                    .font(.system(size: 8))
                                Text(ws)
                                    .font(.system(size: Theme.captionSize, weight: .medium))
                            }
                            .foregroundColor(Theme.secondaryLabel)
                        }

                        if item.workspaceName != nil && item.provider != nil {
                            Text("\u{00B7}").foregroundColor(Theme.tertiaryLabel)
                        }

                        if let prov = item.provider {
                            HStack(spacing: 2) {
                                Image(systemName: providerIcon(prov))
                                    .font(.system(size: 8))
                                Text(prov)
                                    .font(.system(size: Theme.captionSize, weight: .medium))
                            }
                            .foregroundColor(Theme.secondaryLabel)
                        }
                    }
                }

                // Line 3: duration · requests · notifications
                HStack(spacing: Theme.sp4) {
                    if let dur = item.durationString {
                        HStack(spacing: 2) {
                            Image(systemName: "clock")
                                .font(.system(size: 8))
                            Text(dur)
                                .font(.system(size: Theme.captionSize))
                        }
                        .foregroundColor(Theme.tertiaryLabel)
                    }

                    let reqs = item.requestCount ?? 0
                    if reqs > 0 {
                        Text("\u{00B7}").foregroundColor(Theme.tertiaryLabel)
                        HStack(spacing: 2) {
                            Image(systemName: "arrow.up.arrow.down")
                                .font(.system(size: 8))
                            Text("\(reqs) req\(reqs == 1 ? "" : "s")")
                                .font(.system(size: Theme.captionSize))
                        }
                        .foregroundColor(Theme.tertiaryLabel)
                    }

                    let notifs = item.notificationCount ?? 0
                    if notifs > 0 {
                        Text("\u{00B7}").foregroundColor(Theme.tertiaryLabel)
                        HStack(spacing: 2) {
                            Image(systemName: "bell")
                                .font(.system(size: 8))
                            Text("\(notifs)")
                                .font(.system(size: Theme.captionSize))
                        }
                        .foregroundColor(Theme.tertiaryLabel)
                    }

                    // Silent sockets
                    if reqs == 0 && notifs == 0 && item.workspaceName == nil {
                        Text("no activity yet")
                            .font(.system(size: Theme.captionSize))
                            .foregroundColor(Theme.quaternaryLabel)
                            .italic()
                    }
                }
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

    // MARK: - Helpers

    /// Color based on connection activity level.
    private var activityColor: Color {
        switch item.activityLevel {
        case "active": return Theme.alive
        case "idle": return Theme.amber
        default: return Theme.tertiaryLabel
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

    /// SF Symbol for known provider identities.
    private func providerIcon(_ provider: String) -> String {
        let p = provider.lowercased()
        if p.contains("anthropic") || p.contains("claude") { return "brain" }
        if p.contains("openai") || p.contains("gpt") { return "sparkle" }
        if p.contains("ollama") { return "desktopcomputer" }
        return "cpu"
    }

    private func formatElapsed(_ seconds: TimeInterval) -> String {
        if seconds < 10 { return "just now" }
        if seconds < 60 { return "\(Int(seconds))s ago" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86400 { return "\(Int(seconds / 3600))h ago" }
        return "\(Int(seconds / 86400))d ago"
    }
}
