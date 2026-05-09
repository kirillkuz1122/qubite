#!/usr/bin/env bash
# tc-fair-share.sh — Fair-share bandwidth shaping for NaiveProxy via tc + CAKE qdisc.
#
# CAKE (Common Applications Kept Enhanced) automatically provides per-flow
# fair queuing. Since each NaiveProxy client is a separate TCP connection from
# a unique source IP, CAKE gives fair per-client bandwidth distribution on egress.
#
# Usage:
#   tc-fair-share.sh enable [INTERFACE] [BANDWIDTH]   — apply shaping
#   tc-fair-share.sh disable [INTERFACE]               — remove shaping (rollback)
#   tc-fair-share.sh status [INTERFACE]                — show current qdisc
#
# Examples:
#   tc-fair-share.sh enable eth0 500mbit
#   tc-fair-share.sh disable eth0
#   tc-fair-share.sh status eth0
#
# The BANDWIDTH parameter is the total link capacity; CAKE will distribute it
# fairly among active flows. Default: 1gbit.
#
# Requirements: iproute2 with CAKE support (kernel 4.19+).

set -euo pipefail

ACTION="${1:-status}"
IFACE="${2:-$(ip route show default | awk '/default/ {print $5; exit}')}"
BANDWIDTH="${3:-1gbit}"

if [[ -z "$IFACE" ]]; then
    echo "ERROR: Could not detect default network interface." >&2
    echo "Usage: $0 enable|disable|status [INTERFACE] [BANDWIDTH]" >&2
    exit 1
fi

case "$ACTION" in
    enable)
        echo "Enabling CAKE fair-share on $IFACE (bandwidth: $BANDWIDTH)..."

        # Remove existing qdisc if any (ignore error if none)
        tc qdisc del dev "$IFACE" root 2>/dev/null || true

        # Apply CAKE qdisc with per-flow fairness
        # - bandwidth: total link capacity
        # - flowblind: pure per-flow fairness (no host grouping)
        # - nat: handle NAT'd connections properly
        # - wash: clear DSCP markings to prevent priority gaming
        tc qdisc add dev "$IFACE" root cake \
            bandwidth "$BANDWIDTH" \
            flowblind \
            nat \
            wash \
            ack-filter \
            no-split-gso

        echo "Done. CAKE qdisc active on $IFACE."
        echo ""
        echo "To verify: $0 status $IFACE"
        echo "To remove: $0 disable $IFACE"
        ;;

    disable)
        echo "Removing CAKE fair-share from $IFACE..."
        tc qdisc del dev "$IFACE" root 2>/dev/null || true
        echo "Done. Default qdisc restored on $IFACE."
        ;;

    status)
        echo "Current qdisc on $IFACE:"
        tc qdisc show dev "$IFACE" 2>/dev/null || echo "(none or error)"
        echo ""
        echo "Current statistics:"
        tc -s qdisc show dev "$IFACE" 2>/dev/null || echo "(none)"
        ;;

    *)
        echo "Usage: $0 enable|disable|status [INTERFACE] [BANDWIDTH]" >&2
        exit 1
        ;;
esac
