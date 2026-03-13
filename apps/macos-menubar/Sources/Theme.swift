/// Design tokens for the Chitragupta menubar app — v3 Apple-native redesign.
///
/// Uses Apple semantic colors (NSColor → Color) so the UI respects system
/// appearance (light/dark) automatically. One brand accent (amber).
/// 8pt grid spacing. Minimum text size 10pt.

import SwiftUI

/// Centralized design token namespace for the Chitragupta menubar app.
///
/// All colors, spacing, corner radii, and type sizes live here so every view
/// draws from a single source of truth. Colors wrap `NSColor` semantic values,
/// which means light/dark mode and accessibility high-contrast are handled
/// automatically — no manual `@Environment(\.colorScheme)` checks needed.
enum Theme {

    // MARK: - Brand

    /// Sacred flame amber — the single brand accent used for the torii icon,
    /// primary buttons, and healthy-state indicators.
    static let amber = Color(red: 0.96, green: 0.72, blue: 0.10)

    /// Deep warm gold for gradients and secondary brand use.
    static let gold = Color(red: 0.85, green: 0.65, blue: 0.05)

    // MARK: - System semantic colors
    // Bridged from NSColor so they track Aqua/Dark/HighContrast automatically.

    /// Primary text (adapts to light/dark).
    static let label = Color(nsColor: .labelColor)

    /// Secondary text.
    static let secondaryLabel = Color(nsColor: .secondaryLabelColor)

    /// Tertiary text.
    static let tertiaryLabel = Color(nsColor: .tertiaryLabelColor)

    /// Quaternary text (lowest emphasis).
    static let quaternaryLabel = Color(nsColor: .quaternaryLabelColor)

    /// Standard control background (inset grouped sections).
    static let controlBackground = Color(nsColor: .controlBackgroundColor)

    /// Window background.
    static let windowBackground = Color(nsColor: .windowBackgroundColor)

    /// System separator.
    static let separator = Color(nsColor: .separatorColor)

    // MARK: - Semantic state colors
    // These map daemon lifecycle states to colors used across badges,
    // section headers, and the status bar icon.

    /// Healthy / connected / success.
    static let alive = Color(nsColor: .systemGreen)

    /// Warning / destructive.
    static let coral = Color(nsColor: .systemRed)

    /// Consolidation / processing / learning (Nidra active).
    static let purple = Color(nsColor: .systemPurple)

    /// Info / neutral active state.
    static let blue = Color(nsColor: .systemBlue)

    /// Orange for caution states (e.g. empty knowledge base).
    static let orange = Color(nsColor: .systemOrange)

    // MARK: - Knowledge segment colors
    // Each segment maps 1:1 to a DbCounts field and is used in SegmentBar
    // to render the stacked horizontal bar chart. Order here must match
    // the order returned by `DbCounts.segments`.

    static let segConversations = Color(red: 0.96, green: 0.72, blue: 0.10)  // amber
    static let segSessions = Color(nsColor: .systemBlue)
    static let segRules = Color(nsColor: .systemPurple)
    static let segProcedures = Color(nsColor: .systemGreen)
    static let segImpressions = Color(nsColor: .systemPink)
    static let segTendencies = Color(nsColor: .systemTeal)
    static let segShared = Color(red: 0.85, green: 0.65, blue: 0.05)         // gold

    /// Ordered array consumed by `SegmentBar` — index-matched to `DbCounts.segments`.
    static let segmentColors: [Color] = [
        segConversations, segSessions, segRules,
        segProcedures, segImpressions, segTendencies,
        segShared,
    ]

    // MARK: - Spacing (8pt grid)
    // Consistent spacing scale. sp8 is the base unit; others are multiples
    // or half-steps for tighter layouts.

    static let sp4: CGFloat = 4
    static let sp6: CGFloat = 6
    static let sp8: CGFloat = 8
    static let sp12: CGFloat = 12
    static let sp16: CGFloat = 16
    static let sp20: CGFloat = 20
    static let sp24: CGFloat = 24
    static let sp32: CGFloat = 32

    // MARK: - Radii

    static let radiusSm: CGFloat = 6   // pills, small badges
    static let radiusMd: CGFloat = 10  // cards, section containers
    static let radiusLg: CGFloat = 14  // outer popover sections

    // MARK: - Typography
    // Minimum text size is 10pt (`miniSize`) to stay legible on Retina.

    static let heroSize: CGFloat = 32   // large stat numbers
    static let titleSize: CGFloat = 15  // section titles
    static let bodySize: CGFloat = 13   // default body text
    static let captionSize: CGFloat = 11 // secondary labels
    static let miniSize: CGFloat = 10   // smallest legal text size
}
