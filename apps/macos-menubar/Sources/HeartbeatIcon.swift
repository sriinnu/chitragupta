/// Animated status bar icon — a stylized sacred flame.
///
/// Two-layer flame with subtle phase animation. The outer layer
/// breathes gently; the inner core stays bright. Color reflects
/// daemon health. Respects "Reduce Motion" accessibility setting.

import AppKit

enum HeartbeatIcon {

    private static let size = NSSize(width: 18, height: 18)

    /// Render the flame at a given animation phase and health color.
    static func render(phase: CGFloat, health: NSColor) -> NSImage {
        let image = NSImage(size: size, flipped: false) { rect in
            let cx = rect.midX
            let bottom = rect.minY + 2.5
            let top = rect.maxY - 1.5
            let h = top - bottom

            // Subtle sway from animation phase
            let sway1 = sin(phase) * 1.2
            let sway2 = cos(phase * 0.7) * 0.8

            // ── Outer flame (translucent) ────────────
            let outer = NSBezierPath()
            outer.move(to: NSPoint(x: cx, y: bottom))
            outer.curve(
                to: NSPoint(x: cx, y: top),
                controlPoint1: NSPoint(x: cx + 5.5 + sway1, y: bottom + h * 0.32),
                controlPoint2: NSPoint(x: cx + 3.5 + sway2, y: bottom + h * 0.72)
            )
            outer.curve(
                to: NSPoint(x: cx, y: bottom),
                controlPoint1: NSPoint(x: cx - 3.5 + sway2, y: bottom + h * 0.72),
                controlPoint2: NSPoint(x: cx - 5.5 + sway1, y: bottom + h * 0.32)
            )
            outer.close()

            health.withAlphaComponent(0.5).setFill()
            outer.fill()

            // ── Inner core (bright) ──────────────────
            let coreBottom = bottom + h * 0.18
            let coreTop = top - h * 0.12
            let ch = coreTop - coreBottom
            let cs1 = sin(phase + 1.0) * 0.6
            let cs2 = cos(phase * 0.8 + 0.5) * 0.4

            let inner = NSBezierPath()
            inner.move(to: NSPoint(x: cx, y: coreBottom))
            inner.curve(
                to: NSPoint(x: cx, y: coreTop),
                controlPoint1: NSPoint(x: cx + 2.8 + cs1, y: coreBottom + ch * 0.38),
                controlPoint2: NSPoint(x: cx + 1.8 + cs2, y: coreBottom + ch * 0.72)
            )
            inner.curve(
                to: NSPoint(x: cx, y: coreBottom),
                controlPoint1: NSPoint(x: cx - 1.8 + cs2, y: coreBottom + ch * 0.72),
                controlPoint2: NSPoint(x: cx - 2.8 + cs1, y: coreBottom + ch * 0.38)
            )
            inner.close()

            health.withAlphaComponent(0.95).setFill()
            inner.fill()

            // ── Tip highlight ────────────────────────
            let dot = NSBezierPath(
                ovalIn: NSRect(x: cx - 1, y: top - 3, width: 2, height: 2)
            )
            NSColor.white.withAlphaComponent(0.6).setFill()
            dot.fill()

            return true
        }

        image.isTemplate = false
        return image
    }
}
