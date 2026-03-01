/// Reusable view components for the Chitragupta menubar app.
///
/// GlassCard, footer bar, and footer buttons extracted from
/// MenubarView to stay under the 450 LOC limit.

import SwiftUI

// ─── Glass Card ──────────────────────────────────────────────

struct GlassCard<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .padding(Theme.spacing12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMd))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusMd)
                    .stroke(Theme.cardBorder, lineWidth: 0.5)
            )
    }
}

// ─── Footer Bar ─────────────────────────────────────────────

struct FooterBar: View {
    @ObservedObject var client: DaemonClient

    var body: some View {
        HStack(spacing: Theme.spacing8) {
            footerButton("Learn Now", icon: "sparkles") {
                Task { await client.consolidate() }
            }
            footerButton("Dashboard", icon: "globe") {
                client.openHub()
            }

            Spacer()

            // Stop button — destructive style
            Button(action: { Task { await client.stopDaemon() } }) {
                Image(systemName: "power")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(Theme.coral.opacity(0.8))
                    .frame(width: 28, height: 28)
                    .background(Theme.coral.opacity(0.1))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .help("Stop daemon")

            // Quit button
            Button(action: { NSApplication.shared.terminate(nil) }) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(Theme.muted)
                    .frame(width: 28, height: 28)
                    .background(Color.white.opacity(0.04))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .help("Quit menubar app")
        }
        .padding(.horizontal, Theme.spacing16)
        .padding(.vertical, Theme.spacing12)
        .background(Color.white.opacity(0.02))
    }

    private func footerButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: Theme.spacing4) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .medium))
                Text(title)
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundColor(.white.opacity(0.7))
            .padding(.horizontal, Theme.spacing12)
            .padding(.vertical, Theme.spacing6)
            .background(Color.white.opacity(0.06))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
