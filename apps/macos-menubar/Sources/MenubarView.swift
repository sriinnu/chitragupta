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
///   │   SystemSection     │
///   │   KnowledgeSection  │  ← scrollable body
///   │   NidraSection      │
///   │   ConnectionsSection│
///   ├─────────────────────┤
///   │   FooterSection     │  ← fixed
///   └─────────────────────┘
/// ```
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
}
