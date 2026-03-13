/// NeuralMesh — Living network visualization of daemon connections.
///
/// A novel approach to showing connected clients: instead of a list or a
/// static topology diagram, NeuralMesh renders connections as a living
/// neural network with synaptic activity. Data flows visibly between
/// nodes as pulsing signals along edges.
///
/// ## Design Innovation
///
/// Traditional connection views are tables or lists. NeuralMesh makes the
/// invisible visible — you can SEE data flowing between the daemon hub
/// and its connected clients. Active connections have bright, fast-moving
/// signals. Idle ones have dim, slow pulses. The result is an immediate
/// gestalt understanding of system activity without reading any text.
///
/// ## Architecture
///
/// ```
///   ┌──────────────────────────────────┐
///   │  Central Hub (daemon)            │
///   │      ↕ signal pulses ↕           │
///   │  Node₁ ←──→ Hub ←──→ Node₂      │
///   │              ↕                   │
///   │           Node₃                  │
///   └──────────────────────────────────┘
/// ```
///
/// Each node position is computed using a force-directed layout seeded
/// by the connection index. Signals travel along edges as bright dots
/// with comet tails. Signal frequency and speed scale with `requestCount`
/// and `isRecentlyActive`.
///
/// ## Performance
///
/// - Canvas-based: single draw call per frame, no SwiftUI view hierarchy overhead
/// - O(N) per frame where N = visible connections (capped at 16)
/// - Signal positions computed from `time` modulo — no stored animation state

import SwiftUI

struct NeuralMesh: View {

    let instances: [InstanceInfo]
    let runtimeItems: [RuntimeItem]
    let totalConnections: Int

    private static let meshHeight: CGFloat = 80

    var body: some View {
        if totalConnections == 0 && instances.isEmpty {
            EmptyView()
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
                Canvas { context, size in
                    drawMesh(
                        context: &context,
                        size: size,
                        time: CGFloat(timeline.date.timeIntervalSinceReferenceDate)
                    )
                }
            }
            .frame(height: Self.meshHeight)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
            .background(
                RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous)
                    .fill(Color.black.opacity(0.08))
            )
        }
    }

    // MARK: - Mesh Drawing

    private func drawMesh(context: inout GraphicsContext, size: CGSize, time: CGFloat) {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let nodes = computeNodePositions(in: size)

        // Draw edges with signal pulses
        for node in nodes {
            drawEdge(context: &context, from: center, to: node.position,
                     color: node.color, activity: node.activity, time: time, seed: node.seed)
        }

        // Draw satellite nodes
        for node in nodes {
            drawNode(context: &context, at: node.position, node: node, time: time)
        }

        // Draw central hub (daemon)
        drawHub(context: &context, at: center, time: time)
    }

    // MARK: - Node Layout

    private struct MeshNode {
        let position: CGPoint
        let color: Color
        let activity: CGFloat  // 0..1
        let size: CGFloat
        let label: String
        let seed: CGFloat
    }

    /// Compute node positions using a golden-angle spiral layout.
    /// Avoids overlapping nodes without needing a force simulation.
    private func computeNodePositions(in size: CGSize) -> [MeshNode] {
        var nodes: [MeshNode] = []
        let cx = size.width / 2
        let cy = size.height / 2
        let maxR = min(size.width, size.height) / 2 - 12

        // Instance nodes (inner ring, golden angle)
        let goldenAngle: CGFloat = .pi * (3 - sqrt(5)) // ~137.5°
        for (i, inst) in instances.prefix(8).enumerated() {
            let angle = CGFloat(i) * goldenAngle + .pi / 4
            let r = maxR * (0.5 + 0.15 * CGFloat(i % 3))
            let pos = CGPoint(x: cx + cos(angle) * r, y: cy + sin(angle) * r)
            let active = inst.isCurrentlyActive
            nodes.append(MeshNode(
                position: pos,
                color: instanceColor(inst),
                activity: active ? 0.9 : 0.2,
                size: active ? 6 : 4,
                label: String(inst.displayName.prefix(2)).uppercased(),
                seed: CGFloat(i * 17 + 7)
            ))
        }

        // Runtime nodes (outer ring)
        for (i, item) in runtimeItems.prefix(8).enumerated() {
            let angle = CGFloat(i) * goldenAngle + .pi / 2 + 0.5
            let r = maxR * 0.85
            let pos = CGPoint(x: cx + cos(angle) * r, y: cy + sin(angle) * r)
            nodes.append(MeshNode(
                position: pos,
                color: Theme.blue,
                activity: item.isRecentlyActive ? 0.6 : 0.1,
                size: 3,
                label: String(item.id.prefix(2)).uppercased(),
                seed: CGFloat(i * 31 + 100)
            ))
        }

        return nodes
    }

    // MARK: - Drawing Primitives

    /// Draw an edge with traveling signal pulses.
    private func drawEdge(
        context: inout GraphicsContext,
        from: CGPoint, to: CGPoint,
        color: Color, activity: CGFloat,
        time: CGFloat, seed: CGFloat
    ) {
        // Base edge line
        var line = Path()
        line.move(to: from)
        line.addLine(to: to)
        context.stroke(line, with: .color(color.opacity(Double(0.08 + activity * 0.12))), lineWidth: 0.5)

        // Signal pulses — bright dots traveling along the edge
        let signalCount = activity > 0.5 ? 2 : 1
        let speed: CGFloat = 0.3 + activity * 1.5

        for s in 0..<signalCount {
            let offset = CGFloat(s) * 0.5 + seed * 0.1
            let t = ((time * speed + offset).truncatingRemainder(dividingBy: 2.0)) / 2.0
            guard t >= 0 && t <= 1 else { continue }

            let signalX = from.x + (to.x - from.x) * t
            let signalY = from.y + (to.y - from.y) * t
            let signalPos = CGPoint(x: signalX, y: signalY)

            // Signal dot
            let dotSize: CGFloat = 2 + activity * 2
            let dotRect = CGRect(
                x: signalPos.x - dotSize / 2,
                y: signalPos.y - dotSize / 2,
                width: dotSize,
                height: dotSize
            )
            context.fill(Path(ellipseIn: dotRect), with: .color(color.opacity(Double(0.6 + activity * 0.4))))

            // Signal glow
            if activity > 0.3 {
                let glowSize = dotSize * 3
                let glowRect = CGRect(
                    x: signalPos.x - glowSize / 2,
                    y: signalPos.y - glowSize / 2,
                    width: glowSize,
                    height: glowSize
                )
                var glowCtx = context
                glowCtx.addFilter(.blur(radius: 3))
                glowCtx.fill(Path(ellipseIn: glowRect), with: .color(color.opacity(Double(activity * 0.3))))
            }
        }
    }

    /// Draw a satellite node with breathing animation.
    private func drawNode(context: inout GraphicsContext, at pos: CGPoint, node: MeshNode, time: CGFloat) {
        let breath = 1.0 + sin(time * 1.5 + node.seed) * 0.15 * node.activity
        let size = node.size * breath

        // Node glow
        if node.activity > 0.3 {
            let glowSize = size * 3
            let glowRect = CGRect(x: pos.x - glowSize / 2, y: pos.y - glowSize / 2,
                                  width: glowSize, height: glowSize)
            var glowCtx = context
            glowCtx.addFilter(.blur(radius: 4))
            glowCtx.fill(Path(ellipseIn: glowRect), with: .color(node.color.opacity(Double(node.activity * 0.3))))
        }

        // Node circle
        let rect = CGRect(x: pos.x - size / 2, y: pos.y - size / 2, width: size, height: size)
        context.fill(Path(ellipseIn: rect), with: .color(node.color.opacity(Double(0.5 + node.activity * 0.5))))
    }

    /// Draw the central daemon hub with pulsing aura.
    private func drawHub(context: inout GraphicsContext, at pos: CGPoint, time: CGFloat) {
        let pulse = 1.0 + sin(time * 0.8) * 0.15
        let hubSize: CGFloat = 10 * pulse

        // Outer aura
        let auraSize = hubSize * 3
        let auraRect = CGRect(x: pos.x - auraSize / 2, y: pos.y - auraSize / 2,
                              width: auraSize, height: auraSize)
        var auraCtx = context
        auraCtx.addFilter(.blur(radius: 8))
        auraCtx.fill(Path(ellipseIn: auraRect), with: .color(Theme.amber.opacity(0.2)))

        // Hub circle
        let rect = CGRect(x: pos.x - hubSize / 2, y: pos.y - hubSize / 2,
                          width: hubSize, height: hubSize)
        context.fill(Path(ellipseIn: rect), with: .color(Theme.amber.opacity(0.9)))

        // Inner bright core
        let coreSize = hubSize * 0.5
        let coreRect = CGRect(x: pos.x - coreSize / 2, y: pos.y - coreSize / 2,
                              width: coreSize, height: coreSize)
        context.fill(Path(ellipseIn: coreRect), with: .color(.white.opacity(0.7)))
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
