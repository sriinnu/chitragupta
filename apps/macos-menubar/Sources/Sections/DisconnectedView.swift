/// Disconnected state — breathing flame icon, "Start Daemon" button,
/// CLI hint, error display. Smooth transitions throughout.

import SwiftUI

/// Full-popover view shown when the daemon is unreachable.
/// Provides a breathing flame animation, a "Start Daemon" button that triggers
/// `DaemonClient.startDaemon()`, a CLI hint, and an error banner.
/// This view replaces the entire section layout — it is not a subsection.
struct DisconnectedView: View {
    @ObservedObject var client: DaemonClient
    /// Controls the flame icon scale oscillation (3s cycle).
    @State private var flameBreathing = false
    /// Controls the outer glow circle scale (4s cycle, offset from flame for organic feel).
    @State private var flameGlow = false

    var body: some View {
        VStack(spacing: 0) {
            // Offline header
            HStack(spacing: Theme.sp8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(Theme.label.opacity(0.06))
                        .frame(width: 24, height: 24)
                    Text("C")
                        .font(.system(size: 14, weight: .black, design: .rounded))
                        .foregroundColor(Theme.tertiaryLabel)
                }

                Text("Chitragupta")
                    .font(.system(size: Theme.titleSize, weight: .semibold, design: .rounded))
                    .foregroundColor(Theme.secondaryLabel)

                Spacer()

                HStack(spacing: Theme.sp4) {
                    Circle()
                        .fill(Theme.tertiaryLabel)
                        .frame(width: 7, height: 7)
                    Text("Offline")
                        .font(.system(size: Theme.captionSize, weight: .medium))
                        .foregroundColor(Theme.tertiaryLabel)
                }
            }
            .padding(.horizontal, Theme.sp16)
            .padding(.vertical, Theme.sp12)

            Spacer()

            VStack(spacing: Theme.sp16) {
                // Breathing flame — two nested loops at different periods (3s / 4s)
                // create a subtle organic pulse that avoids mechanical repetition.
                ZStack {
                    Circle()
                        .fill(Theme.amber.opacity(0.06))
                        .frame(width: 80, height: 80)
                        .scaleEffect(flameGlow ? 1.1 : 0.9)
                    Circle()
                        .fill(Theme.amber.opacity(0.03))
                        .frame(width: 60, height: 60)
                    Image(systemName: "flame")
                        .font(.system(size: 30, weight: .thin))
                        .foregroundColor(Theme.tertiaryLabel)
                        .scaleEffect(flameBreathing ? 1.05 : 0.95)
                }
                .onAppear {
                    withAnimation(.easeInOut(duration: 3.0).repeatForever(autoreverses: true)) {
                        flameBreathing = true
                    }
                    withAnimation(.easeInOut(duration: 4.0).repeatForever(autoreverses: true)) {
                        flameGlow = true
                    }
                }

                VStack(spacing: Theme.sp6) {
                    Text("Daemon is offline")
                        .font(.system(size: Theme.titleSize, weight: .medium))
                        .foregroundColor(Theme.label)
                    Text("Start from terminal or click below")
                        .font(.system(size: Theme.bodySize))
                        .foregroundColor(Theme.secondaryLabel)
                }

                // Swap between spinner and button with a matched spring transition
                if client.isStarting {
                    HStack(spacing: Theme.sp8) {
                        ProgressView()
                            .controlSize(.small)
                            .scaleEffect(0.8)
                        Text("Starting...")
                            .font(.system(size: Theme.bodySize, weight: .medium))
                            .foregroundColor(Theme.amber)
                    }
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                } else {
                    StartButton {
                        client.startDaemon()
                    }
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }

                Text("chitragupta daemon start")
                    .font(.system(size: Theme.captionSize, design: .monospaced))
                    .foregroundColor(Theme.tertiaryLabel)
                    .padding(.horizontal, Theme.sp12)
                    .padding(.vertical, Theme.sp4)
                    .background(Theme.label.opacity(0.04))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSm, style: .continuous))

                if let err = client.lastError {
                    Text(err)
                        .font(.system(size: Theme.miniSize))
                        .foregroundColor(Theme.coral.opacity(0.8))
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, Theme.sp24)
                        .transition(.opacity)
                }
            }
            .animation(.spring(response: 0.4), value: client.isStarting)

            Spacer()
        }
        .frame(height: 380)
    }
}

// MARK: - Start Button with liquid hover

/// Capsule-shaped CTA with an amber-to-gold gradient. Uses spring-based
/// hover scaling and a dynamic shadow glow to create a "liquid" tactile feel.
private struct StartButton: View {
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.sp6) {
                Image(systemName: "play.fill")
                    .font(.system(size: 11))
                Text("Start Daemon")
                    .font(.system(size: Theme.bodySize, weight: .semibold))
            }
            .foregroundColor(.black)
            .padding(.horizontal, Theme.sp24)
            .padding(.vertical, Theme.sp8)
            .background(
                LinearGradient(
                    colors: [Theme.amber, Theme.gold],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .clipShape(Capsule())
            .scaleEffect(isHovered ? 1.05 : 1.0)
            .shadow(color: Theme.amber.opacity(isHovered ? 0.4 : 0.15), radius: isHovered ? 8 : 4, y: 2)
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                isHovered = hovering
            }
        }
    }
}
