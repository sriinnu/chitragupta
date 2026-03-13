/// Orbiting activity indicator — small dots circling an icon to show liveness.
///
/// Used on ClientCard to indicate an instance is actively communicating.
/// The orbit speed and dot count scale with connection activity level:
///
/// - 1 dot, slow orbit: idle/recently active
/// - 2 dots, medium orbit: actively working
/// - 3 dots, fast orbit: busy/high throughput
///
/// When `isActive` is false, renders as a static subtle ring.

import SwiftUI

struct ActivityOrbit: View {

    let isActive: Bool
    let intensity: Int  // 0-3, drives dot count and speed
    let color: Color
    let size: CGFloat

    @State private var rotation: Double = 0

    var body: some View {
        ZStack {
            // Background ring (always visible)
            Circle()
                .stroke(color.opacity(isActive ? 0.15 : 0.06), lineWidth: 1)
                .frame(width: size, height: size)

            if isActive {
                // Orbiting dots
                ForEach(0..<dotCount, id: \.self) { i in
                    Circle()
                        .fill(color)
                        .frame(width: dotSize, height: dotSize)
                        .offset(x: size / 2 - dotSize / 2)
                        .rotationEffect(.degrees(rotation + Double(i) * (360 / Double(dotCount))))
                }
                .onAppear {
                    withAnimation(.linear(duration: orbitDuration).repeatForever(autoreverses: false)) {
                        rotation = 360
                    }
                }
            }
        }
        .frame(width: size, height: size)
    }

    private var dotCount: Int {
        max(1, min(intensity, 3))
    }

    private var dotSize: CGFloat {
        max(2.5, size * 0.12)
    }

    /// Faster orbit for higher intensity.
    private var orbitDuration: Double {
        switch intensity {
        case 0: return 4.0
        case 1: return 3.0
        case 2: return 2.0
        default: return 1.2
        }
    }
}
