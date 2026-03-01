/// AppDelegate — owns the NSStatusItem and NSPopover lifecycle.
///
/// Creates a sacred-flame status bar icon (animated when connected),
/// toggles a transient popover on click. Uses pre-rendered frame
/// strips to avoid per-tick bezier path rendering.

import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private let client = DaemonClient()
    private var animationTimer: Timer?
    private var frameIndex = 0

    /// Pre-rendered frame strips keyed by health color hash.
    /// Avoids creating NSImage + filling bezier paths every tick.
    private var frameCache: [Int: [NSImage]] = [:]
    private var lastHealthHash = 0
    private static let frameCount = 8

    // MARK: - NSApplicationDelegate

    nonisolated func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            setupUI()
        }
    }

    /// Keep the app alive when the popover (last window) closes.
    nonisolated func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    private func setupUI() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        if let button = statusItem.button {
            button.image = HeartbeatIcon.render(phase: 0, health: .gray)
            button.action = #selector(togglePopover)
            button.target = self
        }

        let contentView = MenubarView(client: client)
        popover = NSPopover()
        popover.contentSize = NSSize(width: 340, height: 480)
        popover.behavior = .transient
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

    // MARK: - Icon animation (pre-rendered frames)

    private func startAnimation() {
        // 1s interval — gentle flame breathing, near-zero CPU.
        animationTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.tickAnimation()
            }
        }
    }

    private func tickAnimation() {
        let health = currentHealth()
        let healthHash = health.hash

        // Pre-render frame strip on first use or health change.
        if frameCache[healthHash] == nil {
            var frames: [NSImage] = []
            let step = (2.0 * .pi) / CGFloat(Self.frameCount)
            for i in 0..<Self.frameCount {
                frames.append(HeartbeatIcon.render(phase: CGFloat(i) * step, health: health))
            }
            frameCache[healthHash] = frames
        }

        // Evict stale cache entries (keep max 3 health colors).
        if frameCache.count > 3 {
            for key in frameCache.keys where key != healthHash {
                frameCache.removeValue(forKey: key)
                break
            }
        }

        // Reduced motion: static icon, only update on health change.
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            if healthHash != lastHealthHash {
                lastHealthHash = healthHash
                statusItem.button?.image = frameCache[healthHash]?[0]
            }
            return
        }

        lastHealthHash = healthHash
        let frames = frameCache[healthHash]!
        frameIndex = (frameIndex + 1) % frames.count
        statusItem.button?.image = frames[frameIndex]
    }

    private func isConsolidating() -> Bool {
        guard let state = client.status?.nidra?.state?.lowercased() else { return false }
        return state == "consolidating" || state == "dreaming"
    }

    private func currentHealth() -> NSColor {
        guard client.isConnected else { return .gray }
        if isConsolidating() {
            return NSColor(red: 0.65, green: 0.45, blue: 0.95, alpha: 1.0)
        }
        let db = client.status?.db
        if let turns = db?.turns, turns == 0 { return .systemOrange }
        return NSColor(red: 0.96, green: 0.72, blue: 0.26, alpha: 1.0)
    }
}
