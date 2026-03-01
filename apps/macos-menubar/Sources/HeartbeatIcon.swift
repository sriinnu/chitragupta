/// Animated sacred flame icon for the NSStatusItem.
///
/// Draws a stylized flame using two sine-wave paths with
/// phase animation. Color reflects daemon health state:
/// - Green: healthy and connected
/// - Yellow: connected but pipeline issues
/// - Red: error state
/// - Gray: disconnected

import AppKit

enum HeartbeatIcon {

    /// Icon size for the status bar.
    private static let size = NSSize(width: 18, height: 18)

    /// Render the flame icon at the given animation phase and health color.
    static func render(phase: CGFloat, health: NSColor) -> NSImage {
        let image = NSImage(size: size, flipped: false) { rect in
            let cx = rect.midX
            let baseY = rect.minY + 2
            let topY = rect.maxY - 2
            let height = topY - baseY

            // Outer flame path
            let outer = NSBezierPath()
            outer.move(to: NSPoint(x: cx, y: baseY))
            outer.curve(
                to: NSPoint(x: cx, y: topY),
                controlPoint1: NSPoint(
                    x: cx + 6 + sin(phase) * 1.5,
                    y: baseY + height * 0.35
                ),
                controlPoint2: NSPoint(
                    x: cx + 4 + cos(phase * 0.7) * 1.0,
                    y: baseY + height * 0.7
                )
            )
            outer.curve(
                to: NSPoint(x: cx, y: baseY),
                controlPoint1: NSPoint(
                    x: cx - 4 + sin(phase * 0.7) * 1.0,
                    y: baseY + height * 0.7
                ),
                controlPoint2: NSPoint(
                    x: cx - 6 + cos(phase) * 1.5,
                    y: baseY + height * 0.35
                )
            )
            outer.close()

            health.withAlphaComponent(0.7).setFill()
            outer.fill()

            // Inner flame (brighter core)
            let inner = NSBezierPath()
            let innerBase = baseY + height * 0.15
            let innerTop = topY - height * 0.15
            let innerH = innerTop - innerBase

            inner.move(to: NSPoint(x: cx, y: innerBase))
            inner.curve(
                to: NSPoint(x: cx, y: innerTop),
                controlPoint1: NSPoint(
                    x: cx + 3 + sin(phase + 1.0) * 0.8,
                    y: innerBase + innerH * 0.4
                ),
                controlPoint2: NSPoint(
                    x: cx + 2 + cos(phase * 0.8 + 0.5) * 0.5,
                    y: innerBase + innerH * 0.7
                )
            )
            inner.curve(
                to: NSPoint(x: cx, y: innerBase),
                controlPoint1: NSPoint(
                    x: cx - 2 + sin(phase * 0.8 + 0.5) * 0.5,
                    y: innerBase + innerH * 0.7
                ),
                controlPoint2: NSPoint(
                    x: cx - 3 + cos(phase + 1.0) * 0.8,
                    y: innerBase + innerH * 0.4
                )
            )
            inner.close()

            health.withAlphaComponent(1.0).setFill()
            inner.fill()

            return true
        }

        image.isTemplate = false
        return image
    }
}
