/// Key-value row for use inside InsetGroupedSection.
/// Optional SF Symbol icon, label on left, value on right.
/// Smooth hover feedback, separator toggle.

import SwiftUI

/// A single key-value row designed for use inside `InsetGroupedSection`.
///
/// Renders a left-aligned label and right-aligned value, with an optional
/// leading SF Symbol icon. The bottom separator is togglable so the last
/// row in a section can omit it.
///
/// - Parameters:
///   - label: Left-side descriptive text.
///   - value: Right-side data text.
///   - icon: Optional SF Symbol name for a leading icon.
///   - showSeparator: Whether to draw a bottom divider (default `true`).
///   - valueColor: Override color for the value text (default `Theme.label`).
struct SectionRow: View {
    let icon: String?
    let label: String
    let value: String
    var showSeparator: Bool = true
    var valueColor: Color = Theme.label
    @State private var isHovered = false

    init(_ label: String, value: String, icon: String? = nil,
         showSeparator: Bool = true, valueColor: Color = Theme.label) {
        self.label = label
        self.value = value
        self.icon = icon
        self.showSeparator = showSeparator
        self.valueColor = valueColor
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Theme.sp8) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: Theme.bodySize))
                        .foregroundColor(Theme.secondaryLabel)
                        .frame(width: 20)
                }

                Text(label)
                    .font(.system(size: Theme.bodySize))
                    .foregroundColor(Theme.label)

                Spacer()

                Text(value)
                    .font(.system(size: Theme.bodySize))
                    .foregroundColor(valueColor)
            }
            .padding(.horizontal, Theme.sp16)
            .padding(.vertical, Theme.sp8)
            .background(isHovered ? Theme.label.opacity(0.04) : Color.clear)
            .onHover { hovering in
                withAnimation(.easeOut(duration: 0.15)) {
                    isHovered = hovering
                }
            }

            if showSeparator {
                // Inset the divider past the icon column (20pt icon + padding) when
                // an icon is present, matching Apple's grouped-list separator style.
                Divider()
                    .padding(.leading, icon != nil ? 44 : Theme.sp16)
            }
        }
    }
}
