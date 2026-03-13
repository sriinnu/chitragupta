/// Chitragupta macOS menubar app entry point.
///
/// Runs as an accessory app (LSUIElement=true in Info.plist) with no Dock
/// icon and no main window. All UI lives in the NSStatusItem popover
/// managed by `AppDelegate`. The empty `Settings` scene satisfies SwiftUI's
/// requirement for at least one scene declaration.

import SwiftUI

@main
struct ChitraguptaMenubarApp: App {
    /// Bridges to `AppDelegate` for NSStatusItem and NSPopover management.
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        // Empty settings scene — required by SwiftUI App protocol but
        // unused since all UI is in the status bar popover.
        Settings { EmptyView() }
    }
}
