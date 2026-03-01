/// AppDelegate — owns the NSStatusItem and NSPopover lifecycle.
///
/// Creates a sacred-flame status bar icon (animated when connected),
/// toggles a transient popover on click, and manages the animation timer.

import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private let client = DaemonClient()
    private var animationTimer: Timer?
    private var animationPhase: CGFloat = 0

    // MARK: - NSApplicationDelegate

    nonisolated func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            setupUI()
        }
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
        popover.contentSize = NSSize(width: 380, height: 560)
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

    // MARK: - Icon animation

    private func startAnimation() {
        animationTimer = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
                if reduceMotion {
                    self.statusItem.button?.image = HeartbeatIcon.render(phase: 0, health: self.currentHealth())
                    return
                }
                self.animationPhase += 0.35
                self.statusItem.button?.image = HeartbeatIcon.render(
                    phase: self.animationPhase,
                    health: self.currentHealth()
                )
            }
        }
    }

    private func currentHealth() -> NSColor {
        guard client.isConnected else { return .gray }
        let db = client.status?.db
        if let turns = db?.turns, turns == 0 { return .systemYellow }
        return .systemGreen
    }
}
