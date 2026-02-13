# Google Maps Place Types Reference

## Food & Drink
| Type | Description |
|------|-------------|
| restaurant | Restaurants |
| cafe | Coffee shops, cafes |
| bar | Bars, pubs |
| bakery | Bakeries |
| meal_delivery | Food delivery services |
| meal_takeaway | Takeaway restaurants |

## Health & Emergency
| Type | Description |
|------|-------------|
| hospital | Hospitals |
| doctor | Doctor offices |
| dentist | Dental offices |
| pharmacy | Pharmacies |
| veterinary_care | Veterinary clinics |
| physiotherapist | Physiotherapy |
| fire_station | Fire stations |
| police | Police stations |

## Transport
| Type | Description |
|------|-------------|
| airport | Airports |
| train_station | Train stations |
| bus_station | Bus stations |
| subway_station | Metro/subway |
| taxi_stand | Taxi stands |
| gas_station | Gas/petrol stations |
| car_repair | Auto repair |
| car_wash | Car wash |
| parking | Parking lots/garages |
| ev_charging_station | EV chargers |

## Shopping & Services
| Type | Description |
|------|-------------|
| shopping_mall | Shopping malls |
| supermarket | Supermarkets, grocery |
| convenience_store | Convenience stores |
| clothing_store | Clothing shops |
| electronics_store | Electronics |
| hardware_store | Hardware stores |
| book_store | Book stores |
| pet_store | Pet shops |
| florist | Flower shops |
| furniture_store | Furniture |
| jewelry_store | Jewelry |
| shoe_store | Shoe shops |

## Finance
| Type | Description |
|------|-------------|
| bank | Banks |
| atm | ATMs |
| insurance_agency | Insurance |
| accounting | Accountants |

## Education
| Type | Description |
|------|-------------|
| school | Schools |
| university | Universities |
| library | Libraries |
| primary_school | Primary schools |
| secondary_school | Secondary schools |

## Recreation & Culture
| Type | Description |
|------|-------------|
| park | Parks |
| gym | Gyms, fitness |
| museum | Museums |
| art_gallery | Art galleries |
| movie_theater | Cinemas |
| stadium | Stadiums |
| amusement_park | Theme parks |
| aquarium | Aquariums |
| zoo | Zoos |
| bowling_alley | Bowling |
| night_club | Night clubs |
| spa | Spas |
| campground | Campgrounds |

## Accommodation
| Type | Description |
|------|-------------|
| hotel | Hotels |
| lodging | General lodging |

## Other Services
| Type | Description |
|------|-------------|
| post_office | Post offices |
| laundry | Laundromats |
| hair_care | Hair salons |
| beauty_salon | Beauty salons |
| storage | Storage units |
| travel_agency | Travel agencies |
| real_estate_agency | Real estate |
| lawyer | Law offices |
| locksmith | Locksmiths |
| plumber | Plumbers |
| electrician | Electricians |
| roofing_contractor | Roofers |
| painter | Painters |
| moving_company | Movers |

## Religious
| Type | Description |
|------|-------------|
| church | Churches |
| mosque | Mosques |
| hindu_temple | Hindu temples |
| synagogue | Synagogues |

## Price Level Mapping

| Value | Meaning |
|-------|---------|
| 0 | Free |
| 1 | Inexpensive |
| 2 | Moderate |
| 3 | Expensive |
| 4 | Very Expensive |

## Business Status

| Value | Meaning |
|-------|---------|
| OPERATIONAL | Open and operating |
| CLOSED_TEMPORARILY | Temporarily closed |
| CLOSED_PERMANENTLY | Permanently closed |

## API Response Status Codes

| Status | Meaning | Action |
|--------|---------|--------|
| OK | Success | Process results |
| ZERO_RESULTS | No matches | Tell user, suggest broader query |
| OVER_DAILY_LIMIT | Billing issue | Check API key billing |
| OVER_QUERY_LIMIT | Rate limited | Wait and retry |
| REQUEST_DENIED | Invalid key | Check API key validity |
| INVALID_REQUEST | Bad parameters | Fix request parameters |
| UNKNOWN_ERROR | Server error | Retry once |
