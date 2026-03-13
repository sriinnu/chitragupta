/// Apple-style inset grouped container — rounded rect with opaque
/// controlBackgroundColor, matching System Settings sections.
/// Separator stroke for edge definition against vibrancy material.

import SwiftUI

/// Generic container that mimics the iOS/macOS "inset grouped" table section style.
///
/// Renders an optional uppercased header above a rounded, opaque content area with
/// a hairline border stroke. Content is typically a stack of `SectionRow` views.
///
/// - Parameter header: Optional section title displayed above the content card.
/// - Parameter content: A `@ViewBuilder` closure producing the section body.
struct InsetGroupedSection<Content: View>: View {
    let header: String?
    @ViewBuilder let content: () -> Content

    init(_ header: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.header = header
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let header {
                Text(header.uppercased())
                    .font(.system(size: Theme.miniSize, weight: .medium))
                    .foregroundColor(Theme.secondaryLabel)
                    .tracking(0.5)
                    .padding(.horizontal, Theme.sp16)
                    .padding(.bottom, Theme.sp6)
            }

            // Content card: opaque background with hairline border for definition
            // against vibrancy material parents.
            VStack(spacing: 0) {
                content()
            }
            .background(Theme.controlBackground)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous)
                    .stroke(Theme.separator, lineWidth: 0.5)
            )
        }
    }
}
