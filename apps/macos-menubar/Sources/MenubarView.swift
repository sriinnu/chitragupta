/// Main popover view for the Chitragupta menubar app.
///
/// Displays daemon health, nidra state, memory pipeline counts,
/// triguna gauge, circuit breaker, and action buttons.
/// Layout: 380x560 popover with sectioned cards.

import SwiftUI

struct MenubarView: View {

    @ObservedObject var client: DaemonClient

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                headerSection
                Divider()
                if let status = client.status {
                    daemonSection(status.daemon)
                    Divider()
                    nidraSection(status.nidra)
                    Divider()
                    pipelineSection(status.db)
                    Divider()
                    if let triguna = status.triguna {
                        trigunaSection(triguna)
                        Divider()
                    }
                    circuitSection(status.circuit)
                    Divider()
                } else {
                    disconnectedView
                    Divider()
                }
                actionsSection
            }
        }
        .frame(width: 380, height: 560)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: - Header

    private var headerSection: some View {
        HStack {
            Text("Chitragupta")
                .font(.system(size: 16, weight: .semibold))
            Spacer()
            HStack(spacing: 4) {
                Circle()
                    .fill(client.isConnected ? Color.green : Color.gray)
                    .frame(width: 8, height: 8)
                Text(client.isConnected ? "Connected" : "Disconnected")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Daemon info

    @ViewBuilder
    private func daemonSection(_ daemon: DaemonInfo) -> some View {
        sectionCard(title: "DAEMON") {
            if daemon.alive, let pid = daemon.pid {
                HStack(spacing: 12) {
                    statPill("PID", "\(pid)")
                    if let uptime = daemon.uptime {
                        statPill("Up", DaemonClient.formatUptime(uptime))
                    }
                    if let mem = daemon.memory {
                        statPill("Mem", DaemonClient.formatBytes(mem))
                    }
                }
                HStack(spacing: 12) {
                    if let conn = daemon.connections {
                        statPill("Connections", "\(conn)")
                    }
                    if let methods = daemon.methods {
                        statPill("Methods", "\(methods)")
                    }
                    Spacer()
                }
                .padding(.top, 2)
            } else {
                Text("Daemon is not running")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Nidra

    @ViewBuilder
    private func nidraSection(_ nidra: NidraInfo?) -> some View {
        sectionCard(title: "NIDRA") {
            if let n = nidra {
                HStack {
                    Text(n.state.uppercased())
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(nidraColor(n.state).opacity(0.15))
                        .foregroundColor(nidraColor(n.state))
                        .cornerRadius(4)
                    Spacer()
                }

                if let progress = n.consolidationProgress {
                    ProgressView(value: progress, total: 100)
                        .tint(Color.blue)
                    Text(String(format: "%.0f%%", progress))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.secondary)
                }

                Text("Last: \(DaemonClient.formatRelativeTime(n.lastConsolidationEnd))")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            } else {
                Text("Nidra unavailable")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Memory pipeline

    @ViewBuilder
    private func pipelineSection(_ db: DbCounts?) -> some View {
        sectionCard(title: "MEMORY PIPELINE") {
            if let db {
                LazyVGrid(columns: [
                    GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible()),
                ], spacing: 6) {
                    countCell("Turns", db.turns)
                    countCell("Rules", db.rules)
                    countCell("Sessions", db.sessions)
                    countCell("Vidhis", db.vidhis)
                    countCell("Samskaras", db.samskaras)
                    countCell("Vasanas", db.vasanas)
                    countCell("Akasha", db.akashaTraces)
                }

                if db.turns == 0 || db.rules == 0 {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.yellow)
                            .font(.system(size: 11))
                        Text("Pipeline needs attention")
                            .font(.system(size: 11))
                            .foregroundColor(.yellow)
                    }
                    .padding(.top, 4)
                }
            } else {
                Text("No data available")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Triguna

    @ViewBuilder
    private func trigunaSection(_ triguna: TrigunaInfo) -> some View {
        sectionCard(title: "TRIGUNA") {
            TrigunaGauge(triguna: triguna)
        }
    }

    // MARK: - Circuit breaker

    @ViewBuilder
    private func circuitSection(_ circuit: CircuitInfo?) -> some View {
        sectionCard(title: "") {
            HStack {
                Text("Circuit:")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                if let c = circuit {
                    Text(c.state.uppercased())
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(c.state == "CLOSED" ? .green : .red)
                    Circle()
                        .fill(c.state == "CLOSED" ? Color.green : Color.red)
                        .frame(width: 6, height: 6)
                    Text("\(c.consecutiveFailures) failures")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                } else {
                    Text("HEALTHY")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(.green)
                    Circle()
                        .fill(Color.green)
                        .frame(width: 6, height: 6)
                }
                Spacer()
            }
        }
    }

    // MARK: - Disconnected

    private var disconnectedView: some View {
        VStack(spacing: 8) {
            Image(systemName: "antenna.radiowaves.left.and.right.slash")
                .font(.system(size: 28))
                .foregroundColor(.secondary)
            Text("Daemon not reachable")
                .font(.system(size: 13))
                .foregroundColor(.secondary)
            if let err = client.lastError {
                Text(err)
                    .font(.system(size: 10))
                    .foregroundColor(.red)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 30)
    }

    // MARK: - Actions

    private var actionsSection: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                actionButton("Start", systemImage: "play.fill") {
                    Task { await client.startDaemon() }
                }
                actionButton("Stop", systemImage: "stop.fill") {
                    Task { await client.stopDaemon() }
                }
                actionButton("Consolidate", systemImage: "arrow.triangle.2.circlepath") {
                    Task { await client.consolidate() }
                }
            }
            HStack(spacing: 8) {
                actionButton("Open Hub", systemImage: "safari") {
                    client.openHub()
                }
                Spacer()
                Button(action: { NSApplication.shared.terminate(nil) }) {
                    Text("Quit")
                        .font(.system(size: 11))
                        .foregroundColor(.red)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Reusable components

    private func sectionCard(title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if !title.isEmpty {
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(.secondary)
                    .tracking(0.5)
            }
            content()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func statPill(_ label: String, _ value: String) -> some View {
        VStack(spacing: 1) {
            Text(value)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(.secondary)
        }
    }

    private func countCell(_ label: String, _ count: Int) -> some View {
        VStack(spacing: 1) {
            Text("\(count)")
                .font(.system(size: 13, weight: .medium, design: .monospaced))
                .foregroundColor(count == 0 ? .red : .primary)
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.gray.opacity(0.08))
        )
    }

    private func actionButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: systemImage)
                    .font(.system(size: 10))
                Text(title)
                    .font(.system(size: 11))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(Color.gray.opacity(0.1))
            .cornerRadius(6)
        }
        .buttonStyle(.plain)
    }

    private func nidraColor(_ state: String) -> Color {
        switch state.lowercased() {
        case "awake": return .green
        case "dreaming", "consolidating": return .blue
        case "sleeping": return .purple
        default: return .gray
        }
    }
}
