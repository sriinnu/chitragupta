/// Flow layout — wraps children horizontally, breaking to new lines
/// when content exceeds available width.

import SwiftUI

/// Custom `Layout` that wraps children horizontally, breaking to the next line
/// when cumulative width exceeds the proposed container width.
///
/// Uses a single-pass greedy algorithm: items are placed left-to-right, and a
/// line break is inserted whenever the next item would overflow. Each subview
/// is measured at its ideal (`.unspecified`) size -- it is not stretched or compressed.
///
/// - Parameters:
///   - spacing: Horizontal gap between items on the same line.
///   - lineSpacing: Vertical gap between wrapped lines.
struct FlowLayout: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(proposal: proposal, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        // Re-run arrangement against the actual bounds (may differ from the proposal).
        let result = arrange(
            proposal: ProposedViewSize(width: bounds.width, height: bounds.height),
            subviews: subviews
        )
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: .unspecified
            )
        }
    }

    /// Intermediate result holding the computed bounding size and per-subview positions.
    private struct ArrangeResult {
        var size: CGSize
        var positions: [CGPoint]
    }

    /// Single-pass greedy line-breaking algorithm.
    ///
    /// Walks subviews left-to-right, tracking the current x cursor and the tallest
    /// element on the current line. When a subview would overflow `maxWidth`, the
    /// cursor resets to x=0 on the next line. Returns the tight bounding box and
    /// the origin point for every subview.
    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> ArrangeResult {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var maxX: CGFloat = 0  // tracks the widest line for the bounding box

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            // Wrap to the next line if this item overflows (but not if it's the first on the line).
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            lineHeight = max(lineHeight, size.height)
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
        }

        return ArrangeResult(
            size: CGSize(width: maxX, height: y + lineHeight),
            positions: positions
        )
    }
}
