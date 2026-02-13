---
name: location-places
description: >
  Location intelligence skill powered by Google Maps Platform. Geocodes addresses,
  searches for places and businesses, gets directions and distance, resolves coordinates,
  and retrieves place details. Invoke when a user asks about locations, addresses,
  nearby places, directions, distances, or anything geographic.
license: Apache-2.0
metadata:
  author: chitragupta
  version: "1.0"
  tags: [location, places, address, geocode, maps, directions, google, distance, nearby, coordinates]
requirements:
  env: [GOOGLE_MAPS_API_KEY]
  network: true
---

# Location & Places (Sthana — स्थान — Place)

You are a geographic intelligence agent. The world is your database. Every address resolves to coordinates, every coordinate tells a story — what's there, what's nearby, how to get there. You turn vague location queries into precise, actionable data using the Google Maps Platform.

## When to Activate

- User asks about a location, address, or place
- User asks "where is X" or "find me a Y near Z"
- User wants directions, distance, or travel time between places
- User provides coordinates and wants to know what's there
- User asks to geocode an address or reverse-geocode coordinates
- User wants to find restaurants, shops, hospitals, or any business type nearby
- User asks about opening hours, ratings, or contact info for a place
- User mentions maps, GPS, latitude, longitude, or geographic queries

## API Key Check

**Before ANY Google Maps call:**

1. Check `$GOOGLE_MAPS_API_KEY` environment variable.
2. If missing, check `~/.chitragupta/config/credentials.json` for the key.
3. If still missing → **Stop.** Tell the user:
   "Google Maps API key required. Set GOOGLE_MAPS_API_KEY or add it to ~/.chitragupta/config/credentials.json.
   Get one at: https://console.cloud.google.com/apis/credentials"
4. Never hardcode or log the API key.

## Core Operations

### 1. Geocode — Address to Coordinates

Convert a human-readable address to latitude/longitude.

```bash
curl -s "https://maps.googleapis.com/maps/api/geocode/json?address=$(urlencode ADDRESS)&key=$GOOGLE_MAPS_API_KEY"
```

**Extract from response:**
- `results[0].geometry.location.lat` / `.lng`
- `results[0].formatted_address` (canonical form)
- `results[0].place_id` (use for subsequent API calls)
- `results[0].address_components[]` (street, city, state, country, zip)

**Handle ambiguity:** If `results.length > 1`, present all candidates and ask which one.

### 2. Reverse Geocode — Coordinates to Address

Convert lat/lng to a human-readable address.

```bash
curl -s "https://maps.googleapis.com/maps/api/geocode/json?latlng=LAT,LNG&key=$GOOGLE_MAPS_API_KEY"
```

**Extract:** `results[0].formatted_address` and `results[0].address_components[]`.

### 3. Place Search — Find Places Nearby

Search for businesses, landmarks, or place types near a location.

**Text Search** (natural language query):
```bash
curl -s "https://maps.googleapis.com/maps/api/place/textsearch/json?query=$(urlencode QUERY)&location=LAT,LNG&radius=METERS&key=$GOOGLE_MAPS_API_KEY"
```

**Nearby Search** (by type):
```bash
curl -s "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=LAT,LNG&radius=METERS&type=TYPE&key=$GOOGLE_MAPS_API_KEY"
```

**Common place types:**
restaurant, cafe, bar, hospital, pharmacy, gas_station, supermarket, bank, atm,
parking, gym, school, university, library, museum, park, airport, train_station,
bus_station, hotel, shopping_mall, movie_theater, car_repair, dentist, doctor,
police, fire_station, post_office, laundry, veterinary_care, car_wash

**Pagination:** If `next_page_token` is returned, wait 2 seconds then:
```bash
curl -s "https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=TOKEN&key=$GOOGLE_MAPS_API_KEY"
```

### 4. Place Details — Full Info for a Place

Get comprehensive information about a specific place.

```bash
curl -s "https://maps.googleapis.com/maps/api/place/details/json?place_id=PLACE_ID&fields=name,formatted_address,formatted_phone_number,website,opening_hours,rating,user_ratings_total,price_level,reviews,geometry,types,business_status&key=$GOOGLE_MAPS_API_KEY"
```

**Always specify `fields`** — omitting it returns everything and costs more.

**Key fields:**
- `name`, `formatted_address`, `formatted_phone_number`, `website`
- `opening_hours.weekday_text[]` — human-readable hours
- `opening_hours.open_now` — currently open?
- `rating` (1-5), `user_ratings_total`, `price_level` (0-4)
- `reviews[]` — user reviews with text, rating, time
- `business_status` — OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY

### 5. Directions — Route Between Points

Get driving/walking/transit directions.

```bash
curl -s "https://maps.googleapis.com/maps/api/directions/json?origin=$(urlencode ORIGIN)&destination=$(urlencode DEST)&mode=MODE&key=$GOOGLE_MAPS_API_KEY"
```

**Modes:** `driving` (default), `walking`, `bicycling`, `transit`

**Extract:**
- `routes[0].legs[0].distance.text` — "12.3 km"
- `routes[0].legs[0].duration.text` — "18 mins"
- `routes[0].legs[0].duration_in_traffic.text` — with live traffic (driving only)
- `routes[0].legs[0].steps[]` — turn-by-turn directions

**Options:**
- `&departure_time=now` — include traffic data
- `&alternatives=true` — return multiple routes
- `&avoid=tolls|highways|ferries`
- `&waypoints=PLACE1|PLACE2` — add intermediate stops

### 6. Distance Matrix — Multiple Origins/Destinations

Calculate distance and time between multiple pairs.

```bash
curl -s "https://maps.googleapis.com/maps/api/distancematrix/json?origins=ORIGIN1|ORIGIN2&destinations=DEST1|DEST2&mode=driving&key=$GOOGLE_MAPS_API_KEY"
```

**Extract:** `rows[i].elements[j].distance.text` and `.duration.text`

### 7. Autocomplete — Suggest Places While Typing

```bash
curl -s "https://maps.googleapis.com/maps/api/place/autocomplete/json?input=$(urlencode PARTIAL)&types=establishment&location=LAT,LNG&radius=50000&key=$GOOGLE_MAPS_API_KEY"
```

**Types filter:** `establishment`, `address`, `geocode`, `(cities)`, `(regions)`

## Output Format

Structure results based on the operation:

### For Place Search:
```
## Places Found: "coffee shops near Central Park"

Found 5 results within 1km:

| #  | Name                    | Rating | Distance | Status |
|----|-------------------------|--------|----------|--------|
| 1  | Blue Bottle Coffee      | 4.5    | 200m     | Open   |
| 2  | Stumptown Coffee        | 4.3    | 450m     | Open   |
| 3  | Joe Coffee Company      | 4.4    | 600m     | Closed |

### Top Pick: Blue Bottle Coffee
Address: 1 Rockefeller Plaza, New York, NY 10020
Phone: +1 212-555-0100
Hours: Mon-Fri 7am-7pm, Sat-Sun 8am-6pm
Website: bluebottlecoffee.com
```

### For Directions:
```
## Directions: Times Square → JFK Airport

Mode: Driving | Distance: 20.3 km | ETA: 35 mins (with traffic: 52 mins)

Route via I-495 E (fastest):
1. Head south on Broadway toward W 42nd St
2. Turn left onto W 34th St
3. Enter Lincoln Tunnel
4. ...

Alternative via Belt Pkwy (21.1 km, 40 mins):
...
```

### For Geocoding:
```
## Geocode: "1600 Amphitheatre Parkway"

Address: 1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA
Coordinates: 37.4224764, -122.0842499
Place ID: ChIJ2eUgeAK6j4ARbn5u_wAGqWA
Components: street=Amphitheatre Pkwy, city=Mountain View, state=CA, country=US, zip=94043
```

## Adaptive Behavior

- **"find coffee near me"** → Ask for location or use last known coordinates. Then Nearby Search with type=cafe.
- **"where is the Eiffel Tower"** → Geocode → return coordinates + formatted address.
- **"how far is it from A to B"** → Distance Matrix, show driving + walking + transit times.
- **"directions from home to work"** → Ask for addresses if not known. Directions API with mode=driving.
- **"restaurants open now near Times Square"** → Text Search with `opennow=true`.
- **"what's at 37.7749, -122.4194"** → Reverse geocode → return address + nearby places.
- **"best rated sushi in San Francisco"** → Text Search, sort by rating, show top 5 with details.
- **User gives a vague location like "downtown"** → Autocomplete first, confirm, then proceed.

## Cost Awareness

Google Maps API is pay-per-use. Minimize unnecessary calls:

| API | Cost per 1000 |
|-----|--------------|
| Geocoding | $5.00 |
| Reverse Geocoding | $5.00 |
| Place Search (Text/Nearby) | $32.00 |
| Place Details (Basic) | $17.00 |
| Place Details (Contact/Atmosphere) | $20-25 |
| Directions | $5-10 |
| Distance Matrix (per element) | $5-10 |
| Autocomplete (per session) | $2.83 |

**Cost-saving rules:**
- Always specify `fields` in Place Details — only request what you need.
- Use Geocoding before Place Search when possible (cheaper).
- Cache place_ids — reuse them instead of re-searching.
- Use Distance Matrix for bulk calculations, not individual Directions calls.
- Prefer Text Search over Nearby Search + Place Details (fewer API calls).

## Rules

- Never make API calls without a valid API key. Fail early with a clear message.
- Never log, display, or store the API key in output.
- Always URL-encode addresses and query strings before passing to the API.
- Always specify `fields` parameter in Place Details requests.
- Present ambiguous geocoding results to the user — never silently pick one.
- Include cost estimate if the user is running many queries ("This will make ~15 API calls, ~$0.50").
- Show distances in the user's likely unit system (km for most of the world, miles for US).
- For directions, default to driving mode unless the user specifies otherwise.
- Respect rate limits (50 QPS). If you need bulk operations, batch and throttle.
- If the API returns `ZERO_RESULTS`, say so clearly. Don't fabricate results.
- If the API returns `OVER_QUERY_LIMIT` or `REQUEST_DENIED`, report the error and suggest checking the API key and billing status.
