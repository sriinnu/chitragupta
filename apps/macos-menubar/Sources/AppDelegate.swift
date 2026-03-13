/// AppDelegate — owns the NSStatusItem and NSPopover lifecycle.
///
/// v3: Dynamic popover sizing (content-determined, max 650), width 380.
/// No forced dark mode — respects system appearance.
///
/// ## State-Driven Animation
///
/// The torii gate icon animates differently per daemon state:
/// - **Disconnected**: static gray gate, no timer running.
/// - **Idle**: 1.2s tick, gentle amber sway.
/// - **Active/Busy**: 0.4s tick, lively green motion.
/// - **Consolidating**: 1.5s tick, slow purple float.
/// - **Deep Sleep**: 2.5s tick, barely-there indigo breathing.
/// - **Error**: 0.3s tick, rapid red jitter.
///
/// Timer interval changes dynamically when the state transitions.

import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private let client = DaemonClient()
    private var animationTimer: Timer?
    private var frameIndex = 0

    /// Pre-rendered frame strips keyed by DaemonState raw discriminant.
    private var frameCache: [String: [NSImage]] = [:]
    private var lastStateKey = ""
    private static let frameCount = 12

    /// Current daemon state — drives animation character.
    private var currentState: DaemonState = .disconnected

    // MARK: - NSApplicationDelegate

    nonisolated func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            setupUI()
        }
    }

    nonisolated func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    private func setupUI() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        if let button = statusItem.button {
            button.image = HeartbeatIcon.render(phase: 0, state: .disconnected)
            button.action = #selector(togglePopover)
            button.target = self
        }

        let contentView = MenubarView(client: client)
        popover = NSPopover()
        popover.contentSize = NSSize(width: 380, height: 520)
        popover.behavior = .transient
        popover.animates = true
        popover.contentViewController = NSHostingController(rootView: contentView)

        startAnimation()
    }

    // MARK: - Popover toggle

    @objc private func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    // MARK: - Icon animation

    /// Timer interval per state — faster for active, slower for sleeping.
    private func timerInterval(for state: DaemonState) -> TimeInterval {
        switch state {
        case .disconnected:   return 0    // no timer needed
        case .idle:           return 1.2
        case .active:         return 0.4
        case .consolidating:  return 1.5
        case .deepSleep:      return 2.5
        case .error:          return 0.3
        }
    }

    private func startAnimation() {
        scheduleTimer(for: currentState)
    }

    /// (Re)schedule the animation timer for the given state.
    /// Invalidates any existing timer first.
    private func scheduleTimer(for state: DaemonState) {
        animationTimer?.invalidate()
        animationTimer = nil

        let interval = timerInterval(for: state)
        guard interval > 0 else {
            // Static state (disconnected) — just set one frame.
            statusItem.button?.image = HeartbeatIcon.render(phase: 0, state: state)
            return
        }

        animationTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.tickAnimation()
            }
        }
        // Fire immediately so the icon updates without waiting for the first interval.
        animationTimer?.fire()
    }

    private func tickAnimation() {
        let newState = resolveDaemonState()
        let stateKey = "\(newState)"

        // State changed — reschedule timer at new cadence, reset frame index.
        if stateKey != lastStateKey {
            currentState = newState
            frameIndex = 0
            frameCache.removeAll()     // clear all — new state means new color
            lastStateKey = stateKey
            scheduleTimer(for: newState)
            return
        }

        // Build frame strip if not cached.
        if frameCache[stateKey] == nil {
            var frames: [NSImage] = []
            let step = (2.0 * .pi) / CGFloat(Self.frameCount)
            for i in 0..<Self.frameCount {
                frames.append(HeartbeatIcon.render(phase: CGFloat(i) * step, state: newState))
            }
            frameCache[stateKey] = frames
        }

        // Reduced motion: static icon, only update on state change.
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            statusItem.button?.image = frameCache[stateKey]?[0]
            return
        }

        let frames = frameCache[stateKey]!
        frameIndex = (frameIndex + 1) % frames.count
        statusItem.button?.image = frames[frameIndex]
    }

    // MARK: - State resolution

    /// Map the full daemon status into a `DaemonState` for icon rendering.
    ///
    /// Priority:
    /// 1. Not connected → `.disconnected`
    /// 2. Nidra consolidating/dreaming → `.consolidating`
    /// 3. Nidra deep_sleep/sleeping → `.deepSleep`
    /// 4. Any instance active/busy/thinking → `.active`
    /// 5. Error state on nidra → `.error`
    /// 6. Connected with empty DB → `.idle` (orange tint handled in idle)
    /// 7. Default → `.idle`
    private func resolveDaemonState() -> DaemonState {
        guard client.isConnected else { return .disconnected }

        // Nidra state takes priority for consolidation/sleep.
        if let nidraState = client.status?.nidra?.state?.lowercased() {
            switch nidraState {
            case "consolidating", "dreaming":
                return .consolidating
            case "deep_sleep", "sleeping", "sushupta":
                return .deepSleep
            case "error":
                return .error
            default:
                break
            }
        }

        // Check if any instance is actively working.
        if let instances = client.status?.active?.instances {
            let hasActive = instances.contains { inst in
                let s = inst.state?.lowercased() ?? ""
                return s == "active" || s == "busy" || s == "thinking"
            }
            if hasActive { return .active }
        }

        return .idle
    }
}
