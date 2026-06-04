# Georgetown Athletics Hall of Fame - Version 3 Prototype

Open `index.html` in a browser.

## How to edit inductees
Edit:

`data/inductees.json`

Each profile is generated automatically from this file.

## How to add photos later
1. Put photos in `images/profiles/`
2. In `data/inductees.json`, update the photo field, for example:

`"photo": "images/profiles/donnie-butcher.jpg"`

## Main pages
- `index.html` - museum entrance, searchable cards, legacy wall
- `profile.html?id=donnie-butcher` - reusable profile template
- `kiosk.html` - rotating kiosk preview

## Colors
The design uses:
- Orange: #ff6600
- Black
- Gray


## Version 4 update
Clicking "Enter the Hall" now triggers a museum entrance animation:
- Tiger logo rush/fade effect
- Orange portal ring
- Entrance dimming
- Smooth scroll into the Hall section
- Card arrival animation
- Reduced-motion accessibility fallback


## Version 5 update
The Enter the Hall button now uses a dramatic museum door animation:
- Full-screen black museum doors
- Orange crack of light
- Tiger logo zoom
- Light sweep
- Smooth reveal into the Hall section
- Staggered card fly-ins


## Version 6 fix
The earlier Enter button had duplicate class attributes, so the animation class was not being applied.
This version fixes that and makes both Enter buttons trigger the museum door animation.
It also includes a local fallback so the cards still appear when opening the file directly from a computer.


## Version 7 update
Added available Class of 2026 information to profile pages:
- Donnie Butcher — Men's Basketball
- Jayme Gilbert — Women's Basketball
- B.J. Mattingly — Football
- Greg Spalding — Football
- Tracy Wachtel Lattis — Women's Volleyball
- Mike Bova — Baseball, Trail Blazer Inductee
- 1986 Men's Tennis Team
- Red Faught — Football Coach

Some biographies are intentionally marked for later expansion because the official release page blocks direct full-text access.


## Version 8 update
This version fixes the local-loading issue by embedding the inductee information in:

`data/inductees.js`

That means the profile pages should show the Class of 2026 release information even when opened directly from an extracted folder on your computer.

Each profile page now has:
- "From the Class of 2026 Release"
- Biography
- Career Highlights
- Profile Details
- Official Release button


## Version 9 update
Added the full pasted Georgetown College Athletics 2026 Hall of Fame release content to the site.

Each profile now includes:
- Full Hall of Fame citation text
- Release-based headline
- Career highlights
- Profile-specific stat cards
- Category-specific page sections for athletes, coach, Trail Blazer, and team
- Ceremony announcement section on the homepage

The data lives in:
- `data/inductees.js`
- `data/inductees.json`

Because `inductees.js` is embedded as a normal script, profile data should load even when the site is opened locally from an extracted folder.


## Version 10 update
Added a sleek profile-opening animation when clicking an inductee card:
- Selected card launches forward
- Background darkens and blurs
- Profile preview card appears
- Orange light streak sweeps across the screen
- Then the profile page opens


## Version 11 polish
Presentation-ready changes:
- Removed behind-the-scenes photo setup language
- Replaced photo placeholders with a cleaner Hall of Fame / GC placeholder
- Added footer branding
- Changed video wording to "Highlight videos and archival footage will be added"
- Added Return to the Hall button on profile pages
- Added profile loading state


## Version 12 fix
Fixed duplicate footer issue:
- Homepage has exactly one footer.
- Individual profile pages have no footer.
- Kiosk page has no footer.
