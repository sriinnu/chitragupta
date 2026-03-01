/// Network client for the Chitragupta daemon HTTP API.
///
/// Polls `GET /api/daemon/status` every 5 seconds.
/// Provides start/stop/consolidate actions via POST endpoints.
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

    // MARK: - Configuration

    private let baseURL: URL
    private let session: URLSession
    private var pollTimer: Timer?
    private let decoder = JSONDecoder()

    nonisolated static let defaultURL = URL(string: "http://127.0.0.1:3141")!
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

    /// Fetch aggregated daemon status.
    func fetchStatus() async {
        let url = baseURL.appendingPathComponent("api/daemon/status")
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                isConnected = false
                return
            }
            let decoded = try decoder.decode(DaemonStatusResponse.self, from: data)
            status = decoded.data
            isConnected = decoded.data?.daemon.alive ?? false
            lastError = nil
        } catch {
            isConnected = false
            status = nil
            lastError = error.localizedDescription
        }
    }

    // MARK: - Actions

    /// Start the daemon process.
    func startDaemon() async {
        await postAction(path: "api/daemon/start")
    }

    /// Stop the daemon process.
    func stopDaemon() async {
        await postAction(path: "api/daemon/stop")
    }

    /// Wake Nidra to trigger consolidation.
    func consolidate() async {
        await postAction(path: "api/nidra/wake")
    }

    /// Open the Hub dashboard in the default browser.
    func openHub() {
        let hubURL = baseURL.appendingPathComponent("hub")
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
