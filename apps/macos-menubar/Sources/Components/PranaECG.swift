/// Prāṇa — Live ECG waveform visualization.
///
/// A canvas-based electrocardiogram that breathes with the daemon's state.
/// Each `DaemonState` generates a distinct waveform character:
///
/// | State          | Waveform                                       | BPM   |
/// |----------------|------------------------------------------------|-------|
/// | Disconnected   | Flat line (asystole)                           |  0    |
/// | Idle           | Calm resting sinus rhythm, gentle P-QRS-T      | 62    |
/// | Active         | Elevated rate, sharp R peaks, occasional PVCs  | 96    |
/// | Consolidating  | Theta-like slow waves with delta bursts         | 48    |
/// | Deep Sleep     | Slow delta breathing, minimal amplitude         | 32    |
/// | Error          | Arrhythmic chaos — irregular R-R, ST elevation  | 120   |
///
/// ## Rendering Pipeline
///
/// 1. `WaveformEngine` (ObservableObject) drives a 60fps timer.
/// 2. On each tick, advance `phase` by `dt` scaled to state BPM.
/// 3. Write next sample into circular buffer from state waveform generator.
/// 4. Canvas draws 3-pass glow (wide blur + medium + sharp trace) + leading dot.
/// 5. Faint grid lines and baseline reference drawn underneath.
///
/// ## Vital Signs Integration
///
/// The `connections` and `activeCount` parameters modulate waveform amplitude
/// and occasional extra-systole frequency, making the ECG truly reactive to
/// daemon activity — not a canned animation.

import SwiftUI

// MARK: - Waveform Engine

/// Drives the ECG waveform at ~60fps using a Timer.
/// Keeps the circular sample buffer and phase state, publishes on every tick
/// so the Canvas redraws.
@MainActor
final class WaveformEngine: ObservableObject {

    static let bufferSize = 220

    /// Single tick counter — the only @Published property. Canvas reads
    /// `waveBuffer` and `writeHead` directly (no copy, no diff overhead).
    /// This avoids publishing a 220-element array 60 times per second.
    @Published var tick: UInt64 = 0
    var waveBuffer: [CGFloat] = Array(repeating: 0, count: bufferSize)
    var writeHead: Int = 0

    var state: DaemonState = .disconnected
    var connections: Int = 0
    var activeCount: Int = 0

    private var phase: CGFloat = 0
    private var timer: Timer?
    private let noiseSeed: CGFloat = CGFloat.random(in: 0...1000)

    func start() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.advanceFrame()
            }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func advanceFrame() {
        let dt: CGFloat = 1.0 / 60.0
        let bpm = stateBPM
        guard bpm > 0 else {
            // Flatline — write near-zero with tiny noise
            waveBuffer[writeHead] = noise(phase * 0.3) * 0.02
            writeHead = (writeHead + 1) % Self.bufferSize
            phase += 0.01
            return
        }

        let phaseDelta = (2 * .pi * bpm / 60.0) * dt
        phase += phaseDelta
        if phase > 2 * .pi * 100 { phase -= 2 * .pi * 100 }

        waveBuffer[writeHead] = generateSample(phase: phase)
        writeHead = (writeHead + 1) % Self.bufferSize
        tick &+= 1  // notify Canvas to redraw
    }

    // MARK: - BPM

    private var stateBPM: CGFloat {
        switch state {
        case .disconnected:   return 0
        case .idle:           return 62
        case .active:         return 96 + CGFloat(min(activeCount, 5)) * 4
        case .consolidating:  return 48
        case .deepSleep:      return 32
        case .error:          return 120
        }
    }

    // MARK: - Sample Generation

    private func generateSample(phase p: CGFloat) -> CGFloat {
        switch state {
        case .disconnected:   return noise(p * 0.3) * 0.02
        case .idle:           return waveResting(p)
        case .active:         return waveActive(p)
        case .consolidating:  return waveConsolidating(p)
        case .deepSleep:      return waveDeepSleep(p)
        case .error:          return waveArrhythmia(p)
        }
    }

    /// Calm resting sinus rhythm — gentle P-QRS-T complex.
    private func waveResting(_ p: CGFloat) -> CGFloat {
        let cycle = p.truncatingRemainder(dividingBy: 2 * .pi)
        let t = cycle / (2 * .pi)
        if t < 0.12 { return 0.12 * sin(t / 0.12 * .pi) + noise(p) * 0.015 }
        if t < 0.18 { return noise(p) * 0.01 }
        if t < 0.21 { return -0.08 * sin((t - 0.18) / 0.03 * .pi) }
        if t < 0.27 {
            let amp: CGFloat = 0.7 + CGFloat(min(connections, 8)) * 0.02
            return amp * sin((t - 0.21) / 0.06 * .pi) + noise(p * 2) * 0.02
        }
        if t < 0.31 { return -0.15 * sin((t - 0.27) / 0.04 * .pi) }
        if t < 0.42 { return noise(p) * 0.01 }
        if t < 0.58 { return 0.18 * sin((t - 0.42) / 0.16 * .pi) + noise(p) * 0.01 }
        return noise(p) * 0.01
    }

    /// Active — faster, sharper R peaks, occasional PVCs from high activity.
    private func waveActive(_ p: CGFloat) -> CGFloat {
        let cycle = p.truncatingRemainder(dividingBy: 2 * .pi)
        let t = cycle / (2 * .pi)

        let pvcChance: CGFloat = CGFloat(min(activeCount, 4)) * 0.08
        if noise(p * 0.1 + noiseSeed) > (1.0 - pvcChance) && t > 0.65 && t < 0.80 {
            return -0.6 * sin((t - 0.65) / 0.15 * .pi) + noise(p * 3) * 0.04
        }

        if t < 0.10 { return 0.10 * sin(t / 0.10 * .pi) + noise(p) * 0.02 }
        if t < 0.15 { return noise(p) * 0.015 }
        if t < 0.18 { return -0.10 * sin((t - 0.15) / 0.03 * .pi) }
        if t < 0.24 {
            let amp: CGFloat = 0.85 + CGFloat(min(activeCount, 6)) * 0.02
            return amp * sin((t - 0.18) / 0.06 * .pi) + noise(p * 2) * 0.03
        }
        if t < 0.28 { return -0.20 * sin((t - 0.24) / 0.04 * .pi) }
        if t < 0.38 { return noise(p) * 0.015 }
        if t < 0.52 { return 0.22 * sin((t - 0.38) / 0.14 * .pi) + noise(p) * 0.015 }
        return noise(p) * 0.015
    }

    /// Consolidating — theta-like slow waves with sleep spindle bursts.
    private func waveConsolidating(_ p: CGFloat) -> CGFloat {
        let theta = 0.35 * sin(p * 0.7 + noise(p * 0.2) * 0.5)
        let delta = 0.15 * sin(p * 0.3)
        let spindle = 0.08 * sin(p * 4.0) * max(0, sin(p * 0.5))
        return theta + delta + spindle + noise(p) * 0.02
    }

    /// Deep sleep — very slow, low-amplitude delta waves.
    private func waveDeepSleep(_ p: CGFloat) -> CGFloat {
        let delta = 0.25 * sin(p * 0.4)
        let breath = 0.08 * sin(p * 0.15)
        return delta + breath + noise(p * 0.5) * 0.015
    }

    /// Error — chaotic arrhythmia with irregular morphology.
    private func waveArrhythmia(_ p: CGFloat) -> CGFloat {
        let irregR = noise(p * 0.8 + noiseSeed) * 0.4
        let sharp = 0.7 * sin(p * (1.5 + irregR * 2))
        let st = 0.2 * noise(p * 1.5)
        let fib = 0.15 * sin(p * 8.0 + noise(p * 3) * 3)
        return sharp + st + fib + noise(p * 4) * 0.05
    }

    // MARK: - Noise

    func noise(_ x: CGFloat) -> CGFloat {
        let xi = Int(floor(x)) & 0xFF
        let xf = x - floor(x)
        let u = xf * xf * (3 - 2 * xf)
        let a = pseudoRandom(xi)
        let b = pseudoRandom(xi + 1)
        return a + u * (b - a)
    }

    private func pseudoRandom(_ n: Int) -> CGFloat {
        let x = CGFloat(n) * 127.1 + noiseSeed
        return (sin(x) * 43758.5453).truncatingRemainder(dividingBy: 1.0)
    }
}

// MARK: - PranaECG View

struct PranaECG: View {

    let state: DaemonState
    let connections: Int
    let activeCount: Int

    private static let stripHeight: CGFloat = 48

    @StateObject private var engine = WaveformEngine()

    var body: some View {
        // Reference engine.tick to trigger Canvas redraws on each frame.
        let _ = engine.tick
        Canvas { context, size in
            drawGrid(context: &context, size: size)
            drawWaveform(context: &context, size: size)
        }
        .frame(height: Self.stripHeight)
        .background(
            RoundedRectangle(cornerRadius: Theme.radiusSm, style: .continuous)
                .fill(Color.black.opacity(0.15))
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSm, style: .continuous))
        .onAppear {
            engine.state = state
            engine.connections = connections
            engine.activeCount = activeCount
            engine.start()
        }
        .onDisappear {
            engine.stop()
        }
        .onChange(of: state) { newState in
            engine.state = newState
        }
        .onChange(of: connections) { n in
            engine.connections = n
        }
        .onChange(of: activeCount) { n in
            engine.activeCount = n
        }
    }

    // MARK: - Drawing

    private func drawGrid(context: inout GraphicsContext, size: CGSize) {
        let gridColor = stateColor.opacity(0.06)
        let midY = size.height / 2

        var baseline = Path()
        baseline.move(to: CGPoint(x: 0, y: midY))
        baseline.addLine(to: CGPoint(x: size.width, y: midY))
        context.stroke(baseline, with: .color(stateColor.opacity(0.15)), lineWidth: 0.5)

        for frac in [0.25, 0.75] as [CGFloat] {
            var line = Path()
            let y = size.height * frac
            line.move(to: CGPoint(x: 0, y: y))
            line.addLine(to: CGPoint(x: size.width, y: y))
            context.stroke(line, with: .color(gridColor), lineWidth: 0.3)
        }

        var x: CGFloat = 40
        while x < size.width {
            var line = Path()
            line.move(to: CGPoint(x: x, y: 0))
            line.addLine(to: CGPoint(x: x, y: size.height))
            context.stroke(line, with: .color(gridColor), lineWidth: 0.3)
            x += 40
        }
    }

    private func drawWaveform(context: inout GraphicsContext, size: CGSize) {
        let midY = size.height / 2
        let amplitude = size.height * 0.42
        let bufLen = WaveformEngine.bufferSize
        let dx = size.width / CGFloat(bufLen - 1)
        let buffer = engine.waveBuffer
        let head = engine.writeHead

        var path = Path()
        for i in 0..<bufLen {
            let bufIdx = (head + i) % bufLen
            let sample = buffer[bufIdx]
            let x = CGFloat(i) * dx
            let y = midY - sample * amplitude
            if i == 0 {
                path.move(to: CGPoint(x: x, y: y))
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
        }

        let color = stateColor

        // Pass 1: Wide glow
        var glowCtx = context
        glowCtx.addFilter(.blur(radius: 6))
        glowCtx.stroke(path, with: .color(color.opacity(0.3)), lineWidth: 3)

        // Pass 2: Medium glow
        var medCtx = context
        medCtx.addFilter(.blur(radius: 2))
        medCtx.stroke(path, with: .color(color.opacity(0.5)), lineWidth: 2)

        // Pass 3: Sharp trace
        context.stroke(path, with: .color(color.opacity(0.9)), lineWidth: 1.2)

        // Leading dot
        let lastIdx = (head + bufLen - 1) % bufLen
        let dotX = size.width
        let dotY = midY - buffer[lastIdx] * amplitude
        let dotRect = CGRect(x: dotX - 3, y: dotY - 3, width: 6, height: 6)
        context.fill(Path(ellipseIn: dotRect), with: .color(color))

        // Dot glow
        let glowRect = CGRect(x: dotX - 6, y: dotY - 6, width: 12, height: 12)
        var dotGlowCtx = context
        dotGlowCtx.addFilter(.blur(radius: 4))
        dotGlowCtx.fill(Path(ellipseIn: glowRect), with: .color(color.opacity(0.5)))
    }

    private var stateColor: Color {
        switch state {
        case .disconnected:   return Theme.tertiaryLabel
        case .idle:           return Theme.amber
        case .active:         return Theme.alive
        case .consolidating:  return Theme.purple
        case .deepSleep:      return Color(red: 0.40, green: 0.45, blue: 0.75)
        case .error:          return Theme.coral
        }
    }
}
