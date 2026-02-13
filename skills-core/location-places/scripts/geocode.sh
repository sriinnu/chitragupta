#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Location Skill Helper — Geocode, Search, Directions
#
# Usage:
#   ./geocode.sh geocode "1600 Amphitheatre Parkway"
#   ./geocode.sh reverse 37.4224764 -122.0842499
#   ./geocode.sh search "coffee shops" 37.7749 -122.4194 1000
#   ./geocode.sh details ChIJ2eUgeAK6j4ARbn5u_wAGqWA
#   ./geocode.sh directions "Times Square, NY" "JFK Airport" driving
#   ./geocode.sh distance "New York" "Boston"
#
# Requires: curl, GOOGLE_MAPS_API_KEY env var
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE="https://maps.googleapis.com/maps/api"
KEY="${GOOGLE_MAPS_API_KEY:-}"

if [[ -z "$KEY" ]]; then
    # Try loading from credentials
    CRED_FILE="${HOME}/.chitragupta/config/credentials.json"
    if [[ -f "$CRED_FILE" ]]; then
        KEY=$(python3 -c "import json; print(json.load(open('$CRED_FILE')).get('GOOGLE_MAPS_API_KEY',''))" 2>/dev/null || true)
    fi
fi

if [[ -z "$KEY" ]]; then
    echo "Error: GOOGLE_MAPS_API_KEY not set."
    echo "Set it via: export GOOGLE_MAPS_API_KEY=your-key"
    echo "Or add to: ~/.chitragupta/config/credentials.json"
    exit 1
fi

urlencode() {
    python3 -c "import urllib.parse; print(urllib.parse.quote('$1', safe=''))"
}

CMD="${1:-help}"

case "$CMD" in
    geocode)
        ADDRESS="${2:?Usage: geocode.sh geocode ADDRESS}"
        ENC=$(urlencode "$ADDRESS")
        curl -s "${BASE}/geocode/json?address=${ENC}&key=${KEY}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data['status'] != 'OK':
    print(f'Status: {data[\"status\"]}')
    sys.exit(1)
for r in data['results']:
    loc = r['geometry']['location']
    print(f'Address:  {r[\"formatted_address\"]}')
    print(f'Coords:   {loc[\"lat\"]}, {loc[\"lng\"]}')
    print(f'Place ID: {r[\"place_id\"]}')
    comps = {c['types'][0]: c['long_name'] for c in r['address_components'] if c['types']}
    print(f'City:     {comps.get(\"locality\", comps.get(\"administrative_area_level_2\", \"—\"))}')
    print(f'State:    {comps.get(\"administrative_area_level_1\", \"—\")}')
    print(f'Country:  {comps.get(\"country\", \"—\")}')
    print(f'Zip:      {comps.get(\"postal_code\", \"—\")}')
    print()
"
        ;;

    reverse)
        LAT="${2:?Usage: geocode.sh reverse LAT LNG}"
        LNG="${3:?Usage: geocode.sh reverse LAT LNG}"
        curl -s "${BASE}/geocode/json?latlng=${LAT},${LNG}&key=${KEY}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data['status'] != 'OK':
    print(f'Status: {data[\"status\"]}')
    sys.exit(1)
r = data['results'][0]
print(f'Address:  {r[\"formatted_address\"]}')
print(f'Place ID: {r[\"place_id\"]}')
print(f'Types:    {', '.join(r.get(\"types\", []))}')
"
        ;;

    search)
        QUERY="${2:?Usage: geocode.sh search QUERY LAT LNG [RADIUS]}"
        LAT="${3:?}"
        LNG="${4:?}"
        RADIUS="${5:-1000}"
        ENC=$(urlencode "$QUERY")
        curl -s "${BASE}/place/textsearch/json?query=${ENC}&location=${LAT},${LNG}&radius=${RADIUS}&key=${KEY}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data['status'] != 'OK':
    print(f'Status: {data[\"status\"]}')
    sys.exit(1)
print(f'Found {len(data[\"results\"])} results:\n')
for i, r in enumerate(data['results'][:10], 1):
    rating = r.get('rating', '—')
    status = 'Open' if r.get('opening_hours', {}).get('open_now') else 'Unknown'
    price = '💲' * r.get('price_level', 0) if r.get('price_level') else '—'
    print(f'{i:2}. {r[\"name\"]}')
    print(f'    Rating: {rating}  Price: {price}  Status: {status}')
    print(f'    Address: {r.get(\"formatted_address\", \"—\")}')
    print()
"
        ;;

    details)
        PLACE_ID="${2:?Usage: geocode.sh details PLACE_ID}"
        FIELDS="name,formatted_address,formatted_phone_number,website,opening_hours,rating,user_ratings_total,price_level,business_status,geometry"
        curl -s "${BASE}/place/details/json?place_id=${PLACE_ID}&fields=${FIELDS}&key=${KEY}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data['status'] != 'OK':
    print(f'Status: {data[\"status\"]}')
    sys.exit(1)
r = data['result']
print(f'Name:     {r.get(\"name\", \"—\")}')
print(f'Address:  {r.get(\"formatted_address\", \"—\")}')
print(f'Phone:    {r.get(\"formatted_phone_number\", \"—\")}')
print(f'Website:  {r.get(\"website\", \"—\")}')
print(f'Rating:   {r.get(\"rating\", \"—\")} ({r.get(\"user_ratings_total\", 0)} reviews)')
print(f'Price:    {\"💲\" * r.get(\"price_level\", 0) if r.get(\"price_level\") else \"—\"}')
print(f'Status:   {r.get(\"business_status\", \"—\")}')
hours = r.get('opening_hours', {}).get('weekday_text', [])
if hours:
    print(f'Hours:')
    for h in hours:
        print(f'  {h}')
loc = r.get('geometry', {}).get('location', {})
if loc:
    print(f'Coords:   {loc.get(\"lat\")}, {loc.get(\"lng\")}')
"
        ;;

    directions)
        ORIGIN="${2:?Usage: geocode.sh directions ORIGIN DESTINATION [MODE]}"
        DEST="${3:?}"
        MODE="${4:-driving}"
        ENC_O=$(urlencode "$ORIGIN")
        ENC_D=$(urlencode "$DEST")
        curl -s "${BASE}/directions/json?origin=${ENC_O}&destination=${ENC_D}&mode=${MODE}&departure_time=now&key=${KEY}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data['status'] != 'OK':
    print(f'Status: {data[\"status\"]}')
    sys.exit(1)
for ri, route in enumerate(data['routes'][:3]):
    leg = route['legs'][0]
    traffic = leg.get('duration_in_traffic', {}).get('text', '')
    traffic_note = f' (with traffic: {traffic})' if traffic else ''
    print(f'Route {ri+1}: {leg[\"distance\"][\"text\"]} | {leg[\"duration\"][\"text\"]}{traffic_note}')
    print(f'  From: {leg[\"start_address\"]}')
    print(f'  To:   {leg[\"end_address\"]}')
    print(f'  Via:  {route.get(\"summary\", \"—\")}')
    print()
"
        ;;

    distance)
        ORIGIN="${2:?Usage: geocode.sh distance ORIGIN DESTINATION}"
        DEST="${3:?}"
        ENC_O=$(urlencode "$ORIGIN")
        ENC_D=$(urlencode "$DEST")
        curl -s "${BASE}/distancematrix/json?origins=${ENC_O}&destinations=${ENC_D}&mode=driving&departure_time=now&key=${KEY}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data['status'] != 'OK':
    print(f'Status: {data[\"status\"]}')
    sys.exit(1)
origin = data['origin_addresses'][0]
dest = data['destination_addresses'][0]
elem = data['rows'][0]['elements'][0]
if elem['status'] != 'OK':
    print(f'No route: {elem[\"status\"]}')
    sys.exit(1)
traffic = elem.get('duration_in_traffic', {}).get('text', '')
print(f'From:     {origin}')
print(f'To:       {dest}')
print(f'Distance: {elem[\"distance\"][\"text\"]}')
print(f'Duration: {elem[\"duration\"][\"text\"]}')
if traffic:
    print(f'Traffic:  {traffic}')
"
        ;;

    *)
        echo "Usage: geocode.sh <command> [args]"
        echo ""
        echo "Commands:"
        echo "  geocode ADDRESS          — Address to coordinates"
        echo "  reverse LAT LNG          — Coordinates to address"
        echo "  search QUERY LAT LNG [R] — Search places nearby (R=radius in meters)"
        echo "  details PLACE_ID         — Full place details"
        echo "  directions FROM TO [MODE]— Get directions (driving/walking/transit/bicycling)"
        echo "  distance FROM TO         — Distance and travel time"
        ;;
esac
