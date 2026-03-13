/// Nidra (consolidation) section — state badge, phase, progress bar,
/// last consolidation time, nidra uptime, consolidated dates count.

import SwiftUI

/// Displays the Nidra (overnight consolidation) subsystem status.
/// Nidra cycles through states: awake/listening -> sleeping/deep_sleep -> consolidating/dreaming.
/// The section adapts its icon, color, and detail rows based on the current state,
/// and shows a progress bar during active consolidation.
struct NidraSection: View {
    let nidra: NidraInfo?

    /// Normalized state string, lowercased for reliable pattern matching.
    private var state: String {
        nidra?.state?.lowercased() ?? "unknown"
    }

    /// Whether Nidra is actively processing (consolidating or dreaming).
    /// Controls progress bar visibility and accent color.
    private var isActive: Bool {
        state == "consolidating" || state == "dreaming"
    }

    var body: some View {
        InsetGroupedSection("Consolidation") {
            VStack(spacing: 0) {
                // State badge row
                HStack(spacing: Theme.sp8) {
                    Image(systemName: nidraIcon)
                        .font(.system(size: Theme.bodySize))
                        .foregroundColor(nidraColor)
                        .frame(width: 20)

                    Text("Nidra")
                        .font(.system(size: Theme.bodySize))
                        .foregroundColor(Theme.label)

                    Spacer()

                    StateBadge(state: state, isActive: isActive)
                }
                .padding(.horizontal, Theme.sp16)
                .padding(.vertical, Theme.sp8)

                Divider().padding(.leading, 44)

                // Phase
                if let phase = nidra?.consolidationPhase, !phase.isEmpty {
                    SectionRow("Phase", value: phase.capitalized, icon: "waveform.path")
                }

                // Progress bar — shown during active consolidation or when
                // leftover progress exists from a recently completed cycle
                if isActive || (nidra?.consolidationProgress ?? 0) > 0 {
                    VStack(spacing: 0) {
                        HStack(spacing: Theme.sp8) {
                            Image(systemName: "chart.bar.fill")
                                .font(.system(size: Theme.bodySize))
                                .foregroundColor(Theme.secondaryLabel)
                                .frame(width: 20)

                            NidraProgressBar(
                                progress: nidra?.consolidationProgress ?? 0,
                                phase: nil,
                                isActive: isActive
                            )

                            Text(String(format: "%.0f%%", nidra?.consolidationProgress ?? 0))
                                .font(.system(size: Theme.bodySize, design: .monospaced))
                                .foregroundColor(isActive ? Theme.purple : Theme.secondaryLabel)
                                .frame(width: 36, alignment: .trailing)
                        }
                        .padding(.horizontal, Theme.sp16)
                        .padding(.vertical, Theme.sp8)

                        Divider().padding(.leading, 44)
                    }
                }

                // Last completed
                SectionRow(
                    "Last Completed",
                    value: DaemonClient.formatRelativeTime(nidra?.lastConsolidationEnd),
                    icon: "checkmark.circle"
                )

                // Nidra uptime
                if let uptimeStr = nidra?.uptimeString {
                    SectionRow("Nidra Uptime", value: uptimeStr, icon: "clock.arrow.circlepath")
                }

                // Consolidated dates count
                if let count = nidra?.consolidatedDatesCount {
                    SectionRow(
                        "Dates Consolidated",
                        value: "\(count)",
                        icon: "calendar",
                        showSeparator: nidra?.lastBackfillDate != nil
                    )
                }

                // Backfill date — the earliest date Nidra has retroactively consolidated.
                // When this is the final row, suppress its separator; the EmptyView
                // branch handles the case where neither backfill nor dates-count exist.
                if let backfill = nidra?.lastBackfillDate {
                    SectionRow(
                        "Backfill Date",
                        value: backfill,
                        icon: "arrow.uturn.backward",
                        showSeparator: false
                    )
                } else if nidra?.consolidatedDatesCount == nil {
                    EmptyView()
                }
            }
        }
    }

    /// SF Symbol mapped to Nidra's lifecycle state.
    /// Active states get sparkles, sleep gets moon, awake gets eye.
    private var nidraIcon: String {
        switch state {
        case "consolidating", "dreaming": return "sparkles"
        case "sleeping", "deep_sleep": return "moon.zzz"
        case "awake", "listening": return "eye"
        default: return "questionmark.circle"
        }
    }

    /// Accent color mapped to Nidra's lifecycle state.
    /// Purple for active processing, blue for sleep, green for awake.
    private var nidraColor: Color {
        switch state {
        case "consolidating", "dreaming": return Theme.purple
        case "sleeping", "deep_sleep": return Theme.blue
        case "awake", "listening": return Theme.alive
        default: return Theme.tertiaryLabel
        }
    }
}
