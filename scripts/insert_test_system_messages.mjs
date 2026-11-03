/**
 * Inserts comprehensive test system messages representing every single system transaction case
 * into the conversation between Noel (TCGXChange) and Cirmi.
 * All cards used are authentic Riftbound cards with matching image paths and titles verified in the database.
 * Run with: node --env-file=.env scripts/insert_test_system_messages.mjs
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || 'https://xtyfzkqubmzrsvduvzcl.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const CONVERSATION_ID = '76e4cf99-c808-482d-976d-60920cf12fde';
const NOEL_ID = 'd47ca466-6520-46ec-aff2-718732f1baf7';
const CIRMI_ID = '7cac994f-a9b1-4a8e-aa7c-1176181a7dff';

const BASE_TIME = Date.now() + 1000 * 60; // Slightly in the future so they land at the bottom of the thread

const TEST_CASES = [
  // 1. Hold Requested (Single Card)
  {
    order_number: 'TEST-HOLD-01',
    sender_id: NOEL_ID,
    message_type: 'system',
    body: 'Requested a hold on Ahri, Alluring — 3 500 Ft · Személyes átvétel',
    metadata: {
      action: 'requested',
      kind: 'hold',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: 'Ahri, Alluring',
      order_number: 'TEST-HOLD-01',
      price_huf: 3500,
      handover: 'personal',
      handover_details: 'Metagame Budapest, péntek 17:00',
      image_path: 'riftbound/ogn-066-298.webp',
      items: [
        {
          card_name: 'Ahri, Alluring',
          price_huf: 3500,
          quantity: 1,
          condition: 'Near Mint',
          is_foil: true,
          image_path: 'riftbound/ogn-066-298.webp',
        },
      ],
    },
  },

  // 2. Hold Reserved / Accepted
  {
    order_number: 'TEST-HOLD-02',
    sender_id: CIRMI_ID,
    message_type: 'system',
    body: 'Accepted the hold — this card is reserved.',
    metadata: {
      action: 'hold',
      kind: 'hold',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: 'Yasuo, Remorseful',
      order_number: 'TEST-HOLD-02',
      price_huf: 2800,
      handover: 'personal',
      image_path: 'riftbound/ogn-076-298.webp',
      items: [
        {
          card_name: 'Yasuo, Remorseful',
          price_huf: 2800,
          quantity: 1,
          condition: 'Excellent',
          is_foil: false,
          image_path: 'riftbound/ogn-076-298.webp',
        },
      ],
    },
  },

  // 3. Hold Handed Over / Sent (with tracking)
  {
    order_number: 'TEST-HOLD-03',
    sender_id: CIRMI_ID,
    message_type: 'system',
    body: 'Marked as handed over / sent (Tracking: FOXPOST-881234). The buyer has 3 days to confirm or deny before it auto-completes.',
    metadata: {
      action: 'mark_handed_over',
      kind: 'hold',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: 'Jinx, Demolitionist',
      order_number: 'TEST-HOLD-03',
      price_huf: 1500,
      handover: 'shipping',
      tracking_number: 'FOXPOST-881234',
      image_path: 'riftbound/ogn-030-298.webp',
      items: [
        {
          card_name: 'Jinx, Demolitionist',
          price_huf: 1500,
          quantity: 1,
          condition: 'Near Mint',
          is_foil: false,
          image_path: 'riftbound/ogn-030-298.webp',
        },
      ],
    },
  },

  // 4. Hold Tracking Updated
  {
    order_number: 'TEST-HOLD-04',
    sender_id: CIRMI_ID,
    message_type: 'system',
    body: 'Tracking number added: GLS-HU-902341',
    metadata: {
      action: 'update_tracking',
      kind: 'hold',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: 'Akali - Brash (Radiance November 2026 Summoner Skirmish Top 8 Promo)',
      order_number: 'TEST-HOLD-04',
      price_huf: 2200,
      handover: 'shipping',
      tracking_number: 'GLS-HU-902341',
      image_path: 'riftbound/rad-015-p.webp',
      items: [
        {
          card_name: 'Akali - Brash (Radiance November 2026 Summoner Skirmish Top 8 Promo)',
          price_huf: 2200,
          quantity: 1,
          condition: 'Near Mint',
          is_foil: true,
          image_path: 'riftbound/rad-015-p.webp',
        },
      ],
    },
  },

  // 5. Hold Completed / Sale Confirmed
  {
    order_number: 'TEST-HOLD-05',
    sender_id: NOEL_ID,
    message_type: 'system',
    body: 'Received the card — sale completed!',
    metadata: {
      action: 'confirm_sale',
      completed: true,
      kind: 'hold',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: 'Kai\'Sa, Survivor',
      order_number: 'TEST-HOLD-05',
      price_huf: 4500,
      handover: 'personal',
      image_path: 'riftbound/ogn-039-298.webp',
      items: [
        {
          card_name: 'Kai\'Sa, Survivor',
          price_huf: 4500,
          quantity: 1,
          condition: 'Near Mint',
          is_foil: true,
          image_path: 'riftbound/ogn-039-298.webp',
        },
      ],
    },
  },

  // 6. Hold Released (Cancelled)
  {
    order_number: 'TEST-HOLD-06',
    sender_id: NOEL_ID,
    message_type: 'system',
    body: 'Hold released — the card is back in stock.',
    metadata: {
      action: 'release',
      kind: 'hold',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: 'Zed, From the Shadows',
      order_number: 'TEST-HOLD-06',
      price_huf: 1800,
      handover: 'personal',
      image_path: 'riftbound/ven-023-166.webp',
      items: [
        {
          card_name: 'Zed, From the Shadows',
          price_huf: 1800,
          quantity: 1,
          condition: 'Played',
          is_foil: false,
          image_path: 'riftbound/ven-023-166.webp',
        },
      ],
    },
  },

  // 7. Hold Declined (Rejected by Seller)
  {
    order_number: 'TEST-HOLD-07',
    sender_id: CIRMI_ID,
    message_type: 'system',
    body: 'Hold request declined by seller.',
    metadata: {
      action: 'reject',
      kind: 'hold',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: 'Darius, Trifarian',
      order_number: 'TEST-HOLD-07',
      price_huf: 1900,
      handover: 'personal',
      image_path: 'riftbound/ogn-027-298.webp',
      items: [
        {
          card_name: 'Darius, Trifarian',
          price_huf: 1900,
          quantity: 1,
          condition: 'Near Mint',
          is_foil: false,
          image_path: 'riftbound/ogn-027-298.webp',
        },
      ],
    },
  },

  // 8. Trade Proposed (Swap layout)
  {
    order_number: 'TEST-TRADE-01',
    sender_id: NOEL_ID,
    message_type: 'system',
    body: 'Proposed a trade: Brazen Buccaneer for Flame Chompers',
    metadata: {
      action: 'trade_proposed',
      kind: 'trade',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: '[Trade] Brazen Buccaneer ⇄ Flame Chompers',
      offered_name: 'Brazen Buccaneer',
      offered_image: 'riftbound/ogn-002-298.webp',
      wanted_name: 'Flame Chompers',
      wanted_image: 'riftbound/ogn-006-298.webp',
      price_huf: 0,
      handover: 'personal',
      order_number: 'TEST-TRADE-01',
    },
  },

  // 9. Trade On Hold (Accepted)
  {
    order_number: 'TEST-TRADE-02',
    sender_id: CIRMI_ID,
    message_type: 'system',
    body: 'Trade proposal accepted — listing is on hold.',
    metadata: {
      action: 'hold',
      kind: 'trade',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: '[Trade] Blade of the Exile ⇄ Deceiver',
      offered_name: 'Blade of the Exile',
      offered_image: 'riftbound/rad-150.webp',
      wanted_name: 'Deceiver',
      wanted_image: 'riftbound/unl-235-219.webp',
      price_huf: 500,
      handover: 'personal',
      order_number: 'TEST-TRADE-02',
    },
  },

  // 10. Trade Handed Over / Sent
  {
    order_number: 'TEST-TRADE-03',
    sender_id: CIRMI_ID,
    message_type: 'system',
    body: 'Marked trade cards handed over / sent (Tracking: PACKETA-112233). Proposer has 3 days to confirm.',
    metadata: {
      action: 'mark_handed_over',
      kind: 'trade',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: '[Trade] Irelia, Fervent ⇄ Disintegrate',
      offered_name: 'Irelia, Fervent',
      offered_image: 'riftbound/sfd-057-221.webp',
      wanted_name: 'Disintegrate',
      wanted_image: 'riftbound/ogn-005-298.webp',
      tracking_number: 'PACKETA-112233',
      price_huf: 0,
      handover: 'shipping',
      order_number: 'TEST-TRADE-03',
    },
  },

  // 11. Trade Completed (Csere lezárult)
  {
    order_number: 'TEST-TRADE-04',
    sender_id: NOEL_ID,
    message_type: 'system',
    body: 'Received trade cards — trade completed successfully!',
    metadata: {
      action: 'confirm_sale',
      completed: true,
      kind: 'trade',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: '[Trade] Chemtech Enforcer ⇄ Thrill of the Hunt',
      offered_name: 'Chemtech Enforcer',
      offered_image: 'riftbound/ogn-003-298.webp',
      wanted_name: 'Thrill of the Hunt',
      wanted_image: 'riftbound/unl-184-219.webp',
      price_huf: 0,
      handover: 'personal',
      order_number: 'TEST-TRADE-04',
    },
  },

  // 12. Trade Declined (Rejected)
  {
    order_number: 'TEST-TRADE-05',
    sender_id: CIRMI_ID,
    message_type: 'system',
    body: 'Trade proposal declined — listing returned to marketplace.',
    metadata: {
      action: 'reject',
      kind: 'trade',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: '[Trade] Elder Dragon ⇄ Blazing Scorcher',
      offered_name: 'Elder Dragon',
      offered_image: 'riftbound/unl-118a-219.webp',
      wanted_name: 'Blazing Scorcher',
      wanted_image: 'riftbound/ogn-001-298.webp',
      price_huf: 0,
      handover: 'personal',
      order_number: 'TEST-TRADE-05',
    },
  },

  // 13. Auction Won (Megnyert aukció)
  {
    order_number: 'TEST-AUCT-01',
    sender_id: NOEL_ID,
    message_type: 'system',
    body: '[Auction Won] Blade of the Exile — Winning bid: 1 200 Ft',
    metadata: {
      action: 'auction_won',
      kind: 'auction',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: '[Auction] Blade of the Exile',
      price_huf: 1200,
      handover: 'personal',
      order_number: 'TEST-AUCT-01',
      image_path: 'riftbound/rad-150.webp',
      items: [
        {
          card_name: 'Blade of the Exile',
          price_huf: 1200,
          quantity: 1,
          condition: 'Near Mint',
          image_path: 'riftbound/rad-150.webp',
        },
      ],
    },
  },

  // 14. Auction Cancelled by Seller (with 1-star review penalty warning)
  {
    order_number: 'TEST-AUCT-02',
    sender_id: CIRMI_ID,
    message_type: 'system',
    body: 'Auction cancelled by seller ("Cleave"). Because the seller did not honor the winning bid of 600 Ft, an automatic 1-star system review has been recorded on the seller\'s profile.',
    metadata: {
      action: 'auction_cancelled',
      kind: 'auction',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: '[Auction] Cleave',
      price_huf: 600,
      handover: 'personal',
      order_number: 'TEST-AUCT-02',
      image_path: 'riftbound/ogn-004-298.webp',
      items: [
        {
          card_name: 'Cleave',
          price_huf: 600,
          quantity: 1,
          condition: 'Near Mint',
          image_path: 'riftbound/ogn-004-298.webp',
        },
      ],
    },
  },

  // 15. Bulk Lot Requested
  {
    order_number: 'TEST-BULK-01',
    sender_id: NOEL_ID,
    message_type: 'system',
    body: 'Bulk Hold Request: 150 Common/Uncommon Cards — 5 000 Ft',
    metadata: {
      action: 'requested',
      kind: 'bulk',
      seller_id: CIRMI_ID,
      buyer_id: NOEL_ID,
      card_name: '[Bulk] 150 Common/Uncommon Cards',
      price_huf: 5000,
      handover: 'shipping',
      order_number: 'TEST-BULK-01',
      items: [
        {
          card_name: '150 C/UC Cards Bundle',
          price_huf: 5000,
          quantity: 1,
        },
      ],
    },
  },

  // 16. Store Order Processing
  {
    order_number: 'TEST-STORE-01',
    sender_id: NOEL_ID,
    message_type: 'system',
    body: 'Official Webshop Order #TEST-STORE-01',
    metadata: {
      store_order: true,
      order_number: 'TEST-STORE-01',
      status: 'Processing',
      total_price_huf: 49280,
      items: [
        { name: 'Riftbound: Radiance Booster Display (24 Packs)', quantity: 1, unit_price_huf: 44990 },
        { name: 'Ultimate Guard Katana Sleeves Standard (100) - Crimson Red', quantity: 1, unit_price_huf: 4290 },
      ],
    },
  },

  // 17. Store Order Shipped with Tracking
  {
    order_number: 'TEST-STORE-02',
    sender_id: NOEL_ID,
    message_type: 'system',
    body: 'Webshop order shipped with tracking',
    metadata: {
      store_order: true,
      is_tracking_update: true,
      order_number: 'TEST-STORE-02',
      status: 'Shipped',
      courier_name: 'GLS Hungary',
      tracking_number: 'GLS-TEST-99887766',
    },
  },

  // 18. Store Order Delivered
  {
    order_number: 'TEST-STORE-03',
    sender_id: NOEL_ID,
    message_type: 'system',
    body: 'Official Webshop Order #TEST-STORE-03',
    metadata: {
      store_order: true,
      order_number: 'TEST-STORE-03',
      status: 'Delivered',
      total_price_huf: 16990,
      items: [
        { name: 'Riftbound: Radiance - Vault Bundle', quantity: 1, unit_price_huf: 16990 },
      ],
    },
  },
];

async function run() {
  console.log(`Inserting ${TEST_CASES.length} verified Riftbound test system messages into conversation ${CONVERSATION_ID}...`);

  const rows = TEST_CASES.map((tc, idx) => ({
    conversation_id: CONVERSATION_ID,
    sender_id: tc.sender_id,
    message_type: tc.message_type,
    body: tc.body,
    hold_request_id: null,
    metadata: tc.metadata,
    created_at: new Date(BASE_TIME + idx * 1000 * 30).toISOString(),
  }));

  const { data, error } = await sb.from('hold_request_messages').insert(rows).select('id');
  if (error) {
    console.error('Failed to insert test messages:', error);
    process.exit(1);
  }

  console.log(`Successfully inserted ${data.length} test messages with verified Riftbound images!`);
}

run();
