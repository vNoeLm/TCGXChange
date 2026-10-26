# TCG Vault Development Roadmap & Task List (TODO)

## Phase 1: High Priority (Immediate & Active Tasks)

### Navigation, Layout & Order Polish

- [x] **Navbar tab order swap**
  - [x] Swap "Marketplace" and "Store" order in the main site NAVBAR so "Store" appears before "Marketplace".
  - [x] Swap the tab order in the Admin Panel so "Store" is listed first before "Marketplace".

### Marketplace Fixes & Display Enhancements

- [x] When viewing marketplace listings by Card the Overnumber and alt art text are not shown
- [x] Remove the overnumbered text from text to the 235/219 text
- [x] Investigate missing Tier X badge on the "By Listings" marketplace view (space constraint check).
- [x] Addable tracking number for orders
- [x] A possible Marketplace Card OnClick overhaul as the 4 diferent containers feel excessive seller container has a lot of waisted space at top and bottom looks weird
- [x] Optimize whitespace between the price trend graph and card price details in the listings view to make the layout more compact and readable (Low priority).

### Collection Management UI Placement

- [x] Relocate "Move copies" button from the card list item into the card OnClick detail modal under the "My Collection Tracker" section.

### Multi-Currency Disclaimer

- [x] Notice all prices are meant in HUF eur prices are stricly for informational purpose and ur bank may charge u extra for currency exchange / rates may differ

---

## Phase 2: Medium Priority (Core Marketplace & Store Features)

### Market Protection & Anti-Scalping

- [x] **Per-customer purchase limits (Limit per customer / order - Anti-Scalping)**
  - [x] Support product-level `max_per_order` in the Store product model (JSONB `attributes.max_per_order`) and Admin Console (e.g. Max 1 or 2 Booster Boxes / order).
  - [x] Visual badge on store product cards (_"Limit X/order"_) and on the detailed product page (_"Limit: Max X per customer"_).
  - [x] Enforce quantity stepper limit on product pages and in the cart (when Store cart/checkout is activated).
  - [x] Backend checkout validation when finalizing an order.
- [x] **Marketplace open holds cap (Buyer open holds cap)**
  - [x] Limit maximum concurrent `pending` hold requests per buyer (5 at a time) to prevent malicious locking of multiple sellers' inventory.

### Marketplace P2P Reliability & Seller Pipeline

- [x] **Automatic expiration for pending hold requests (Pending Hold Expiry)**
  - [x] Automatically cancel unresponded `pending` holds and release cards back to seller inventory after 48 hours.
  - [x] Automated system message in trade chat notifying parties of the expiration.
- [x] **Transaction reliability improvements**
  - [x] Eliminate silent error swallowing (`empty catch`) in the `autoCompleteTimedOutRequests` method, and update order status only after successful database commit.
- [x] More seller hub and selling / buying pipeline audit as im still not quite satisfied the 4 containers net sale active inventory price health and action items feel out of place maybe move them to stats page? stats page overhaul. custom shipping made by seller? so we dont need to have all existing shipping companies listed and sellers can just make their own.

### Official Webstore Expansion

- [x] Timed product release. its a draft until X time then active for example for set releasees (Maybe MSRP in product details if CSV contains it)
- [x] Store Filter rework when specific game is selected more specific filters aka riftbound selected instead of just sealed tcg option lets have packs dispalys vault decks for example and same for other gamaes later same for playmats toploaders and anything more specific filters like for playmats size for or color filters for deck boxes size etc
- [x] A button in Store only visible to ADMINS to edit as im noticing it takes long to go to profile console and edit

### Auth & Onboarding

- [x] **Country/Region selection on registration**
  - [x] Add region selector to the signup flow and let the user change it on their profile (shown as the flag/country on listings and used for the local marketplace).

---

## Phase 3: Low Priority (Polish, Automation & Post-Company Formation)

### Official Webstore Checkout & Notifications

- [x] **Store Cart Drawer (Store Cart Module)**
  - [x] Dedicated shopping cart for official store products (Displays, Starter Decks, Katana sleeves, Boulder deck boxes).
  - [x] Real-time total order value and shipping fee calculation.
- [x] **Back-in-Stock Notifications**
  - [x] _"Notify me when back in stock"_ email subscription box on sold-out products.
  - [x] Automated notification dispatch from admin console when new inventory arrives.
- [x] **Product Requests**
  - [x] "Request a Product" form/modal linked from the footer for shoppers looking for products not currently listed (Low priority).
- [ ] **Payment & invoicing preparation (For activation post-company formation)**
  - [ ] Barion Smart Gateway sandbox environment integration.
  - [ ] Számlázz.hu Agent API integration for automated electronic invoice issuance.
- [x] **Combined starter bundles (Bundles)**
  - [x] Bundle offer creation in admin console (e.g. 1 Booster Box + 1 Katana Sleeve + 1 Deck Box at a discounted bundle price).
- [x] **Demo Products & Inventory Seeding**
  - [x] Seed realistic demo products for Store testing: Riftbound product vault items, official playmats, and One Piece TCG products.

### Notification System & Automation

- [x] **Notification system (Email & Push)**
  - [x] Seller email notification when a new Hold Request is received (Resend API integration).
  - [x] Buyer email notification when a seller accepts or rejects a hold request.
  - [x] Maybe a phone or email notification for me when a order is placed in store
- [x] **Product background removal script**
  - [x] Script/utility to batch-remove backgrounds from product photos to produce clean, transparent catalog images.

### Visual Polish & Social Features

- [x] **Price chart point scaling**
  - [x] Reduce dot radius on price history charts when `/Year` view is selected so large data points do not obscure trend lines.
- [x] **Button hover color consistency**
  - [x] Replace lingering brown/beige hover states with the cohesive light mode accent hover style (matching the pinkish hover border color).
- [x] **Instant QR code profile sharing**
  - [x] One-click QR code viewer on user profile so players at game nights can open trade binders with a single scan.
- [x] Add descriptive on-hover tooltip text to the Tier X badge (Low priority).

### Localization & Market Data

- [ ] **Language & Currency pairing (HUF/EUR <-> HUN/ENG)**
  - [ ] Link currency selector to also toggle language between Hungarian and English (keeping price conversion in sync).
  - [ ] Translate UI where appropriate, leaving untranslatable game-specific terminology intact (e.g. "Domain") (Very low priority/Disregard for now).
- [x] **Multi-game price sync audit**
  - [x] Fix price data updates for games other than Riftbound (One Piece, Lorcana, MTG, Pokémon, Star Wars) so automated sync and on-demand refreshes run reliably.

---

## Completed Tasks

- [x] **Digital withdrawal form (Elállási jog) & Admin view**
  - [x] Online withdrawal form so customers can submit withdrawal requests directly without manual emails.
  - [x] Admin panel view to review and manage incoming customer withdrawal requests.
  - [x] Add missing Hungarian "Elállási jog" legal link and text in the footer.
- [x] **Precise card copy movement between collections (Move copies)**
  - [x] Per-card move modal (custom quantity, normal/foil selector).
  - [x] Bulk move expanded with "Move exactly N copies" mode.
  - [x] Automatic marketplace listing according to destination collection rules.
- [x] **Store Light Mode contrast & filter fix**
  - [x] Fix the "Sold Out" text color in light mode.
  - [x] Remove/adjust the CSS opacity/filter that makes store product cards appear blurry or washed-out in light mode.
- [x] **Theme consistency for badges**
  - [x] Ensure "Verified Store" and "Tier X Seller" badges on opened marketplace listing views adapt properly to active theme CSS variables (matching the card detail modal).
- [x] **Admin Tab Order**
  - [x] Store is listed first before Marketplace in Admin Console.

# New

- [x] When trying to sell a card from your catalog u get Could not find the table 'public.marketplace_listings' in the schema cache error
- [x] Move card menu shows this: Keep in ${nameOf(fromId)}
- [x] Add Tags to search so u dont have to toggle them in filters u can just type "seraphine" or "akali" and it finds by tag as well
- [x] Probably remove verified store tag for now
- [x] Marketplace Card-to-Card Trading (Trade option: set up trade for Card X to Card Y, browse trades, propose trade via messages)
- [x] Listing Likes & Sort by Like (Heart like button on listings and trades, real-time like count, "Most Liked" sort mode in marketplace)
- [x] Saved Listings (Bookmark save button, "Saved" view/filter in marketplace with live count badge, view saved listings & trades later)
- [x] Fix "+ Set Up Trade" modal opening (transition state & DOM portal alignment)
- [x] Display like count when any marketplace listing or trade is open (prominent "0 likes" / "N likes" badge)
- [x] Fix likes resetting to 0 on refresh while staying red (like counts persistence in localStorage + server fallback + effective count resolver)
- [x] Fix trade setup card images not loading & console 404 errors (use getCardImageUrl for relative storage paths across modals)
- [x] Dynamic shipping options loaded from Seller Hub configuration (custom methods, fees, and pickup locations in ListCardModal, CreateTradeModal, EditListingModal, and CardDetail)
