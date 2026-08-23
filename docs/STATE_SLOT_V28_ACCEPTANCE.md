# v2.8 Acceptance

Required regression behavior:

1. Comfort Slides Black size 40 quantity 30 -> `show my cart` shows 30 and Rs57,000.
2. `add 50 more comfort slides` -> Commerce increment intent; inventory 38 means at most 8 additional units; cart remains 30 unless user chooses a valid increment.
3. `confirm my order` after staging -> checkout shows quantity 30, never 60.
4. `i want a cleaner for two hours` -> Cleaning receives and preserves `durationHours=2`.
5. Repeated generic cleaning requests keep the duration slot rather than discarding it.
6. Existing conversation corpus remains green.
