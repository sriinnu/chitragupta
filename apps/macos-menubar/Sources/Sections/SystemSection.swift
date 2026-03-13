/// System vitals — PID, uptime, memory, connections.
/// Rendered as InsetGroupedSection with SectionRow items.

import SwiftUI

/// Daemon process vitals displayed as a simple key-value list.
/// All values are derived from `DaemonInfo` (populated from `GET /status`).
/// Formatting helpers (`formatUptime`, `formatBytes`) live on `DaemonClient`
/// as static methods since they are shared across multiple views.
struct SystemSection: View {
    let daemon: DaemonInfo

    var body: some View {
        InsetGroupedSection("System") {
            SectionRow(
                "PID",
                value: daemon.pid.map { "\($0)" } ?? "--",
                icon: "number"
            )

            SectionRow(
                "Uptime",
                value: daemon.uptime.map { DaemonClient.formatUptime($0) } ?? "--",
                icon: "clock"
            )

            // Uses MemoryValue.bytes which prefers RSS, then heap used
            SectionRow(
                "Memory",
                value: daemon.memory.map { DaemonClient.formatBytes($0.bytes) } ?? "--",
                icon: "memorychip"
            )

            SectionRow(
                "Connections",
                value: "\(daemon.connections ?? 0)",
                icon: "link",
                showSeparator: false
            )
        }
    }
}
