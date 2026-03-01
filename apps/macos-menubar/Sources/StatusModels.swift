/// Data models matching the `/api/daemon/status` JSON response.
///
/// All structs are Codable for direct JSONDecoder mapping.
/// Mirrors the TypeScript `AggregatedStatus` interface.

import Foundation

/// Top-level response from `GET /api/daemon/status`.
struct DaemonStatusResponse: Codable {
    let ok: Bool
    let data: AggregatedStatus?
}

/// Aggregated daemon status payload.
struct AggregatedStatus: Codable {
    let daemon: DaemonInfo
    let nidra: NidraInfo?
    let db: DbCounts?
    let circuit: CircuitInfo?
    let triguna: TrigunaInfo?
    let timestamp: Int
}

/// Daemon process information.
struct DaemonInfo: Codable {
    let alive: Bool
    let pid: Int?
    let uptime: Int?
    let memory: Int?
    let connections: Int?
    let methods: Int?
}

/// Nidra sleep/consolidation state.
struct NidraInfo: Codable {
    let state: String
    let consolidationProgress: Double?
    let lastConsolidationEnd: Int?
}

/// Database table row counts.
struct DbCounts: Codable {
    let turns: Int
    let sessions: Int
    let rules: Int
    let vidhis: Int
    let samskaras: Int
    let vasanas: Int
    let akashaTraces: Int
}

/// Circuit breaker state.
struct CircuitInfo: Codable {
    let state: String
    let consecutiveFailures: Int
    let mode: String
}

/// Triguna health values (sums to ~1.0).
struct TrigunaInfo: Codable {
    let sattva: Double
    let rajas: Double
    let tamas: Double
}
