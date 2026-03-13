/// Knowledge section — hero total (32pt bold) + segment bar + chevron-expandable
/// breakdown with 7 rows showing each memory type.
/// Smooth spring animations on expand/collapse.

import SwiftUI

/// Shows aggregated memory/knowledge counts from the daemon's database.
/// Collapsed state: hero number + color-coded segment bar.
/// Expanded state: 7 detail rows (conversations, sessions, rules, vidhis,
/// samskaras, vasanas, akasha traces) each with a color dot matching the bar segment.
/// Expansion state is bound externally so the parent can persist it.
struct KnowledgeSection: View {
    let db: DbCounts?
    /// Externally controlled expansion toggle (persisted by parent view).
    @Binding var isExpanded: Bool

    var body: some View {
        InsetGroupedSection("Knowledge") {
            if let db, db.hasContent {
                VStack(alignment: .leading, spacing: Theme.sp8) {
                    // Hero number + chevron
                    HStack(alignment: .firstTextBaseline) {
                        Text(formatLargeNumber(db.total))
                            .font(.system(size: Theme.heroSize, weight: .bold, design: .rounded))
                            .foregroundColor(Theme.label)
                            .contentTransition(.numericText())

                        Text("total memories")
                            .font(.system(size: Theme.bodySize))
                            .foregroundColor(Theme.secondaryLabel)

                        Spacer()

                        Button(action: {
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                                isExpanded.toggle()
                            }
                        }) {
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(Theme.secondaryLabel)
                                .rotationEffect(.degrees(isExpanded ? 90 : 0))
                                .frame(width: 26, height: 26)
                                .background(Theme.label.opacity(0.06))
                                .clipShape(Circle())
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, Theme.sp16)
                    .padding(.top, Theme.sp12)

                    // Segment bar
                    SegmentBar(db: db)
                        .padding(.horizontal, Theme.sp16)

                    // Expanded breakdown — each row's color dot matches its
                    // segment in the bar via `Theme.segmentColors[idx]`.
                    if isExpanded {
                        Divider()
                            .padding(.leading, Theme.sp16)

                        ForEach(Array(db.segments.enumerated()), id: \.offset) { idx, seg in
                            HStack(spacing: Theme.sp8) {
                                Circle()
                                    .fill(Theme.segmentColors[idx])
                                    .frame(width: 8, height: 8)

                                Text(seg.label)
                                    .font(.system(size: Theme.bodySize))
                                    .foregroundColor(Theme.label)

                                Spacer()

                                Text(formatCount(seg.count))
                                    .font(.system(size: Theme.bodySize, weight: .medium, design: .monospaced))
                                    .foregroundColor(seg.count == 0 ? Theme.tertiaryLabel : Theme.label)
                            }
                            .padding(.horizontal, Theme.sp16)
                            .padding(.vertical, Theme.sp4)
                            .transition(.asymmetric(
                                insertion: .opacity.combined(with: .move(edge: .top)).combined(with: .scale(scale: 0.95)),
                                removal: .opacity.combined(with: .scale(scale: 0.95))
                            ))
                        }
                    }
                }
                .padding(.bottom, Theme.sp12)
            } else {
                // Empty state
                HStack(spacing: Theme.sp12) {
                    Image(systemName: "brain")
                        .font(.system(size: 20))
                        .foregroundColor(Theme.tertiaryLabel)
                    VStack(alignment: .leading, spacing: Theme.sp4) {
                        Text("No memories yet")
                            .font(.system(size: Theme.bodySize, weight: .medium))
                            .foregroundColor(Theme.secondaryLabel)
                        Text("Start a conversation to build knowledge")
                            .font(.system(size: Theme.captionSize))
                            .foregroundColor(Theme.tertiaryLabel)
                    }
                }
                .padding(Theme.sp16)
            }
        }
    }

    // MARK: - Formatting

    /// Compact count for detail rows: >= 100K shows "150K", >= 1K shows "1.2K", else raw number.
    private func formatCount(_ n: Int) -> String {
        if n >= 100_000 { return String(format: "%.0fK", Double(n) / 1000) }
        if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1000) }
        return "\(n)"
    }

    /// Locale-aware comma-separated number for the hero display (e.g. "12,345").
    private func formatLargeNumber(_ n: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = ","
        return formatter.string(from: NSNumber(value: n)) ?? "\(n)"
    }
}
