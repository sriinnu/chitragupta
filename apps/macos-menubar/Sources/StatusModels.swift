/// Data models matching the daemon HTTP `/status` JSON response.
///
/// All structs are Codable for direct JSONDecoder mapping.
/// The daemon HTTP server returns the status directly (no wrapper).

import Foundation

/// Top-level response from `GET /status` on the daemon HTTP server.
/// Fields match the daemon's aggregated status output.
struct AggregatedStatus: Codable, Equatable {
    let daemon: DaemonInfo
    let nidra: NidraInfo?
    let db: DbCounts?
    let timestamp: Int

    /// Compare only display-relevant fields (exclude timestamp).
    static func == (lhs: AggregatedStatus, rhs: AggregatedStatus) -> Bool {
        lhs.daemon == rhs.daemon && lhs.nidra == rhs.nidra && lhs.db == rhs.db
    }
}

/// Daemon process information.
struct DaemonInfo: Codable, Equatable {
    let alive: Bool
    let pid: Int?
    let uptime: Int?
    let memory: Int?
    let connections: Int?
    let methods: Int?
}

/// Nidra sleep/consolidation state.
struct NidraInfo: Codable, Equatable {
    let state: String?
    let running: Bool?
    let consolidationProgress: Double?
    let lastConsolidationEnd: Int?
}

/// Database table row counts.
struct DbCounts: Codable, Equatable {
    let turns: Int
    let sessions: Int
    let rules: Int
    let vidhis: Int
    let samskaras: Int
    let vasanas: Int
    let akashaTraces: Int
}

/// Triguna health values (sums to ~1.0).
struct TrigunaInfo: Codable, Equatable {
    let sattva: Double
    let rajas: Double
    let tamas: Double
}
