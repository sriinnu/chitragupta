/// Thin horizontal bar showing context pressure (0..1 or 0..100).
/// Green < 50%, orange 50-80%, red > 80%.
/// Animates bar width changes smoothly.

import SwiftUI

/// Displays a thin horizontal gauge representing how much of the LLM's context window
/// is consumed. Accepts pressure as either a 0..1 ratio or a 0..100 percentage --
/// automatically normalizes to 0..1 internally.
struct ContextPressureBar: View {
    /// Raw pressure value from the daemon. May be 0..1 (ratio) or 0..100 (percentage).
    let pressure: Double

    /// Auto-detects scale: values >1 are treated as percentages and divided by 100.
    private var normalized: Double {
        pressure > 1 ? pressure / 100.0 : pressure
    }

    /// Three-tier color ramp: green (healthy), orange (warning), red (critical).
    private var barColor: Color {
        if normalized < 0.5 { return Theme.alive }
        if normalized < 0.8 { return Theme.orange }
        return Theme.coral
    }

    var body: some View {
        HStack(spacing: Theme.sp8) {
            Text("Context")
                .font(.system(size: Theme.miniSize))
                .foregroundColor(Theme.tertiaryLabel)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    // Track (background)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Theme.label.opacity(0.06))
                    // Fill (foreground), clamped to [0, containerWidth]
                    RoundedRectangle(cornerRadius: 2)
                        .fill(barColor)
                        .frame(width: max(0, geo.size.width * CGFloat(min(normalized, 1.0))))
                        .animation(.spring(response: 0.6, dampingFraction: 0.8), value: normalized)
                }
            }
            .frame(height: 4)

            Text(String(format: "%.0f%%", normalized * 100))
                .font(.system(size: Theme.miniSize, design: .monospaced))
                .foregroundColor(barColor)
                .frame(width: 32, alignment: .trailing)
        }
    }
}
