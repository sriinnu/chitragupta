/// Horizontal three-bar gauge displaying Triguna health values.
///
/// Shows Sattva (harmony), Rajas (activity), and Tamas (inertia)
/// as proportional colored bars with numeric labels.

import SwiftUI

/// Triguna bar gauge component.
struct TrigunaGauge: View {

    let triguna: TrigunaInfo

    private let barHeight: CGFloat = 8
    private let cornerRadius: CGFloat = 4

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            trigunaBar(
                label: "Sattva",
                value: triguna.sattva,
                color: Color(red: 0.2, green: 0.8, blue: 0.4)
            )
            trigunaBar(
                label: "Rajas",
                value: triguna.rajas,
                color: Color(red: 0.9, green: 0.6, blue: 0.1)
            )
            trigunaBar(
                label: "Tamas",
                value: triguna.tamas,
                color: Color(red: 0.6, green: 0.3, blue: 0.3)
            )
        }
    }

    // MARK: - Bar row

    @ViewBuilder
    private func trigunaBar(label: String, value: Double, color: Color) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.secondary)
                .frame(width: 50, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    // Track
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .fill(Color.gray.opacity(0.15))
                        .frame(height: barHeight)

                    // Fill
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .fill(color)
                        .frame(
                            width: max(0, geo.size.width * CGFloat(min(value, 1.0))),
                            height: barHeight
                        )
                }
            }
            .frame(height: barHeight)

            Text(String(format: "%.2f", value))
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.secondary)
                .frame(width: 32, alignment: .trailing)
        }
    }
}
