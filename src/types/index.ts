export interface Game {
  id: string;
  name: string;
  icon_url?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

export type ProductType = 'single' | 'booster_box' | 'booster_pack' | 'starter_deck' | 'bundle' | 'etb' | 'accessory';

export type UserRole = 'user' | 'admin' | 'owner';

export interface InventoryCard {
  inventory_id: string;
  condition: string;
  is_foil: boolean;
  price_huf: number | null;
  status: string;
  notes: string | null;
  /** Handover methods the seller offers for this listing (marketplace listings API). */
  handover_methods?: string[];
  is_bulk: boolean;
  quantity: number;
  card_id: string;
  card_number: string;
  name: string;
  rarity: string;
  card_type: string;
  cost: number;
  image_path: string | null;
  set_id: string;
  set_name: string;
  set_code: string;
  sets?: { id: string; name: string; code: string };
  subtype?: string;
  text?: string;
  game: string;
  game_id?: string;
  metadata?: Record<string, any>;
  energy?: string;
  might?: string;
  domain?: string;
  tags?: any;
  ability?: string;
  market_price_eur?: number | null;
  market_price_foil_eur?: number | null;
  last_price_updated_at?: string | null;
  inventory_images?: Array<{ image_path: string; display_order?: number }>;
  inventory_image?: string | null;
  /** The card's official art; `image_path` may instead be a seller's condition photo. */
  card_image_path?: string | null;
  seller_id?: string;
  seller_name?: string;
  seller_avatar?: string | null;
  seller_role?: UserRole;
  seller_rating_avg?: number | null;
  seller_rating_count?: number;
  is_marketplace_listing?: boolean;
  views?: number;
  clicks?: number;
  seller_badge?: string;
  seller_tier?: number;
  seller_sales_count?: number;
  seller_items_sold?: number;
  seller_country?: string;
  likes_count?: number;
  is_liked?: boolean;
  is_saved?: boolean;
}

export interface MarketplaceTrade {
  id: string;
  trader_id: string;
  trader_name: string;
  trader_avatar?: string | null;
  trader_country?: string;
  trader_rating_avg?: number | null;
  trader_rating_count?: number;
  trader_tier?: number;
  trader_badge?: string;

  // Offered card (Card X)
  offered_card_id: string;
  offered_card: CatalogCard;
  offered_condition: string;
  offered_is_foil: boolean;
  offered_quantity: number;
  offered_images?: string[];

  // Wanted card (Card Y)
  wanted_card_id: string;
  wanted_card: CatalogCard;
  wanted_min_condition: string;
  wanted_is_foil: boolean | null; // null = any, true = foil, false = non-foil
  wanted_quantity: number;

  cash_difference_huf: number;
  handover_methods: string[];
  description?: string | null;
  status: 'open' | 'on_hold' | 'completed' | 'cancelled';
  likes_count: number;
  views?: number;
  is_liked?: boolean;
  is_saved?: boolean;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceBulkListing {
  id: string;
  seller_id: string;
  seller_name: string;
  seller_avatar?: string | null;
  seller_country?: string;
  seller_role?: UserRole;
  seller_rating_avg?: number | null;
  seller_rating_count?: number;
  seller_tier?: number;
  title: string;
  game: string;
  exact_card_count: number | null;
  approx_card_count: number | null;
  condition: string;
  includes_foil: boolean;
  price_huf: number;
  handover_methods: string[];
  description?: string | null;
  images: string[];
  status: 'in_stock' | 'on_hold' | 'sold';
  likes_count: number;
  views?: number;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceAuctionBid {
  id: string;
  auction_id: string;
  bidder_id: string;
  bidder_name: string;
  bidder_avatar?: string | null;
  amount_huf: number;
  created_at: string;
}

export interface MarketplaceAuction {
  id: string;
  seller_id: string;
  seller_name: string;
  seller_avatar?: string | null;
  seller_country?: string;
  seller_role?: UserRole;
  seller_rating_avg?: number | null;
  seller_rating_count?: number;
  seller_tier?: number;
  card_id?: string | null;
  card?: CatalogCard | null;
  title: string;
  game: string;
  condition: string;
  is_foil: boolean;
  quantity: number;
  exact_card_count?: number | null;
  approx_card_count?: number | null;
  is_bulk?: boolean;
  images: string[];
  base_price_huf: number;
  bid_step_huf: number;
  current_bid_huf: number | null;
  bid_count: number;
  highest_bidder_id: string | null;
  highest_bidder_name: string | null;
  extension_minutes: number;
  starts_at: string;
  ends_at: string;
  handover_methods: string[];
  description?: string | null;
  status: 'active' | 'ended' | 'completed' | 'cancelled' | 'expired';
  conversation_id?: string | null;
  hold_request_id?: string | null;
  likes_count: number;
  views?: number;
  bids?: MarketplaceAuctionBid[];
  created_at: string;
  updated_at: string;
}

export interface CatalogCard {
  id: string;
  card_number: string;
  name: string;
  rarity: string;
  card_type: string;
  cost: number;
  image_path: string | null;
  set_id: string;
  set_name: string;
  set_code: string;
  sets?: { id: string; name: string; code: string };
  subtype?: string;
  text?: string;
  game: string;
  game_id?: string;
  metadata?: Record<string, any>;
  energy?: string;
  might?: string;
  domain?: string;
  tags?: any;
  ability?: string;
  /** Text of the separate effect box printed on gear (and a few spells). */
  effect?: string | null;
  /** Might a gear card grants to the unit it's attached to. */
  might_bonus?: number | null;
  artist?: string;
  market_price_eur?: number | null;
  market_price_foil_eur?: number | null;
  last_price_updated_at?: string | null;
}

export interface FilterState {
  category?: 'sealed' | 'singles' | 'all';
  game?: string;
  /** Card sets to include (set names). Empty means every set. */
  sets: string[];
  rarities: string[];
  type: string;
  domains: string[];
  tags: string[];
  /** Riftbound keywords (e.g. Deflect, Hidden, XP) matched against card ability/text. */
  keywords?: string[];
  /** "and": a card needs every selected keyword; "or": any one of them. */
  keywordMode?: 'and' | 'or';
  sealedTypes?: string[];
  costMin: number;
  costMax: number;
  stockStatus?: string;
  foilFilter?: boolean;
  signedFilter?: 'all' | 'only' | 'none';
  altArtFilter?: 'all' | 'only' | 'none';
  overnumberedFilter?: 'all' | 'only' | 'none';
  spFilter?: 'all' | 'only' | 'none';
  baseSetFilter?: 'all' | 'only';
  /** Restrict results to one seller's listings, e.g. from their public profile. */
  sellerId?: string;
  /** Only cards on this wishlist of the signed-in user (applied client-side: catalog, marketplace). */
  wishlistId?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export interface UserSocialProfiles {
  facebook_url?: string | null;
  discord_tag?: string | null;
  instagram_url?: string | null;
  cardmarket_username?: string | null;
  cardmarket_url?: string | null;
  cardmarket_sales?: number | null;
  facebook_ref_post_url?: string | null;
  verification_code?: string | null;
  verified?: boolean;
  updated_at?: string;
}

export interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  banner_url?: string | null;
  /** ISO 3166-1 alpha-2 country the user is based in (defaults to HU). */
  country?: string | null;
  role: UserRole;
  is_admin: boolean;
  is_owner?: boolean;
  /** Suspended accounts keep the catalog and store but lose the marketplace, seller hub and messages. */
  is_banned?: boolean;
  created_at?: string;
  social_profiles?: UserSocialProfiles;
}

export interface UserCard {
  id: string;
  user_id: string;
  card_id: string;
  owned_copies: number;
  foil_copies: number;
  for_sale_copies: number;
  unit_price: number | null;
  is_listed_in_store: boolean;
  created_at?: string;
  updated_at?: string;
  cards?: CatalogCard;
}

export interface SavedDeck {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  deck_data: any;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  inventory_id?: string;
  card_id: string;
  card_name: string;
  name?: string;
  card_number?: string;
  set_name?: string;
  condition: string;
  is_foil: boolean;
  price_huf: number;
  quantity: number;
  image_path?: string | null;
}

export interface Order {
  id: string;
  order_number: string;
  user_id: string;
  status: 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled';
  total_price_huf: number;
  total_huf?: number;
  /** Shipping the buyer paid, included in total_price_huf. */
  shipping_huf?: number;
  shipping_name?: string | null;
  shipping_address?: string | null;
  tracking_number?: string | null;
  courier_name?: string | null;
  shipping_label_url?: string | null;
  invoice_number?: string | null;
  invoice_status?: 'none' | 'pending' | 'issued' | 'failed' | null;
  invoice_url?: string | null;
  shipping_method?: string | null;
  payment_method?: string | null;
  payment_status?: 'pending' | 'paid' | 'refunded' | null;
  payment_id?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  deleted?: boolean | null;
  deleted_at?: string | null;
  notes?: string | null;
  items: OrderItem[];
  created_at: string;
  updated_at: string;
  seller_id?: string;
  seller_name?: string;
  seller_rating?: SellerReview | null;
  customer_info?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    postal_code?: string;
    country?: string;
    user_notes?: string;
    shipping_mode?: string;
    shipping_postal_code?: string;
    shipping_city?: string;
    shipping_street?: string;
    shipping_locker_code?: string;
    billing_name?: string;
    billing_tax_number?: string | null;
    billing_postal_code?: string;
    billing_city?: string;
    billing_street?: string;
    billing_country?: string;
  };
}

export interface SellerReview {
  id: string;
  order_id?: string;
  order_number: string;
  buyer_id: string;
  buyer_name?: string | null;
  buyer_avatar?: string | null;
  seller_id: string;
  rating: number; // 1 to 5
  comment?: string | null;
  created_at: string;
}

/** A rating one side of a completed trade gave the other (see lib/reviewCategories.ts). */
export interface TradeReview {
  id: string;
  order_number: string;
  reviewer_id: string;
  reviewee_id: string;
  direction: 'buyer_to_seller' | 'seller_to_buyer';
  /** Average of the category scores, 1.0 - 5.0. */
  rating: number;
  overall?: number;
  /** Per-category stars; null on reviews from before categories. */
  scores: Record<string, number> | null;
  comment: string | null;
  reviewer_name: string | null;
  reviewer_avatar: string | null;
  created_at: string;
}

/** How someone has been rated in one role. */
export interface Reputation {
  avg: number | null;
  count: number;
  categories: Record<string, { avg: number; count: number }>;
}

export interface TradeStats {
  salesCount: number;
  itemsSold: number;
  purchasesCount: number;
  itemsBought: number;
}

export interface UserReputation {
  reviews: TradeReview[];
  as_seller: Reputation;
  as_buyer: Reputation;
  stats: TradeStats;
}

export interface SellerProfileSummary {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  /** Rating as a seller. */
  rating_avg: number | null;
  rating_count: number;
  rating_categories?: Reputation['categories'];
  sales_count?: number;
  items_sold?: number;
  /** Rating as a buyer, and what they've bought. */
  buyer_rating_avg?: number | null;
  buyer_rating_count?: number;
  purchases_count?: number;
  items_bought?: number;
  is_owner?: boolean;
  created_at?: string | null;
}

/** One line item within a (possibly multi-card) hold request / cart checkout. */
export interface HoldRequestItem {
  inventory_id: string;
  card_name: string;
  card_number?: string;
  image_path?: string;
  price_huf: number;
  quantity: number;
  is_foil: boolean;
  condition: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  /** The specific purchase this message relates to, if any — null for general chat. */
  hold_request_id: string | null;
  sender_id: string;
  body: string;
  /** 'system' messages are auto-inserted purchase-lifecycle events (requested/held/sold/etc). */
  message_type: 'user' | 'system';
  metadata: Record<string, any> | null;
  read_at: string | null;
  created_at: string;
}

export interface ConversationSummary {
  conversation_id: string;
  counterpart_id: string;
  counterpart_name: string;
  card_name: string;
  image_path?: string | null;
  is_seller: boolean;
  /** True if the most recent hold request between these two is still pending/held. */
  has_open_request: boolean;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
}



export type StoreProductCategory =
  | 'sealed'
  | 'sleeves'
  | 'deck_boxes'
  | 'binders'
  | 'playmats'
  | 'protection'
  | 'storage'
  | 'dice'
  | 'accessories'
  | 'other';

export type StoreVariantKind = 'color' | 'set' | 'size' | 'language' | 'other';

export type StoreProductStatus = 'draft' | 'active' | 'archived' | 'out_of_stock';

export interface StoreProduct {
  id: string;
  name: string;
  slug: string;
  category: StoreProductCategory;
  brand: string;
  game: string | null;
  sku?: string | null;
  ean?: string | null;
  /** Products sharing a group are switchable on the product page (colours, sets, sizes). */
  variant_group?: string | null;
  variant_label?: string | null;
  variant_kind?: StoreVariantKind | null;
  /** Admin-only: never sent to non-admins. */
  supplier?: string | null;
  cost_price_huf?: number | null;
  price_huf: number;
  original_price_huf?: number | null;
  stock_quantity: number;
  status: StoreProductStatus;
  description?: string | null;
  images: string[];
  attributes: Record<string, any>;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}
