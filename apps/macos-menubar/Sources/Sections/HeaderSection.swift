/// Header — brand icon + "Chitragupta" + version + connection dot.
/// Fixed at top of the popover. Connection dot breathes when connected.

import SwiftUI

/// Top-bar of the popover. Shows the brand mark ("C" in an amber gradient tile),
/// the app title, daemon version, and a connection status indicator with a
/// breathing pulse ring animation when connected.
struct HeaderSection: View {
    let daemon: DaemonInfo
    let isConnected: Bool
    /// Drives the expanding-and-fading pulse ring around the connection dot.
    /// Toggles once on appear, then loops via `repeatForever(autoreverses: false)`.
    @State private var dotBreathing = false

    var body: some View {
        HStack(spacing: Theme.sp8) {
            // Brand icon
            ZStack {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [Theme.amber, Theme.gold],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 24, height: 24)
                    .shadow(color: Theme.amber.opacity(0.3), radius: 4, y: 1)

                Text("C")
                    .font(.system(size: 14, weight: .black, design: .rounded))
                    .foregroundColor(.black)
            }

            Text("Chitragupta")
                .font(.system(size: Theme.titleSize, weight: .semibold, design: .rounded))
                .foregroundColor(Theme.label)

            if let version = daemon.version {
                Text("v\(version)")
                    .font(.system(size: Theme.miniSize))
                    .foregroundColor(Theme.tertiaryLabel)
            }

            Spacer()

            // Connection indicator — the outer ring scales up and fades out
            // continuously to create a radar-ping effect, while the inner dot
            // stays solid.
            HStack(spacing: Theme.sp4) {
                ZStack {
                    if isConnected {
                        Circle()
                            .fill(Theme.alive.opacity(0.25))
                            .frame(width: 14, height: 14)
                            .scaleEffect(dotBreathing ? 1.0 : 0.5)
                            .opacity(dotBreathing ? 0.0 : 0.6)
                    }
                    Circle()
                        .fill(isConnected ? Theme.alive : Theme.tertiaryLabel)
                        .frame(width: 7, height: 7)
                }
                .frame(width: 14, height: 14)

                Text(isConnected ? "Connected" : "Offline")
                    .font(.system(size: Theme.captionSize, weight: .medium))
                    .foregroundColor(isConnected ? Theme.alive : Theme.tertiaryLabel)
            }
        }
        .padding(.horizontal, Theme.sp16)
        .padding(.vertical, Theme.sp12)
        .onAppear {
            guard isConnected else { return }
            withAnimation(.easeInOut(duration: 2.0).repeatForever(autoreverses: false)) {
                dotBreathing = true
            }
        }
        // Reset and restart the pulse animation when connection state changes.
        // On disconnect, stop the loop with a quick ease-out so it doesn't hang mid-scale.
        .onChange(of: isConnected) { connected in
            if connected {
                dotBreathing = false
                withAnimation(.easeInOut(duration: 2.0).repeatForever(autoreverses: false)) {
                    dotBreathing = true
                }
            } else {
                withAnimation(.easeOut(duration: 0.3)) {
                    dotBreathing = false
                }
            }
        }
    }
}
