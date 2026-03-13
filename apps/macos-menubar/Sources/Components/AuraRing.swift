/// AuraRing — Ambient state visualization using concentric energy rings.
///
/// A novel UI concept: instead of showing state as a badge or icon, the
/// daemon's state manifests as a living, breathing aura ring around the
/// header. Think of it as the daemon's chakra — its energy field made visible.
///
/// ## Design Philosophy
///
/// Traditional status indicators are discrete: green dot = good, red = bad.
/// AuraRing is continuous and ambient — it communicates state through movement,
/// color, and density rather than explicit labels. The user's subconscious
/// picks up on the ring's character without actively reading it.
///
/// ## Ring Behavior Per State
///
/// | State          | Ring Character                                          |
/// |----------------|---------------------------------------------------------|
/// | Idle           | Warm amber, slow breathing, single ring, gentle glow    |
/// | Active         | Bright green, multiple rings, rotating particles        |
/// | Consolidating  | Deep purple, pulsating concentric waves, aurora-like    |
/// | Deep Sleep     | Dim indigo, barely visible, glacially slow drift        |
/// | Error          | Red, fragmented ring, glitching segments                |
/// | Disconnected   | No ring (returns nil height)                            |
///
/// ## Performance
///
/// Uses `TimelineView(.animation)` with Canvas for GPU-composited drawing.
/// Ring computation is O(segments) per frame with no allocations in the
/// hot path. Respects `accessibilityDisplayShouldReduceMotion` — falls
/// back to a static gradient ring.

import SwiftUI
import AppKit

struct AuraRing: View {

    let state: DaemonState
    let connections: Int

    private static let ringHeight: CGFloat = 6
    private static let segments = 120

    @State private var time: CGFloat = 0

    var body: some View {
        if state == .disconnected {
            EmptyView()
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
                Canvas { context, size in
                    let t = CGFloat(timeline.date.timeIntervalSinceReferenceDate)
                    drawRing(context: &context, size: size, time: t)
                }
            }
            .frame(height: Self.ringHeight)
        }
    }

    private func drawRing(context: inout GraphicsContext, size: CGSize, time: CGFloat) {
        let w = size.width
        let h = size.height
        let midY = h / 2
        let segWidth = w / CGFloat(Self.segments)

        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

        for i in 0..<Self.segments {
            let x = CGFloat(i) * segWidth
            let normalizedX = CGFloat(i) / CGFloat(Self.segments)

            // Each segment's intensity and color shift is computed from state
            let intensity: CGFloat

            if reduceMotion {
                intensity = 0.6
            } else {
                switch state {
                case .idle:
                    let breath = sin(time * 0.8 + normalizedX * .pi * 2) * 0.3 + 0.5
                    intensity = breath

                case .active:
                    let wave1 = sin(time * 2.0 + normalizedX * .pi * 6) * 0.35
                    let wave2 = sin(time * 3.5 - normalizedX * .pi * 4) * 0.2
                    let particle = max(0, sin(normalizedX * .pi * CGFloat(8 + connections) + time * 5) - 0.7) * 2
                    intensity = 0.4 + wave1 + wave2 + particle

                case .consolidating:
                    let aurora1 = sin(time * 0.4 + normalizedX * .pi * 3) * 0.3
                    let aurora2 = sin(time * 0.7 + normalizedX * .pi * 5 + 1.5) * 0.2
                    let pulse = (sin(time * 0.3) + 1) * 0.15
                    intensity = 0.35 + aurora1 + aurora2 + pulse

                case .deepSleep:
                    let drift = sin(time * 0.15 + normalizedX * .pi * 2) * 0.1
                    intensity = 0.15 + drift

                case .error:
                    let glitch = sin(normalizedX * 47.3 + time * 12) > 0.3 ? 1.0 : 0.0
                    let base = sin(time * 4 + normalizedX * .pi * 8) * 0.3 + 0.4
                    intensity = base * (glitch > 0 ? 1.0 : 0.3)

                case .disconnected:
                    intensity = 0
                }
            }

            let baseColor = ringColor
            let alpha = max(0, min(1, intensity))

            // Height variation — segments undulate vertically
            let heightMod: CGFloat = reduceMotion ? 1.0 : (0.6 + intensity * 0.4)
            let segH = h * heightMod
            let segY = midY - segH / 2

            let rect = CGRect(x: x, y: segY, width: segWidth + 0.5, height: segH)
            context.fill(Path(rect), with: .color(baseColor.opacity(Double(alpha * 0.8))))

            // Glow layer
            if intensity > 0.5 {
                var glowCtx = context
                glowCtx.addFilter(.blur(radius: 3))
                glowCtx.fill(Path(rect), with: .color(baseColor.opacity(Double((intensity - 0.5) * 0.6))))
            }
        }
    }

    private var ringColor: Color {
        switch state {
        case .disconnected:   return .clear
        case .idle:           return Theme.amber
        case .active:         return Theme.alive
        case .consolidating:  return Theme.purple
        case .deepSleep:      return Color(red: 0.40, green: 0.45, blue: 0.75)
        case .error:          return Theme.coral
        }
    }
}
