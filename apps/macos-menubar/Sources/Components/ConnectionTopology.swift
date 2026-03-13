/// Connection Topology — radial network graph showing all connected instances.
///
/// Renders the daemon as a central hub with connected instances orbiting
/// around it at different radii based on their role/state. Each node pulses
/// with its current activity level. Lines connect each instance to the hub.
///
/// The visualization provides at-a-glance understanding of:
/// - How many things are connected
/// - Which ones are active (bright, orbiting fast) vs idle (dim, slow)
/// - Connection density and health
///
/// This is the "living" view — it continuously animates to show the
/// daemon network is alive and breathing.

import SwiftUI

struct ConnectionTopology: View {

    let instances: [InstanceInfo]
    let runtimeItems: [RuntimeItem]
    let totalConnections: Int

    private static let hubSize: CGFloat = 14
    private static let viewSize: CGFloat = 100

    @State private var orbitPhase: Double = 0

    var body: some View {
        let allNodes = buildNodes()

        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            Canvas { context, size in
                let center = CGPoint(x: size.width / 2, y: size.height / 2)
                let maxRadius = min(size.width, size.height) / 2 - 8

                // Draw connection lines
                for node in allNodes {
                    let pos = nodePosition(node, center: center, radius: maxRadius,
                                           phase: timeline.date.timeIntervalSinceReferenceDate)
                    var line = Path()
                    line.move(to: center)
                    line.addLine(to: pos)
                    context.stroke(
                        line,
                        with: .color(node.color.opacity(node.isActive ? 0.2 : 0.08)),
                        lineWidth: 0.5
                    )
                }

                // Draw nodes
                for node in allNodes {
                    let pos = nodePosition(node, center: center, radius: maxRadius,
                                           phase: timeline.date.timeIntervalSinceReferenceDate)

                    // Node glow
                    if node.isActive {
                        let glowRect = CGRect(
                            x: pos.x - node.size * 1.5,
                            y: pos.y - node.size * 1.5,
                            width: node.size * 3,
                            height: node.size * 3
                        )
                        var glowCtx = context
                        glowCtx.addFilter(.blur(radius: 4))
                        glowCtx.fill(
                            Path(ellipseIn: glowRect),
                            with: .color(node.color.opacity(0.3))
                        )
                    }

                    // Node circle
                    let rect = CGRect(
                        x: pos.x - node.size / 2,
                        y: pos.y - node.size / 2,
                        width: node.size,
                        height: node.size
                    )
                    context.fill(
                        Path(ellipseIn: rect),
                        with: .color(node.color.opacity(node.isActive ? 0.9 : 0.4))
                    )
                }

                // Central hub
                let hubGlow = CGRect(
                    x: center.x - Self.hubSize,
                    y: center.y - Self.hubSize,
                    width: Self.hubSize * 2,
                    height: Self.hubSize * 2
                )
                var hubGlowCtx = context
                hubGlowCtx.addFilter(.blur(radius: 6))
                hubGlowCtx.fill(
                    Path(ellipseIn: hubGlow),
                    with: .color(Theme.amber.opacity(0.4))
                )

                let hubRect = CGRect(
                    x: center.x - Self.hubSize / 2,
                    y: center.y - Self.hubSize / 2,
                    width: Self.hubSize,
                    height: Self.hubSize
                )
                context.fill(
                    Path(ellipseIn: hubRect),
                    with: .color(Theme.amber)
                )
            }
        }
        .frame(width: Self.viewSize, height: Self.viewSize)
    }

    // MARK: - Node Model

    private struct TopologyNode: Identifiable {
        let id: String
        let orbitRadius: CGFloat  // 0..1 normalized
        let orbitAngle: CGFloat   // starting angle in radians
        let orbitSpeed: CGFloat   // radians per second
        let size: CGFloat
        let color: Color
        let isActive: Bool
    }

    private func buildNodes() -> [TopologyNode] {
        var nodes: [TopologyNode] = []

        // Instance nodes — inner orbit
        for (i, inst) in instances.enumerated() {
            let angle = CGFloat(i) * (2 * .pi / max(CGFloat(instances.count), 1))
            let active = inst.isCurrentlyActive
            nodes.append(TopologyNode(
                id: "inst-\(inst.id)",
                orbitRadius: 0.55,
                orbitAngle: angle,
                orbitSpeed: active ? 0.3 : 0.08,
                size: active ? 7 : 5,
                color: instanceColor(inst),
                isActive: active
            ))
        }

        // Runtime socket nodes — outer orbit
        for (i, item) in runtimeItems.prefix(12).enumerated() {
            let angle = CGFloat(i) * (2 * .pi / max(CGFloat(min(runtimeItems.count, 12)), 1))
            let recent = item.isRecentlyActive
            nodes.append(TopologyNode(
                id: "rt-\(item.id)",
                orbitRadius: 0.82,
                orbitAngle: angle + .pi / 6,
                orbitSpeed: recent ? 0.15 : 0.04,
                size: recent ? 4 : 3,
                color: Theme.blue,
                isActive: recent
            ))
        }

        // If we have more connections than visible nodes, add phantom dots
        let visibleCount = nodes.count
        let extra = totalConnections - visibleCount
        if extra > 0 {
            for i in 0..<min(extra, 8) {
                let angle = CGFloat(i) * (2 * .pi / CGFloat(min(extra, 8)))
                nodes.append(TopologyNode(
                    id: "extra-\(i)",
                    orbitRadius: 0.92,
                    orbitAngle: angle + .pi / 4,
                    orbitSpeed: 0.02,
                    size: 2,
                    color: Theme.tertiaryLabel,
                    isActive: false
                ))
            }
        }

        return nodes
    }

    private func nodePosition(
        _ node: TopologyNode,
        center: CGPoint,
        radius: CGFloat,
        phase: Double
    ) -> CGPoint {
        let angle = node.orbitAngle + CGFloat(phase) * node.orbitSpeed
        let r = radius * node.orbitRadius
        return CGPoint(
            x: center.x + cos(angle) * r,
            y: center.y + sin(angle) * r
        )
    }

    private func instanceColor(_ inst: InstanceInfo) -> Color {
        let s = inst.state?.lowercased() ?? ""
        switch s {
        case "active", "thinking", "busy": return Theme.alive
        case "idle": return Theme.amber
        case "error": return Theme.coral
        default: return Theme.secondaryLabel
        }
    }
}
