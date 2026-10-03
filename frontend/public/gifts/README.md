# Original Telegram gift images

Snapshot: 2026-10-02. Source: [GiftChanges](https://t.me/GiftChanges),
https://cdn.changes.tg/gifts/originals/ and https://api.changes.tg/ids.
Original artwork belongs to its respective owners.

162 original gift thumbnails are bundled as WebP files named by Telegram gift ID.
These are original, unupgraded gifts, not a random numbered collectible variant.
Images were fetched from `/original/{id}.png?size=256`, validated with Pillow,
resized to at most 256×256 and encoded as WebP (quality 88).

`frontend/src/data/telegramGiftOriginals.json` maps IDs to published collection
names and verified aliases. Empty names mean the source has an image but no
published collection name; these entries can be resolved by ID. Russian aliases
were visually checked against the original artwork. No user IDs or item positions
are part of this shared catalogue.

Explicit media URLs take priority, followed by a numbered Telegram NFT link.
Unupgraded gifts resolve the original by collection name/alias/ID; upgraded gifts
keep their individual numbered images. Unknown names use the gift icon.

To refresh: obtain the originals directory and ID/name map from the source,
download and validate the new thumbnails, retain verified aliases, update this
snapshot date, and check that every catalogue ID has its corresponding WebP.
Do not infer ambiguous aliases or replace explicit user images.
