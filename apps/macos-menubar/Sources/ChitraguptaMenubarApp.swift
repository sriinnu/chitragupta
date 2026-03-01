/// Chitragupta macOS menubar app entry point.
///
/// Runs as an accessory app (LSUIElement=true) with no Dock icon.
/// All UI lives in the NSStatusItem popover managed by AppDelegate.

import SwiftUI

@main
struct ChitraguptaMenubarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}
