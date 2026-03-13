/// Main popover view — v3 Apple-native redesign.
///
/// Thin orchestrator composing section views.
/// Fixed header/footer with scrollable body.
/// .regularMaterial background, smooth state transitions.

import SwiftUI

/// Root view inside the NSPopover. Composes the section views and manages
/// the connected/disconnected transition.
///
/// Layout when connected:
/// ```
///   ┌─────────────────────┐
///   │   HeaderSection     │  ← fixed
///   ├─────────────────────┤
///   │   Prāṇa ECG strip  │  ← live heartbeat
///   │   SystemSection     │
///   │   KnowledgeSection  │  ← scrollable body
///   │   NidraSection      │
///   │   ConnectionsSection│
///   ├─────────────────────┤
///   │   FooterSection     │  ← fixed
///   └─────────────────────┘
/// ```
///
/// The Prāṇa ECG provides a live heartbeat that reflects the daemon's
/// current state — idle, active, consolidating, deep sleep, or error.
///
/// When disconnected, the scrollable body is replaced by `DisconnectedView`
/// which shows the error state and a "Start Daemon" button.
struct MenubarView: View {

    @ObservedObject var client: DaemonClient
    @State private var showKnowledgeDetail = false

    var body: some View {
        VStack(spacing: 0) {
            if let status = client.status {
                connectedContent(status)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            } else {
                DisconnectedView(client: client)
                    .transition(.opacity)
            }

            Divider()

            FooterSection(client: client)
        }
        .frame(width: 380)
        .background(.regularMaterial)
        .animation(.spring(response: 0.5, dampingFraction: 0.85), value: client.status != nil)
    }

    // MARK: - Connected state

    /// Builds the full connected layout: header, divider, then a scrollable
    /// stack of content sections with consistent padding.
    @ViewBuilder
    private func connectedContent(_ status: AggregatedStatus) -> some View {
        HeaderSection(daemon: status.daemon, isConnected: client.isConnected)

        Divider()

        // Prāṇa ECG strip — live heartbeat of the daemon
        PranaECG(
            state: resolveDaemonState(status),
            connections: status.daemon.connections ?? 0,
            activeCount: status.active?.activeNowCount ?? 0
        )
        .padding(.horizontal, Theme.sp16)
        .padding(.top, Theme.sp8)

        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: Theme.sp16) {
                SystemSection(daemon: status.daemon)

                KnowledgeSection(
                    db: status.db,
                    isExpanded: $showKnowledgeDetail
                )

                NidraSection(nidra: status.nidra)

                ConnectionsSection(
                    active: status.active,
                    runtime: status.runtime,
                    daemon: status.daemon
                )
            }
            .padding(.horizontal, Theme.sp16)
            .padding(.vertical, Theme.sp12)
        }
    }

    // MARK: - State Resolution

    /// Derive `DaemonState` from the aggregated status for ECG and animations.
    /// Mirrors the priority logic in `AppDelegate.resolveDaemonState()`.
    private func resolveDaemonState(_ status: AggregatedStatus) -> DaemonState {
        if let nidraState = status.nidra?.state?.lowercased() {
            switch nidraState {
            case "consolidating", "dreaming":
                return .consolidating
            case "deep_sleep", "sleeping", "sushupta":
                return .deepSleep
            case "error":
                return .error
            default:
                break
            }
        }

        if let instances = status.active?.instances {
            let hasActive = instances.contains { inst in
                let s = inst.state?.lowercased() ?? ""
                return s == "active" || s == "busy" || s == "thinking"
            }
            if hasActive { return .active }
        }

        return .idle
    }
}
