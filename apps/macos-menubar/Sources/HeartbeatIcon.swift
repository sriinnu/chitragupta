/// Animated status bar icon — a stylized torii gate (鳥居).
///
/// The torii renders differently depending on daemon state:
///
/// | State          | Color        | Animation                              |
/// |----------------|--------------|----------------------------------------|
/// | Disconnected   | Gray         | Static, no movement                    |
/// | Idle           | Amber        | Gentle slow sway, soft glow            |
/// | Active/Busy    | Green        | Lively sway, bright pulsing glow       |
/// | Consolidating  | Purple       | Dreamy slow float, deep glow           |
/// | Deep Sleep     | Indigo/dim   | Near-still, faint breathing glow       |
/// | Error          | Coral/red    | Quick jitter, flickering glow          |
///
/// ## Torii Gate Anatomy
///
/// ```
///     ╭───────────────────╮   ← kasagi (curved top beam, animated)
///     │    ┌─────────┐    │
///     │    │  nuki   │    │   ← nuki (lower crossbar, rigid)
///     │    └─────────┘    │
///    ┌┤┐                ┌┤┐
///    │ │                │ │   ← pillars (tapered, slightly spread outward)
///    └─┘                └─┘
/// ```

import AppKit

// MARK: - Daemon state for icon rendering

/// Represents the daemon's current state, driving distinct icon animations.
enum DaemonState {
    case disconnected        // gray, static
    case idle                // amber, gentle sway
    case active              // green, lively
    case consolidating       // purple, dreamy float
    case deepSleep           // indigo, near-still breathing
    case error               // coral, jitter

    /// Primary fill color for the torii gate in this state.
    var color: NSColor {
        switch self {
        case .disconnected:   return .gray
        case .idle:           return NSColor(red: 0.96, green: 0.72, blue: 0.10, alpha: 1.0)
        case .active:         return NSColor(red: 0.30, green: 0.78, blue: 0.40, alpha: 1.0)
        case .consolidating:  return NSColor(red: 0.65, green: 0.45, blue: 0.95, alpha: 1.0)
        case .deepSleep:      return NSColor(red: 0.40, green: 0.45, blue: 0.75, alpha: 1.0)
        case .error:          return NSColor(red: 0.95, green: 0.40, blue: 0.35, alpha: 1.0)
        }
    }

    /// Kasagi sway amplitude in pixels. Higher = more rocking.
    var swayAmplitude: CGFloat {
        switch self {
        case .disconnected:   return 0.0
        case .idle:           return 0.30
        case .active:         return 0.55
        case .consolidating:  return 0.20
        case .deepSleep:      return 0.08
        case .error:          return 0.70
        }
    }

    /// Sway frequency multiplier. Higher = faster rocking.
    var swaySpeed: CGFloat {
        switch self {
        case .disconnected:   return 0.0
        case .idle:           return 0.8
        case .active:         return 1.6
        case .consolidating:  return 0.4
        case .deepSleep:      return 0.25
        case .error:          return 3.5     // rapid jitter
        }
    }

    /// Base glow alpha behind the gate center.
    var glowBase: CGFloat {
        switch self {
        case .disconnected:   return 0.0
        case .idle:           return 0.12
        case .active:         return 0.22
        case .consolidating:  return 0.18
        case .deepSleep:      return 0.06
        case .error:          return 0.15
        }
    }

    /// Glow pulse amplitude (added/subtracted from base).
    var glowPulse: CGFloat {
        switch self {
        case .disconnected:   return 0.0
        case .idle:           return 0.06
        case .active:         return 0.12
        case .consolidating:  return 0.10
        case .deepSleep:      return 0.04
        case .error:          return 0.12
        }
    }

    /// Glow pulse speed multiplier.
    var glowSpeed: CGFloat {
        switch self {
        case .disconnected:   return 0.0
        case .idle:           return 1.0
        case .active:         return 1.8
        case .consolidating:  return 0.5     // slow dreamy pulse
        case .deepSleep:      return 0.3     // very slow breathing
        case .error:          return 4.0     // rapid flicker
        }
    }

    /// Overall opacity of the gate structure.
    var gateOpacity: CGFloat {
        switch self {
        case .disconnected:   return 0.5
        case .idle:           return 0.92
        case .active:         return 1.0
        case .consolidating:  return 0.88
        case .deepSleep:      return 0.45    // dim, sleeping
        case .error:          return 0.85
        }
    }

    /// Glow radius — consolidating gets a wider aura, deep sleep is tight.
    var glowRadius: CGFloat {
        switch self {
        case .disconnected:   return 0.0
        case .idle:           return 6.0
        case .active:         return 7.0
        case .consolidating:  return 8.5     // wide dreamy halo
        case .deepSleep:      return 4.0     // tight dim glow
        case .error:          return 5.5
        }
    }
}

// MARK: - Icon renderer

/// Renders the torii gate icon as an `NSImage` for the status bar.
/// Stateless — all animation state is passed in via `phase` and `state`.
enum HeartbeatIcon {

    /// Fixed 18×18pt — standard macOS status bar icon size.
    private static let size = NSSize(width: 18, height: 18)

    /// Render the torii for a given animation phase and daemon state.
    ///
    /// - Parameters:
    ///   - phase: Animation phase in radians (0...2π per full cycle).
    ///   - state: Current daemon state — drives color, animation character, and opacity.
    /// - Returns: A non-template `NSImage` suitable for `NSStatusBarButton.image`.
    static func render(phase: CGFloat, state: DaemonState) -> NSImage {
        let color = state.color
        let opacity = state.gateOpacity

        let image = NSImage(size: size, flipped: false) { rect in
            let cx = rect.midX
            let bottom: CGFloat = 1.0
            let top: CGFloat = rect.maxY - 1.0

            // Animation parameters shaped by state.
            let sway = sin(phase * state.swaySpeed) * state.swayAmplitude
            let glow = state.glowBase + sin(phase * state.glowSpeed) * state.glowPulse

            // ── Layout constants ────────────────────
            let pillarSpread: CGFloat = 4.8
            let pillarW: CGFloat = 1.8
            let kasakiY = top - 2.5
            let nukiY = kasakiY - 2.5
            let pillarTopY = kasakiY + 0.5
            let overhang: CGFloat = 2.0
            let curve: CGFloat = 1.6

            // ── Soft glow behind gate ───────────────
            if glow > 0.01 {
                let glowCenter = NSPoint(x: cx, y: (nukiY + kasakiY) / 2)
                if let gradient = NSGradient(
                    colors: [
                        color.withAlphaComponent(glow),
                        color.withAlphaComponent(0),
                    ],
                    atLocations: [0, 1],
                    colorSpace: .deviceRGB
                ) {
                    gradient.draw(
                        fromCenter: glowCenter, radius: 0,
                        toCenter: glowCenter, radius: state.glowRadius,
                        options: []
                    )
                }
            }

            // ── Pillars (tapered) ───────────────────
            let taper: CGFloat = 0.3
            for sign: CGFloat in [-1, 1] {
                let baseX = cx + sign * (pillarSpread / 2)
                let pillar = NSBezierPath()
                pillar.move(to: NSPoint(x: baseX - pillarW / 2 - taper * sign * 0.5, y: bottom))
                pillar.line(to: NSPoint(x: baseX + pillarW / 2 + taper * sign * 0.5, y: bottom))
                pillar.line(to: NSPoint(x: baseX + pillarW / 2, y: pillarTopY))
                pillar.line(to: NSPoint(x: baseX - pillarW / 2, y: pillarTopY))
                pillar.close()
                color.withAlphaComponent(opacity * 0.92).setFill()
                pillar.fill()
            }

            // ── Nuki (lower crossbar) ───────────────
            let nukiHalf = pillarSpread / 2 + pillarW / 2 + 0.3
            let nukiH: CGFloat = 1.3
            let nuki = NSBezierPath(rect: NSRect(
                x: cx - nukiHalf,
                y: nukiY - nukiH / 2,
                width: nukiHalf * 2,
                height: nukiH
            ))
            color.withAlphaComponent(opacity * 0.88).setFill()
            nuki.fill()

            // ── Kasagi (curved top beam with sway) ──
            let kasakiHalf = pillarSpread / 2 + overhang
            let kasakiH: CGFloat = 1.6
            let kasagi = NSBezierPath()

            kasagi.move(to: NSPoint(
                x: cx - kasakiHalf,
                y: kasakiY - kasakiH / 2 + sway * 0.4
            ))
            kasagi.line(to: NSPoint(
                x: cx + kasakiHalf,
                y: kasakiY - kasakiH / 2 - sway * 0.4
            ))

            kasagi.line(to: NSPoint(
                x: cx + kasakiHalf + 0.3,
                y: kasakiY + kasakiH / 2 + curve - sway * 0.4
            ))

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
            color.withAlphaComponent(opacity * 0.95).setFill()
            kasagi.fill()

            return true
        }

        image.isTemplate = false
        return image
    }
}
