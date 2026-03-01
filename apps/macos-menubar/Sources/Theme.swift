/// Design tokens for the Chitragupta menubar app.
///
/// Warm amber/gold palette inspired by the sacred flame.
/// All colors, spacing, and typography in one place.

import SwiftUI

enum Theme {

    // MARK: - Colors

    /// Sacred flame amber — primary brand accent.
    static let amber = Color(red: 0.96, green: 0.72, blue: 0.26)

    /// Deep warm gold for subtle highlights.
    static let gold = Color(red: 0.85, green: 0.65, blue: 0.13)

    /// Soft coral for warnings.
    static let coral = Color(red: 0.95, green: 0.45, blue: 0.35)

    /// Alive green — calmer than system green.
    static let alive = Color(red: 0.30, green: 0.82, blue: 0.55)

    /// Deep background for cards.
    static let cardBg = Color.white.opacity(0.04)

    /// Card border.
    static let cardBorder = Color.white.opacity(0.08)

    /// Muted text.
    static let muted = Color.white.opacity(0.45)

    /// Secondary text.
    static let secondary = Color.white.opacity(0.6)

    /// Section label — uppercase, tracked.
    static let sectionLabel = Color.white.opacity(0.35)

    // MARK: - Spacing

    static let spacing2: CGFloat = 2
    static let spacing4: CGFloat = 4
    static let spacing6: CGFloat = 6
    static let spacing8: CGFloat = 8
    static let spacing12: CGFloat = 12
    static let spacing16: CGFloat = 16
    static let spacing20: CGFloat = 20

    // MARK: - Radii

    static let radiusSm: CGFloat = 6
    static let radiusMd: CGFloat = 10
    static let radiusLg: CGFloat = 14
}
