/// Data models matching the daemon HTTP `/status` JSON response.
///
/// v3: Extended with fingerprint, cleanup, attention summary, users,
/// byWorkspace, byProvider on ActiveInfo; full NidraInfo fields;
/// MemoryValue union; contextPressure + providerSessionId + parentThreadId
/// on InstanceInfo; version on DaemonInfo.

import Foundation

// MARK: - Top-level response

/// Aggregated response from `GET /status` on the daemon HTTP server (port 3690).
///
/// This is the single JSON payload the menubar app polls. Every section
/// (`daemon`, `runtime`, `nidra`, `db`, `active`) is optional except `daemon`
/// because the daemon always reports its own liveness. `timestamp` is the
/// server-side epoch-ms when the response was assembled.
struct AggregatedStatus: Codable, Equatable {
    let daemon: DaemonInfo
    let runtime: RuntimeInfo?
    let nidra: NidraInfo?
    let db: DbCounts?
    let active: ActiveInfo?
    let timestamp: Int

    /// Custom equality excludes `timestamp` to avoid unnecessary view redraws
    /// when polled data is semantically identical.
    static func == (lhs: AggregatedStatus, rhs: AggregatedStatus) -> Bool {
        lhs.daemon == rhs.daemon && lhs.nidra == rhs.nidra
            && lhs.db == rhs.db && lhs.active == rhs.active
            && lhs.runtime == rhs.runtime
    }
}

// MARK: - Daemon

/// Core daemon process info: liveness, PID, uptime, and memory consumption.
struct DaemonInfo: Codable, Equatable {
    let alive: Bool
    let pid: Int?
    let uptime: Int?
    let memory: MemoryValue?
    let connections: Int?
    let methods: Int?
    let version: String?

    enum CodingKeys: String, CodingKey {
        case alive, pid, uptime, memory, connections, methods, version
    }
}

/// Memory usage from the daemon, which may arrive as either a bare integer
/// (legacy format, just RSS bytes) or a detailed object with heap breakdown.
///
/// The decoder tries `Int` first (fast path), then falls back to the
/// `MemoryDetail` struct. If neither matches, defaults to `.int(0)` to
/// avoid a decode failure that would null out the entire `DaemonInfo`.
enum MemoryValue: Codable, Equatable {
    /// Legacy format: a single byte count (typically RSS).
    case int(Int)
    /// Detailed format with V8 heap breakdown.
    case detailed(MemoryDetail)

    /// Breakdown of Node.js process memory (mirrors `process.memoryUsage()`).
    struct MemoryDetail: Codable, Equatable {
        let rss: Int?
        let heapUsed: Int?
        let heapTotal: Int?
        let external: Int?
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        // Try bare int first (most common in older daemons).
        if let intVal = try? container.decode(Int.self) {
            self = .int(intVal)
        } else if let detail = try? container.decode(MemoryDetail.self) {
            self = .detailed(detail)
        } else {
            // Graceful fallback — never let a memory field crash the decode.
            self = .int(0)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .int(let v): try container.encode(v)
        case .detailed(let d): try container.encode(d)
        }
    }

    /// Primary byte value for display — prefers RSS (total resident), falls
    /// back to heapUsed, then zero.
    var bytes: Int {
        switch self {
        case .int(let v): return v
        case .detailed(let d): return d.rss ?? d.heapUsed ?? 0
        }
    }
}

// MARK: - Runtime (MCP server connections)

/// Raw MCP transport layer info — how many stdio/SSE connections the daemon holds.
struct RuntimeInfo: Codable, Equatable {
    let connected: Int?
    let tracked: Int?
    let items: [RuntimeItem]?
}

/// A single MCP server transport connection (stdio pipe or SSE stream).
struct RuntimeItem: Codable, Equatable, Identifiable {
    let id: String
    let transport: String?
    let connectedAt: Int?
    let lastSeenAt: Int?
    let requestCount: Int?
    let notificationCount: Int?

    /// Elapsed seconds since the daemon last saw traffic on this connection.
    /// Uses epoch-ms from `lastSeenAt` compared to wall clock.
    var secondsSinceLastSeen: TimeInterval? {
        guard let ts = lastSeenAt else { return nil }
        return Date().timeIntervalSince1970 - Double(ts) / 1000
    }

    /// Whether this connection is actively communicating (seen within 60s).
    var isRecentlyActive: Bool {
        guard let elapsed = secondsSinceLastSeen else { return false }
        return elapsed < 60
    }
}

// MARK: - Nidra (Consolidation)

/// Nidra is the daemon's "sleep" subsystem that runs background consolidation
/// (memory compaction, graph refresh, embedding re-indexing).
struct NidraInfo: Codable, Equatable {
    let state: String?                   // e.g. "idle", "consolidating", "dreaming"
    let running: Bool?
    let consolidationProgress: Double?   // 0.0–1.0 during active consolidation
    let lastConsolidationEnd: Int?       // epoch-ms
    let lastConsolidationStart: Int?     // epoch-ms
    let activity: String?                // human-readable current activity
    let consolidationPhase: String?      // sub-phase label
    let lastStateChange: Int?            // epoch-ms
    let lastHeartbeat: Int?              // epoch-ms
    let uptimeMs: Int?
    let consolidatedDatesCount: Int?     // how many calendar days have been consolidated
    let lastBackfillDate: String?        // ISO date of last backfill pass
    let lastConsolidationDate: String?   // ISO date of last regular consolidation

    /// Nidra uptime formatted as "Xd Yh", "Xh Ym", or "Xm".
    var uptimeString: String? {
        guard let ms = uptimeMs, ms > 0 else { return nil }
        let secs = ms / 1000
        let days = secs / 86400
        let hours = (secs % 86400) / 3600
        let mins = (secs % 3600) / 60
        if days > 0 { return "\(days)d \(hours)h" }
        if hours > 0 { return "\(hours)h \(mins)m" }
        return "\(mins)m"
    }
}

// MARK: - Database counts

/// Row counts across the core Chitragupta knowledge stores.
/// Used to populate the stacked segment bar in KnowledgeSection.
struct DbCounts: Codable, Equatable {
    let turns: Int          // conversation turns (Vārta)
    let sessions: Int       // session records (Satra)
    let rules: Int          // learned rules (Niyama)
    let vidhis: Int         // procedures (Vidhi)
    let samskaras: Int      // impressions (Saṁskāra)
    let vasanas: Int        // behavioral tendencies (Vāsanā)
    let akashaTraces: Int   // shared/broadcast traces (Ākāśa)

    /// Sum of all knowledge records.
    var total: Int {
        turns + sessions + rules + vidhis + samskaras + vasanas + akashaTraces
    }

    /// Label-count pairs for the segment bar, ordered to match
    /// `Theme.segmentColors` by index. Sanskrit transliterations in parens
    /// give context to the Indic naming convention.
    var segments: [(label: String, count: Int)] {
        [
            ("Conversations (Vārta)", turns),
            ("Sessions (Satra)", sessions),
            ("Rules (Niyama)", rules),
            ("Procedures (Vidhi)", vidhis),
            ("Impressions (Saṁskāra)", samskaras),
            ("Tendencies (Vāsanā)", vasanas),
            ("Shared (Ākāśa)", akashaTraces),
        ]
    }

    var hasContent: Bool { total > 0 }

    /// Manual Equatable — needed because `segments` is a computed property
    /// returning tuples (which don't auto-conform to Equatable), so the
    /// compiler can't synthesize `==` for the whole struct.
    static func == (lhs: DbCounts, rhs: DbCounts) -> Bool {
        lhs.turns == rhs.turns && lhs.sessions == rhs.sessions
            && lhs.rules == rhs.rules && lhs.vidhis == rhs.vidhis
            && lhs.samskaras == rhs.samskaras && lhs.vasanas == rhs.vasanas
            && lhs.akashaTraces == rhs.akashaTraces
    }
}

// MARK: - Active telemetry

/// A single attention flag raised by the daemon for a connected instance.
/// Attention means the instance may need human intervention (e.g. stuck tool
/// call, high context pressure, stale session).
struct AttentionItem: Codable, Equatable {
    let pid: Int?
    let workspace: String?
    let provider: String?
    let reasons: [String]?
}

/// Aggregate telemetry about currently active MCP client instances.
struct ActiveInfo: Codable, Equatable {
    let instanceCount: Int?
    let openSessionCount: Int?
    let activeConversationCount: Int?
    let activeNowCount: Int?
    let attentionCount: Int?
    /// Opaque hash that changes whenever instance topology changes.
    /// Used by `DaemonClient` for long-poll change detection.
    let fingerprint: String?
    let cleanup: CleanupInfo?
    let attention: [AttentionItem]?
    let users: [String]?
    let byWorkspace: [String: Int]?
    let byProvider: [String: Int]?
    let instances: [InstanceInfo]?

    /// Equality check focuses on fields that affect the UI, intentionally
    /// skipping `cleanup`, `attention`, `users`, `byWorkspace`, `byProvider`
    /// to reduce unnecessary redraws.
    static func == (lhs: ActiveInfo, rhs: ActiveInfo) -> Bool {
        lhs.instanceCount == rhs.instanceCount
            && lhs.openSessionCount == rhs.openSessionCount
            && lhs.activeNowCount == rhs.activeNowCount
            && lhs.attentionCount == rhs.attentionCount
            && lhs.fingerprint == rhs.fingerprint
            && lhs.instances == rhs.instances
    }
}

/// Counts of stale/corrupt/orphan connections removed during the last
/// daemon housekeeping cycle.
struct CleanupInfo: Codable, Equatable {
    let removedStale: Int?
    let removedCorrupt: Int?
    let removedOrphan: Int?
}

/// A connected MCP client instance (from heartbeat telemetry).
///
/// Each instance is one running AI agent process (Claude Code, Codex CLI, etc.)
/// that has an active MCP session with the daemon.
struct InstanceInfo: Codable, Equatable, Identifiable {
    let pid: Int?
    let state: String?             // "active", "thinking", "busy", "idle"
    let sessionId: String?
    let workspace: String?         // absolute path to the project root
    let username: String?
    let hostname: String?
    let transport: String?         // "stdio" or "sse"
    let model: String?             // LLM model name reported by the client
    let startedAt: String?         // ISO 8601
    let uptime: Double?            // seconds
    let toolCallCount: Int?
    let turnCount: Int?
    let lastToolCallAt: Int?       // epoch-ms
    let provider: String?          // e.g. "anthropic", "openai"
    let providerSessionId: String?
    let clientKey: String?         // unique client identifier
    let agentNickname: String?     // user-assigned nickname
    let agentRole: String?         // role in multi-agent setups
    let parentThreadId: String?    // parent thread for delegated agents
    let agent: String?             // agent type identifier
    let isActive: Bool?
    let needsAttention: Bool?
    let attentionReasons: [String]?
    /// Context window pressure (0.0–1.0). High values mean the agent is
    /// close to its token limit and may need compaction or handoff.
    let contextPressure: Double?

    /// Stable identity for SwiftUI lists. Falls back to a random int if
    /// PID is nil (shouldn't happen in practice, but keeps ForEach safe).
    var id: Int { pid ?? Int.random(in: 1...999999) }

    /// Human-readable display name, preferring nickname > agent type >
    /// clientKey > generic "Client <pid>".
    var displayName: String {
        if let nick = agentNickname, !nick.isEmpty { return nick }
        if let a = agent, !a.isEmpty, a != "mcp" { return a }
        if let ck = clientKey, !ck.isEmpty { return ck }
        if let a = agent, !a.isEmpty { return a }
        return "Client \(pid ?? 0)"
    }

    /// Abbreviated model name for compact display (e.g. "opus", "sonnet").
    /// Returns nil for unknown/generic values to avoid showing noise.
    var shortModel: String? {
        guard let m = model, !m.isEmpty, m != "mcp", m != "unknown" else { return nil }
        if m.contains("opus") { return "opus" }
        if m.contains("sonnet") { return "sonnet" }
        if m.contains("haiku") { return "haiku" }
        if m.contains("gpt-4") { return "gpt-4" }
        return m
    }

    /// Last path component of the workspace (e.g. "/Users/x/project" → "project").
    var workspaceName: String? {
        guard let ws = workspace else { return nil }
        return ws.split(separator: "/").last.map(String.init)
    }

    /// Uptime as human-readable string ("30s", "5m", "2h 15m", "1d 3h").
    var uptimeString: String? {
        guard let u = uptime, u > 0 else { return nil }
        let secs = Int(u)
        if secs < 60 { return "\(secs)s" }
        if secs < 3600 { return "\(secs / 60)m" }
        if secs < 86400 { return "\(secs / 3600)h \((secs % 3600) / 60)m" }
        return "\(secs / 86400)d \((secs % 86400) / 3600)h"
    }

    /// Whether this instance is actively doing something right now
    /// (not just connected but idle).
    var isCurrentlyActive: Bool {
        isActive == true || state == "active" || state == "thinking" || state == "busy"
    }
}
