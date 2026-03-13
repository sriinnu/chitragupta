/// Network client for the Chitragupta daemon HTTP health server.
///
/// v3: Dual URLSession — quick (4s) for polling + long-poll (35s) for
/// `/telemetry/watch?fingerprint=&timeout=25000`. Tracks fingerprint
/// from active.fingerprint for efficient change detection.

import AppKit
import Foundation
import Combine

/// Observable client that polls the daemon's `/status` endpoint and publishes
/// the latest `AggregatedStatus` for SwiftUI views.
///
/// ## Dual URLSession Pattern
///
/// Two URLSession instances with different timeout configs:
/// - **quickSession** (4s timeout): Used for the regular 5-second polling cycle
///   and one-shot POST actions (shutdown, consolidate). Short timeout so a dead
///   daemon doesn't block the UI.
/// - **longPollSession** (35s timeout): Used exclusively for `/telemetry/watch`,
///   which holds the connection open until the daemon detects a topology change
///   or the 25s server-side timeout expires. The 35s client timeout gives 10s
///   of headroom above the server's 25s to avoid spurious client-side timeouts.
///
/// ## Fingerprint-based Change Detection
///
/// The daemon returns an opaque `fingerprint` hash in `active.fingerprint`
/// that changes whenever instance topology mutates (connect, disconnect,
/// state change). The long-poll sends the last-known fingerprint; the server
/// blocks until the fingerprint differs, then returns immediately. This gives
/// near-instant UI updates without hammering the daemon with rapid polls.
@MainActor
final class DaemonClient: ObservableObject {

    // MARK: - Published state

    @Published var status: AggregatedStatus?
    @Published var isConnected = false
    @Published var lastError: String?
    @Published var isStarting = false

    // MARK: - Configuration

    private let baseURL: URL
    /// Short-timeout session for regular `/status` polls and POST actions.
    private let quickSession: URLSession
    /// Long-timeout session for `/telemetry/watch` blocking requests.
    private let longPollSession: URLSession
    private var pollTimer: Timer?
    private let decoder = JSONDecoder()

    /// Current telemetry fingerprint for long-poll change detection.
    /// Updated from `active.fingerprint` on every successful status fetch
    /// and from the long-poll watch response. Empty string on first connect
    /// causes the initial long-poll to return immediately with the current
    /// fingerprint.
    private var currentFingerprint: String = ""

    /// Whether a long-poll request is currently in flight. Guards against
    /// launching duplicate long-poll loops.
    private var isLongPolling = false

    nonisolated static let defaultURL = URL(string: "http://127.0.0.1:3690")!
    private nonisolated static let pollInterval: TimeInterval = 5.0

    // MARK: - Init

    init(baseURL: URL = DaemonClient.defaultURL) {
        self.baseURL = baseURL

        // Quick session — 4s timeout for normal /status polling.
        let quickConfig = URLSessionConfiguration.default
        quickConfig.timeoutIntervalForRequest = 4
        quickConfig.timeoutIntervalForResource = 4
        self.quickSession = URLSession(configuration: quickConfig)

        // Long-poll session — 35s timeout for /telemetry/watch.
        // Server-side timeout is 25s; 35s gives 10s headroom.
        let longConfig = URLSessionConfiguration.default
        longConfig.timeoutIntervalForRequest = 35
        longConfig.timeoutIntervalForResource = 35
        self.longPollSession = URLSession(configuration: longConfig)

        startPolling()
    }

    deinit {
        pollTimer?.invalidate()
    }

    // MARK: - Polling

    /// Starts the 5-second repeating poll timer. Also fires an immediate
    /// fetch so the UI doesn't show "disconnected" for the first 5 seconds.
    private func startPolling() {
        Task { await fetchStatus() }
        pollTimer = Timer.scheduledTimer(
            withTimeInterval: Self.pollInterval,
            repeats: true
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.fetchStatus()
            }
        }
    }

    /// Fetch aggregated daemon status. Only publishes when values actually
    /// change (Equatable check) to avoid unnecessary SwiftUI view invalidation.
    func fetchStatus() async {
        let url = baseURL.appendingPathComponent("status")
        do {
            let (data, response) = try await quickSession.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                if isConnected { isConnected = false }
                return
            }
            let decoded = try decoder.decode(AggregatedStatus.self, from: data)
            if status != decoded { status = decoded }
            let alive = decoded.daemon.alive
            if isConnected != alive { isConnected = alive }
            if lastError != nil { lastError = nil }

            // Track fingerprint for long-poll change detection.
            if let fp = decoded.active?.fingerprint, fp != currentFingerprint {
                currentFingerprint = fp
            }

            // Start long-poll loop if daemon is alive and no loop is running.
            if alive && !isLongPolling {
                startLongPollLoop()
            }
        } catch {
            if isConnected { isConnected = false }
            if status != nil { status = nil }
            // Reset long-poll flag so it restarts on reconnect.
            isLongPolling = false
            let msg = error.localizedDescription
            if lastError != msg { lastError = msg }
        }
    }

    // MARK: - Long-poll loop

    /// Continuously long-polls `/telemetry/watch` to get near-instant
    /// notification when the instance topology changes.
    ///
    /// The loop sends the current fingerprint; the server blocks until
    /// either the fingerprint changes or the 25s server timeout expires.
    /// On return, we update our fingerprint and trigger a full `/status`
    /// refresh. On error (daemon died, network issue), we back off 2s
    /// then retry. The loop exits when `isConnected` goes false.
    private func startLongPollLoop() {
        guard !isLongPolling else { return }
        isLongPolling = true

        Task { [weak self] in
            while let self, self.isConnected {
                do {
                    var components = URLComponents(
                        url: self.baseURL.appendingPathComponent("telemetry/watch"),
                        resolvingAgainstBaseURL: false
                    )!
                    components.queryItems = [
                        URLQueryItem(name: "fingerprint", value: self.currentFingerprint),
                        URLQueryItem(name: "timeout", value: "25000"),
                    ]

                    let (data, response) = try await self.longPollSession.data(from: components.url!)
                    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                        continue
                    }

                    // Extract the new fingerprint from the watch response.
                    // Uses JSONSerialization instead of Codable because the
                    // watch response shape is minimal (just {fingerprint, changed}).
                    if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let fp = json["fingerprint"] as? String {
                        await MainActor.run {
                            self.currentFingerprint = fp
                        }
                    }

                    // Trigger a full status refresh to pick up all changes.
                    await self.fetchStatus()
                } catch {
                    // Back off 2s on error to avoid tight retry loops
                    // when the daemon is down or the network is flaky.
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                }
            }

            await MainActor.run { [weak self] in
                self?.isLongPolling = false
            }
        }
    }

    // MARK: - Actions

    /// Spawn the daemon as a detached background process.
    ///
    /// Launches a zsh shell that sources nvm/homebrew (since GUI apps inherit
    /// a bare PATH without shell profile), then tries the local dev build
    /// first (`packages/daemon/dist/process.js`) before falling back to the
    /// globally-installed `chitragupta` CLI.
    func startDaemon() {
        guard !isStarting else { return }
        isStarting = true
        lastError = nil

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let script = """
            # Load nvm/homebrew into PATH (GUI apps have bare PATH)
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
            eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)"

            REPO="$HOME/Sriinnu/Personal/AUriva/chitragupta"
            if [ -f "$REPO/packages/daemon/dist/process.js" ]; then
                cd "$REPO"
                exec node --input-type=module -e \
                  "import{spawnDaemon}from'./packages/daemon/dist/process.js';await spawnDaemon()"
            fi
            exec chitragupta daemon start
            """

            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/bin/zsh")
            task.arguments = ["-c", script]
            task.standardOutput = FileHandle.nullDevice
            task.standardError = FileHandle.nullDevice

            do {
                try task.run()
                task.waitUntilExit()

                DispatchQueue.main.async {
                    guard let self else { return }
                    self.isStarting = false
                    if task.terminationStatus != 0 {
                        self.lastError = "Could not start daemon (exit \(task.terminationStatus))"
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self?.isStarting = false
                    self?.lastError = "Launch failed: \(error.localizedDescription)"
                }
            }
        }
    }

    /// Stop the daemon process via graceful shutdown (POST /shutdown).
    func stopDaemon() async {
        await postAction(path: "shutdown")
    }

    /// Wake Nidra to trigger consolidation (POST /consolidate).
    func consolidate() async {
        await postAction(path: "consolidate")
    }

    /// Open the Hub dashboard in the default browser.
    func openHub() {
        let hubURL = URL(string: "http://127.0.0.1:3141/hub")!
        NSWorkspace.shared.open(hubURL)
    }

    // MARK: - Helpers

    /// Generic POST action helper. Waits 500ms after the request, then
    /// refreshes status to reflect the daemon's new state.
    private func postAction(path: String) async {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            let (_, response) = try await quickSession.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                lastError = "HTTP \(http.statusCode) on \(path)"
            }
            // Brief delay so the daemon has time to process the action
            // before we re-fetch status.
            try? await Task.sleep(nanoseconds: 500_000_000)
            await fetchStatus()
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - Static formatters

    /// Format a PID for display, returning "--" if nil.
    static func formatPid(_ pid: Int?) -> String {
        guard let p = pid else { return "--" }
        return "\(p)"
    }

    /// Format byte count as "XMB" or "X.XGB".
    static func formatBytes(_ bytes: Int) -> String {
        let mb = Double(bytes) / (1024 * 1024)
        if mb >= 1024 {
            return String(format: "%.1fGB", mb / 1024)
        }
        return String(format: "%.0fMB", mb)
    }

    /// Format seconds as "Xd Yh", "Xh Ym", or "Xm".
    static func formatUptime(_ seconds: Int) -> String {
        let days = seconds / 86400
        let hours = (seconds % 86400) / 3600
        let mins = (seconds % 3600) / 60
        if days > 0 { return "\(days)d \(hours)h" }
        if hours > 0 { return "\(hours)h \(mins)m" }
        return "\(mins)m"
    }

    /// Format an epoch-ms timestamp as a relative time string
    /// ("just now", "5 minutes ago", "2 hours ago", "3 days ago").
    static func formatRelativeTime(_ epochMs: Int?) -> String {
        guard let ms = epochMs else { return "never" }
        let date = Date(timeIntervalSince1970: Double(ms) / 1000)
        let elapsed = Date().timeIntervalSince(date)
        if elapsed < 60 { return "just now" }
        if elapsed < 3600 { return "\(Int(elapsed / 60)) minutes ago" }
        if elapsed < 86400 { return "\(Int(elapsed / 3600)) hours ago" }
        return "\(Int(elapsed / 86400)) days ago"
    }
}
