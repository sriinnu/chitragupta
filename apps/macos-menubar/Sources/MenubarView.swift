/// Main popover view for the Chitragupta menubar app.
///
/// Dark glass aesthetic with warm amber accents. Sections:
/// Header → Daemon vitals → Consolidation → Knowledge base → Actions.

import SwiftUI

struct MenubarView: View {

    @ObservedObject var client: DaemonClient
    @State private var pulseScale: CGFloat = 1.0
    @State private var consolidationGlow: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            headerBar
            if let status = client.status {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: Theme.spacing12) {
                        vitalsCard(status.daemon)
                        consolidationCard(status.nidra)
                        knowledgeCard(status.db)
                    }
                    .padding(.horizontal, Theme.spacing16)
                    .padding(.top, Theme.spacing12)
                    .padding(.bottom, Theme.spacing8)
                }
            } else {
                Spacer()
                disconnectedState
                Spacer()
            }
            FooterBar(client: client)
        }
        .frame(width: 340, height: 480)
        .background(Color(nsColor: .windowBackgroundColor).opacity(0.96))
    }

    // ─── Header ──────────────────────────────────────────────

    private var headerBar: some View {
        HStack(spacing: Theme.spacing8) {
            RoundedRectangle(cornerRadius: 4)
                .fill(
                    LinearGradient(
                        colors: [Theme.amber, Theme.gold],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                )
                .frame(width: 20, height: 20)
                .overlay(
                    Text("C")
                        .font(.system(size: 12, weight: .black, design: .rounded))
                        .foregroundColor(.black)
                )

            Text("Chitragupta")
                .font(.system(size: 14, weight: .semibold, design: .rounded))

            Spacer()

            // Consolidation badge
            if let state = client.status?.nidra?.state, isConsolidatingState(state) {
                HStack(spacing: 3) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 8))
                        .foregroundColor(Color.purple)
                        .opacity(consolidationGlow ? 1.0 : 0.4)
                    Text("LEARNING")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundColor(Color.purple.opacity(0.8))
                }
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(Color.purple.opacity(0.12))
                .clipShape(Capsule())
            }

            // Connection dot
            HStack(spacing: Theme.spacing4) {
                Circle()
                    .fill(client.isConnected ? Theme.alive : Theme.muted)
                    .frame(width: 7, height: 7)
                    .shadow(
                        color: client.isConnected ? Theme.alive.opacity(0.6) : .clear,
                        radius: 4
                    )
                    .scaleEffect(pulseScale)
                    .onAppear { startPulse() }

                Text(client.isConnected ? "Connected" : "Offline")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(client.isConnected ? Theme.alive : Theme.muted)
            }
        }
        .padding(.horizontal, Theme.spacing16)
        .padding(.vertical, Theme.spacing12)
    }

    // ─── Daemon Vitals ───────────────────────────────────────

    private func vitalsCard(_ d: DaemonInfo) -> some View {
        GlassCard {
            if d.alive {
                HStack(spacing: 0) {
                    vitalStat(
                        d.uptime.map { DaemonClient.formatUptime($0) } ?? "—",
                        "UPTIME"
                    )
                    vitalDivider
                    vitalStat(
                        d.memory.map { DaemonClient.formatBytes($0) } ?? "—",
                        "MEMORY"
                    )
                    vitalDivider
                    vitalStat("\(d.connections ?? 0)", "CLIENTS")
                    vitalDivider
                    vitalStat("\(d.methods ?? 0)", "METHODS")
                }
            } else {
                HStack {
                    Image(systemName: "moon.zzz")
                        .foregroundColor(Theme.coral)
                        .font(.system(size: 14))
                    Text("Daemon is not running")
                        .font(.system(size: 12))
                        .foregroundColor(Theme.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Theme.spacing8)
            }
        }
    }

    private func vitalStat(_ value: String, _ label: String) -> some View {
        VStack(spacing: Theme.spacing2) {
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundColor(.white.opacity(0.9))
            Text(label)
                .font(.system(size: 7, weight: .bold))
                .foregroundColor(Theme.sectionLabel)
                .tracking(0.6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.spacing8)
    }

    private var vitalDivider: some View {
        Rectangle()
            .fill(Theme.cardBorder)
            .frame(width: 1, height: 28)
    }

    // ─── Consolidation (Nidra) ──────────────────────────────

    private func consolidationCard(_ nidra: NidraInfo?) -> some View {
        let isActive = nidra?.state.map { isConsolidatingState($0) } ?? false

        return GlassCard {
            VStack(alignment: .leading, spacing: Theme.spacing8) {
                HStack {
                    sectionLabel("CONSOLIDATION")
                    Spacer()
                    if let n = nidra, let state = n.state {
                        stateChip(humanNidraState(state), color: nidraColor(state), active: isActive)
                    } else {
                        Text("unavailable")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.muted)
                    }
                }

                if isActive {
                    HStack(spacing: Theme.spacing6) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 10))
                            .foregroundColor(Color.purple)
                            .opacity(consolidationGlow ? 1.0 : 0.4)
                        Text("Learning from recent sessions…")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(Color.purple.opacity(0.8))
                        Spacer()
                        ProgressView()
                            .controlSize(.mini)
                            .scaleEffect(0.7)
                    }
                    .onAppear { startConsolidationGlow() }
                }

                if let n = nidra, let progress = n.consolidationProgress {
                    VStack(alignment: .leading, spacing: Theme.spacing4) {
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(Color.white.opacity(0.06))
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(
                                        LinearGradient(
                                            colors: isActive
                                                ? [Color.purple, Color.purple.opacity(0.6)]
                                                : [Theme.amber, Theme.gold],
                                            startPoint: .leading, endPoint: .trailing
                                        )
                                    )
                                    .frame(width: geo.size.width * CGFloat(min(progress, 100) / 100))
                            }
                        }
                        .frame(height: 5)

                        HStack {
                            Text(String(format: "%.0f%%", progress))
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundColor(isActive ? Color.purple : Theme.amber)
                            Spacer()
                            if let last = n.lastConsolidationEnd {
                                Text("Last run \(DaemonClient.formatRelativeTime(last))")
                                    .font(.system(size: 10))
                                    .foregroundColor(Theme.muted)
                            }
                        }
                    }
                }
            }
        }
    }

    // ─── Knowledge Base (Memory Pipeline) ────────────────────

    private func knowledgeCard(_ db: DbCounts?) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Theme.spacing8) {
                HStack {
                    sectionLabel("KNOWLEDGE")
                    Spacer()
                    if let db, (db.turns == 0 || db.rules == 0) {
                        HStack(spacing: 3) {
                            Circle().fill(Theme.coral).frame(width: 5, height: 5)
                            Text("EMPTY")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundColor(Theme.coral)
                        }
                    }
                }

                if let db {
                    VStack(spacing: Theme.spacing4) {
                        knowledgeRow("Conversations", db.turns, peak: peakCount(db))
                        knowledgeRow("Sessions", db.sessions, peak: peakCount(db))
                        knowledgeRow("Learned rules", db.rules, peak: peakCount(db))
                        knowledgeRow("Procedures", db.vidhis, peak: peakCount(db))
                        knowledgeRow("Impressions", db.samskaras, peak: peakCount(db))
                        knowledgeRow("Tendencies", db.vasanas, peak: peakCount(db))
                        knowledgeRow("Shared knowledge", db.akashaTraces, peak: peakCount(db))
                    }
                } else {
                    Text("No data yet")
                        .font(.system(size: 11))
                        .foregroundColor(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, Theme.spacing8)
                }
            }
        }
    }

    private func knowledgeRow(_ label: String, _ count: Int, peak: Int) -> some View {
        let fraction = peak > 0 ? CGFloat(count) / CGFloat(peak) : 0
        let isZero = count == 0

        return HStack(spacing: Theme.spacing8) {
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(Theme.secondary)
                .frame(width: 100, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.white.opacity(0.04))
                    RoundedRectangle(cornerRadius: 2)
                        .fill(isZero ? Theme.coral : Theme.amber.opacity(0.6))
                        .frame(width: Swift.max(2, geo.size.width * fraction))
                }
            }
            .frame(height: 4)

            Text(formatCount(count))
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundColor(isZero ? Theme.coral : .white.opacity(0.8))
                .frame(width: 36, alignment: .trailing)
        }
        .frame(height: 16)
    }

    private func peakCount(_ db: DbCounts) -> Int {
        [db.turns, db.sessions, db.rules, db.vidhis,
         db.samskaras, db.vasanas, db.akashaTraces].max() ?? 1
    }

    // ─── Disconnected ────────────────────────────────────────

    private var disconnectedState: some View {
        VStack(spacing: Theme.spacing16) {
            ZStack {
                Circle()
                    .fill(Theme.amber.opacity(0.08))
                    .frame(width: 72, height: 72)
                Image(systemName: "flame")
                    .font(.system(size: 32, weight: .light))
                    .foregroundColor(Theme.muted)
            }

            VStack(spacing: Theme.spacing4) {
                Text("Daemon is offline")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.white.opacity(0.8))
                Text("Start it from your terminal")
                    .font(.system(size: 11))
                    .foregroundColor(Theme.muted)
            }

            // CLI command hint
            Text("chitragupta daemon start")
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(Theme.amber.opacity(0.8))
                .padding(.horizontal, Theme.spacing12)
                .padding(.vertical, Theme.spacing6)
                .background(Color.white.opacity(0.04))
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSm))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusSm)
                        .stroke(Theme.cardBorder, lineWidth: 0.5)
                )

            if let err = client.lastError {
                Text(err)
                    .font(.system(size: 9))
                    .foregroundColor(Theme.coral.opacity(0.7))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Theme.spacing20)
            }
        }
    }

    // ─── Shared ──────────────────────────────────────────────

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .bold))
            .foregroundColor(Theme.sectionLabel)
            .tracking(1.2)
    }

    private func stateChip(_ label: String, color: Color, active: Bool) -> some View {
        HStack(spacing: 4) {
            if active {
                Circle()
                    .fill(color)
                    .frame(width: 5, height: 5)
                    .opacity(consolidationGlow ? 1.0 : 0.3)
            }
            Text(label.uppercased())
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(color)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(color.opacity(active ? 0.2 : 0.12))
        .clipShape(Capsule())
    }

    /// Map Nidra state to human-readable English.
    private func humanNidraState(_ state: String) -> String {
        switch state.lowercased() {
        case "awake", "listening": return "Idle"
        case "dreaming": return "Learning"
        case "consolidating": return "Learning"
        case "sleeping", "deep_sleep": return "Sleeping"
        default: return state
        }
    }

    private func nidraColor(_ state: String) -> Color {
        switch state.lowercased() {
        case "awake", "listening": return Theme.alive
        case "dreaming", "consolidating": return Color.purple
        case "sleeping", "deep_sleep": return Color(red: 0.45, green: 0.45, blue: 0.85)
        default: return Theme.muted
        }
    }

    /// Format large counts with K suffix.
    private func formatCount(_ n: Int) -> String {
        if n >= 10_000 { return String(format: "%.1fK", Double(n) / 1000) }
        if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1000) }
        return "\(n)"
    }

    private func isConsolidatingState(_ state: String) -> Bool {
        let s = state.lowercased()
        return s == "consolidating" || s == "dreaming"
    }

    private func startConsolidationGlow() {
        withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
            consolidationGlow = true
        }
    }

    private func stopConsolidationGlow() {
        withAnimation(.easeInOut(duration: 0.3)) { consolidationGlow = false }
    }

    private func startPulse() {
        guard client.isConnected else { return }
        withAnimation(.easeInOut(duration: 2.0).repeatForever(autoreverses: true)) {
            pulseScale = 1.2
        }
    }

    private func stopPulse() {
        withAnimation(.easeInOut(duration: 0.3)) { pulseScale = 1.0 }
    }
}
