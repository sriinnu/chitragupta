/// Stacked horizontal segment bar showing proportional memory segments.
/// Each non-zero segment gets a minimum visible width.

import SwiftUI

/// Proportional stacked bar showing the relative sizes of memory database segments
/// (e.g. sessions, turns, vasanas, samskaras).
///
/// Each segment with a non-zero count gets a colored slice proportional to its share
/// of `db.total`. A minimum width of 4pt ensures tiny segments remain visible.
/// Colors are index-mapped from `Theme.segmentColors`.
struct SegmentBar: View {
    let db: DbCounts

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 1.5) {
                ForEach(Array(db.segments.enumerated()), id: \.offset) { idx, seg in
                    if seg.count > 0 {
                        let fraction = CGFloat(seg.count) / CGFloat(max(1, db.total))
                        // Subtract total gap space so segment widths sum to the container width.
                        let gaps = CGFloat(nonZeroCount - 1) * 1.5
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Theme.segmentColors[idx])
                            // min 4pt so small segments stay visible
                            .frame(width: max(4, (geo.size.width - gaps) * fraction))
                    }
                }
            }
        }
        .frame(height: 6)
        .clipShape(RoundedRectangle(cornerRadius: 3))
    }

    /// Number of segments with data, used to calculate total gap space between slices.
    private var nonZeroCount: Int {
        db.segments.filter { $0.count > 0 }.count
    }
}
