/// Animated status bar icon — a stylized torii gate (鳥居).
///
/// Clean vector silhouette with subtle animation: the kasagi (top beam)
/// gently sways and a soft glow radiates from the gate center.
/// Color reflects daemon health. Respects "Reduce Motion".
///
/// ## Torii Gate Anatomy
///
/// The icon renders a simplified torii gate, a traditional Japanese gate
/// associated with sacred spaces. The key structural elements:
///
/// ```
///     ╭───────────────────╮   ← kasagi (curved top beam, sways with animation)
///     │    ┌─────────┐    │
///     │    │  nuki   │    │   ← nuki (lower crossbar, rigid)
///     │    └─────────┘    │
///    ┌┤┐                ┌┤┐
///    │ │                │ │   ← pillars (tapered, slightly spread outward)
///    │ │                │ │
///    └─┘                └─┘
/// ```
///
/// ## Animation Math
///
/// - **sway**: `sin(phase * 0.8) * 0.35` — tilts the kasagi beam endpoints
///   in opposite directions, creating a gentle rocking motion. The 0.8
///   multiplier makes it slightly slower than a full sin cycle per 2π of phase.
/// - **glow**: `0.15 + sin(phase) * 0.08` — pulsing radial gradient behind
///   the gate center, oscillating between 7% and 23% opacity.

import AppKit

/// Renders the torii gate icon as an `NSImage` for the status bar.
/// Stateless — all animation state is passed in via `phase`.
enum HeartbeatIcon {

    /// Fixed 18×18pt — standard macOS status bar icon size.
    private static let size = NSSize(width: 18, height: 18)

    /// Render the torii at a given animation phase and health color.
    ///
    /// - Parameters:
    ///   - phase: Animation phase in radians (0...2π per full cycle).
    ///            Drives kasagi sway and glow pulse.
    ///   - health: The fill color reflecting daemon state (amber=healthy,
    ///             gray=disconnected, purple=consolidating, orange=empty DB).
    /// - Returns: A non-template `NSImage` suitable for `NSStatusBarButton.image`.
    static func render(phase: CGFloat, health: NSColor) -> NSImage {
        let image = NSImage(size: size, flipped: false) { rect in
            let cx = rect.midX
            let bottom: CGFloat = 1.0
            let top: CGFloat = rect.maxY - 1.0

            // Animation parameters derived from phase.
            let sway = sin(phase * 0.8) * 0.35   // kasagi tilt (px offset at beam ends)
            let glow = 0.15 + sin(phase) * 0.08   // glow alpha oscillation

            // ── Layout constants ────────────────────
            let pillarSpread: CGFloat = 4.8        // horizontal distance between pillar centers
            let pillarW: CGFloat = 1.8             // pillar width at top
            let kasakiY = top - 2.5                // vertical position of kasagi beam
            let nukiY = kasakiY - 2.5              // nuki sits below kasagi
            let pillarTopY = kasakiY + 0.5         // pillars extend slightly above kasagi
            let overhang: CGFloat = 2.0            // kasagi extends beyond pillars
            let curve: CGFloat = 1.6               // kasagi upward curve at endpoints

            // ── Soft glow behind gate ───────────────
            // Radial gradient centered between nuki and kasagi, pulsing with `glow` alpha.
            let glowCenter = NSPoint(x: cx, y: (nukiY + kasakiY) / 2)
            let glowRadius: CGFloat = 6.5
            if let gradient = NSGradient(
                colors: [
                    health.withAlphaComponent(CGFloat(glow)),
                    health.withAlphaComponent(0),
                ],
                atLocations: [0, 1],
                colorSpace: .deviceRGB
            ) {
                gradient.draw(
                    fromCenter: glowCenter, radius: 0,
                    toCenter: glowCenter, radius: glowRadius,
                    options: []
                )
            }

            // ── Pillars (tapered) ───────────────────
            // Each pillar is a trapezoid: wider at the base, narrower at top.
            // `taper` adds extra width at the bottom on the outside edge,
            // giving the traditional slight outward lean.
            let taper: CGFloat = 0.3
            for sign: CGFloat in [-1, 1] {
                let baseX = cx + sign * (pillarSpread / 2)
                let pillar = NSBezierPath()
                pillar.move(to: NSPoint(x: baseX - pillarW / 2 - taper * sign * 0.5, y: bottom))
                pillar.line(to: NSPoint(x: baseX + pillarW / 2 + taper * sign * 0.5, y: bottom))
                pillar.line(to: NSPoint(x: baseX + pillarW / 2, y: pillarTopY))
                pillar.line(to: NSPoint(x: baseX - pillarW / 2, y: pillarTopY))
                pillar.close()
                health.withAlphaComponent(0.92).setFill()
                pillar.fill()
            }

            // ── Nuki (lower crossbar) ───────────────
            // Simple rectangle spanning the pillar width plus a small margin (0.3).
            let nukiHalf = pillarSpread / 2 + pillarW / 2 + 0.3
            let nukiH: CGFloat = 1.3
            let nuki = NSBezierPath(rect: NSRect(
                x: cx - nukiHalf,
                y: nukiY - nukiH / 2,
                width: nukiHalf * 2,
                height: nukiH
            ))
            health.withAlphaComponent(0.88).setFill()
            nuki.fill()

            // ── Kasagi (curved top beam with sway) ──
            // The kasagi is the most visually distinctive element: it extends
            // beyond the pillars (overhang) and curves upward at both ends.
            // The `sway` offset tilts the left end up while the right goes down
            // (and vice versa), creating the rocking animation.
            //
            // Shape: bottom edge is straight, right side goes up, top edge is
            // a Bézier curve that dips in the middle and rises at the ends
            // (control points at cx±2 pull the curve down), left side closes.
            let kasakiHalf = pillarSpread / 2 + overhang
            let kasakiH: CGFloat = 1.6
            let kasagi = NSBezierPath()

            // Bottom-left corner (sway tilts this end up)
            kasagi.move(to: NSPoint(
                x: cx - kasakiHalf,
                y: kasakiY - kasakiH / 2 + sway * 0.4
            ))
            // Bottom-right corner (sway tilts this end down)
            kasagi.line(to: NSPoint(
                x: cx + kasakiHalf,
                y: kasakiY - kasakiH / 2 - sway * 0.4
            ))

            // Right upturn — the traditional curved-up endpoint
            kasagi.line(to: NSPoint(
                x: cx + kasakiHalf + 0.3,
                y: kasakiY + kasakiH / 2 + curve - sway * 0.4
            ))

            // Top curve: cubic Bézier from right to left.
            // Control points at cx±2 are below the endpoint Y, which pulls
            // the middle of the curve downward — creating the characteristic
            // concave (saddle) shape of a torii kasagi.
            kasagi.curve(
                to: NSPoint(
                    x: cx - kasakiHalf - 0.3,
                    y: kasakiY + kasakiH / 2 + curve + sway * 0.4
                ),
                controlPoint1: NSPoint(
                    x: cx + 2,
                    y: kasakiY + kasakiH / 2 - 0.2
                ),
                controlPoint2: NSPoint(
                    x: cx - 2,
                    y: kasakiY + kasakiH / 2 - 0.2
                )
            )

            kasagi.close()
            health.withAlphaComponent(0.95).setFill()
            kasagi.fill()

            return true
        }

        // Non-template so the health color renders directly rather than
        // being tinted by the system's menubar appearance.
        image.isTemplate = false
        return image
    }
}
