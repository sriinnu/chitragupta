/// Network client for the Chitragupta daemon HTTP health server.
///
/// Talks directly to the daemon process on port 7788 (loopback).
/// Does NOT depend on the CLI server (port 3141).
/// Polls `GET /status` every 5 seconds.
/// Published properties drive SwiftUI reactivity.

import AppKit
import Foundation
import Combine

@MainActor
final class DaemonClient: ObservableObject {

    // MARK: - Published state

    @Published var status: AggregatedStatus?
    @Published var isConnected = false
    @Published var lastError: String?
    @Published var isStarting = false

    // MARK: - Configuration

    private let baseURL: URL
    private let session: URLSession
    private var pollTimer: Timer?
    private let decoder = JSONDecoder()

    nonisolated static let defaultURL = URL(string: "http://127.0.0.1:3690")!
    private nonisolated static let pollInterval: TimeInterval = 5.0

    // MARK: - Init

    init(baseURL: URL = DaemonClient.defaultURL) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 4
        config.timeoutIntervalForResource = 4
        self.session = URLSession(configuration: config)
        startPolling()
    }

    deinit {
        pollTimer?.invalidate()
    }

    // MARK: - Polling

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

    /// Fetch aggregated daemon status. Only publishes when values change.
    func fetchStatus() async {
        let url = baseURL.appendingPathComponent("status")
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                if isConnected { isConnected = false }
                return
            }
            let decoded = try decoder.decode(AggregatedStatus.self, from: data)
            // Only publish when display-relevant fields changed — avoids
            // full SwiftUI view tree re-render on every poll cycle.
            if status != decoded { status = decoded }
            let alive = decoded.daemon.alive
            if isConnected != alive { isConnected = alive }
            if lastError != nil { lastError = nil }
        } catch {
            if isConnected { isConnected = false }
            if status != nil { status = nil }
            let msg = error.localizedDescription
            if lastError != msg { lastError = msg }
        }
    }

    // MARK: - Actions

    /// Spawn the daemon as a detached background process.
    ///
    /// GUI apps don't inherit terminal PATH. We source nvm/homebrew
    /// directly (no interactive shell — `-i` causes pipe deadlocks
    /// from macOS session save/restore messages).
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

    /// Stop the daemon process via graceful shutdown.
    func stopDaemon() async {
        await postAction(path: "shutdown")
    }

    /// Wake Nidra to trigger consolidation.
    func consolidate() async {
        await postAction(path: "consolidate")
    }

    /// Open the Hub dashboard in the default browser (CLI server).
    func openHub() {
        let hubURL = URL(string: "http://127.0.0.1:3141/hub")!
        NSWorkspace.shared.open(hubURL)
    }

    // MARK: - Helpers

    private func postAction(path: String) async {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            let (_, response) = try await session.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                lastError = "HTTP \(http.statusCode) on \(path)"
            }
            // Refresh status after action
            try? await Task.sleep(nanoseconds: 500_000_000)
            await fetchStatus()
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Format PID for display.
    static func formatPid(_ pid: Int?) -> String {
        guard let p = pid else { return "—" }
        return "\(p)"
    }

    /// Format bytes into human-readable string.
    static func formatBytes(_ bytes: Int) -> String {
        let mb = Double(bytes) / (1024 * 1024)
        if mb >= 1024 {
            return String(format: "%.1fGB", mb / 1024)
        }
        return String(format: "%.0fMB", mb)
    }

    /// Format seconds into human-readable uptime.
    static func formatUptime(_ seconds: Int) -> String {
        let days = seconds / 86400
        let hours = (seconds % 86400) / 3600
        let mins = (seconds % 3600) / 60
        if days > 0 { return "\(days)d \(hours)h" }
        if hours > 0 { return "\(hours)h \(mins)m" }
        return "\(mins)m"
    }

    /// Format epoch ms to relative time string.
    static func formatRelativeTime(_ epochMs: Int?) -> String {
        guard let ms = epochMs else { return "Never" }
        let date = Date(timeIntervalSince1970: Double(ms) / 1000)
        let elapsed = Date().timeIntervalSince(date)
        if elapsed < 60 { return "Just now" }
        if elapsed < 3600 { return "\(Int(elapsed / 60))m ago" }
        if elapsed < 86400 { return "\(Int(elapsed / 3600))h ago" }
        return "\(Int(elapsed / 86400))d ago"
    }
}
