/// AppDelegate — owns the NSStatusItem and NSPopover lifecycle.
///
/// v3: Dynamic popover sizing (content-determined, max 650), width 380.
/// No forced dark mode — respects system appearance.

import AppKit
import SwiftUI

/// Manages the menubar status item (icon + popover) and drives the
/// torii gate animation loop.
///
/// ## Frame Cache
///
/// Rather than re-rendering the torii gate on every animation tick,
/// `frameCache` stores pre-rendered strips of 8 frames keyed by health
/// color hash. On each tick we just index into the strip. When the health
/// color changes (e.g. daemon connects/disconnects), a new strip is
/// rendered and cached. The cache is capped at 3 entries; stale colors
/// are evicted LRU-ish (first non-current key found) to bound memory.
///
/// ## Animation Tick
///
/// A 1-second `Timer` calls `tickAnimation()` which:
/// 1. Determines the current health color from daemon state.
/// 2. Lazily renders or retrieves the frame strip for that color.
/// 3. Advances `frameIndex` and sets `statusItem.button.image`.
/// 4. If "Reduce Motion" is on, only updates the icon when the health
///    color changes (no frame cycling).
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private let client = DaemonClient()
    private var animationTimer: Timer?
    /// Current position in the frame strip (0..<frameCount).
    private var frameIndex = 0

    /// Pre-rendered frame strips keyed by `NSColor.hash`.
    /// Each strip contains `frameCount` images covering one full 2π cycle.
    private var frameCache: [Int: [NSImage]] = [:]
    /// Hash of the last-rendered health color, used to detect changes.
    private var lastHealthHash = 0
    /// Number of frames per animation cycle (evenly divides 2π).
    private static let frameCount = 8

    // MARK: - NSApplicationDelegate

    nonisolated func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            setupUI()
        }
    }

    /// Return false so the app stays alive when the popover closes —
    /// menubar apps have no "last window".
    nonisolated func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    private func setupUI() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        if let button = statusItem.button {
            // Initial static frame (gray = disconnected).
            button.image = HeartbeatIcon.render(phase: 0, health: .gray)
            button.action = #selector(togglePopover)
            button.target = self
        }

        let contentView = MenubarView(client: client)
        popover = NSPopover()
        popover.contentSize = NSSize(width: 380, height: 520)
        popover.behavior = .transient   // auto-dismiss on click-away
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
            // Make the popover key so it can receive keyboard events.
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    // MARK: - Icon animation

    /// Starts the 1-second animation timer that cycles the torii icon.
    private func startAnimation() {
        animationTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.tickAnimation()
            }
        }
    }

    /// Advance the icon animation by one frame.
    ///
    /// The logic:
    /// 1. Determine the current health color (amber/gray/purple/orange).
    /// 2. If no cached frame strip exists for this color, pre-render all
    ///    8 frames (one full 2π cycle) and cache them.
    /// 3. Evict old cache entries if we have more than 3 colors cached.
    /// 4. If "Reduce Motion" is enabled, freeze on frame 0 and only
    ///    update when the color changes.
    /// 5. Otherwise, advance `frameIndex` and set the button image.
    private func tickAnimation() {
        let health = currentHealth()
        let healthHash = health.hash

        // Lazily render the frame strip for this health color.
        if frameCache[healthHash] == nil {
            var frames: [NSImage] = []
            let step = (2.0 * .pi) / CGFloat(Self.frameCount)
            for i in 0..<Self.frameCount {
                frames.append(HeartbeatIcon.render(phase: CGFloat(i) * step, health: health))
            }
            frameCache[healthHash] = frames
        }

        // Evict stale cache entries — keep at most 3 health colors.
        // Simple eviction: remove the first non-current key.
        if frameCache.count > 3 {
            for key in frameCache.keys where key != healthHash {
                frameCache.removeValue(forKey: key)
                break
            }
        }

        // Accessibility: "Reduce Motion" preference freezes animation.
        // Only update the icon when the health color itself changes.
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

    /// Whether Nidra is currently running a consolidation pass.
    private func isConsolidating() -> Bool {
        guard let state = client.status?.nidra?.state?.lowercased() else { return false }
        return state == "consolidating" || state == "dreaming"
    }

    /// Map daemon state to an `NSColor` for the torii icon.
    ///
    /// Priority order:
    /// 1. **Gray** — daemon not connected.
    /// 2. **Purple** — Nidra is consolidating (learning/compacting).
    /// 3. **Orange** — connected but knowledge base is empty (0 turns).
    /// 4. **Amber** — healthy, normal operation.
    private func currentHealth() -> NSColor {
        guard client.isConnected else { return .gray }
        if isConsolidating() {
            return NSColor(red: 0.65, green: 0.45, blue: 0.95, alpha: 1.0)
        }
        let db = client.status?.db
        if let turns = db?.turns, turns == 0 { return .systemOrange }
        return NSColor(red: 0.96, green: 0.72, blue: 0.10, alpha: 1.0)  // Theme.amber
    }
}
