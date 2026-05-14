import { getSkinList } from '../utils/SkinLoader.js';

/**
 * ShopAPI manages the game's shop data and logic.
 * This can be extended to fetch data from a real backend API.
 */
class ShopAPI {
    constructor() {
        this.baseUrl = '/api'; // Placeholder for real API
    }

    /**
     * Fetches shop data including skins and currency offers.
     * Currently uses local SkinLoader but structured to support async API calls.
     * @returns {Promise<Object>} The shop data categorized.
     */
    async getShopData() {
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 50));

        const allSkins = getSkinList().map(s => ({ 
            ...s, 
            price: this._calculatePrice(s.id), 
            type: 'skin' 
        }));

        return {
            level: allSkins.filter(s => s.price < 5000), // Example logic
            owner: allSkins.filter(s => s.price >= 5000),
            premium: [], // Could be fetched from a special endpoint
            coins: [
                { id: 'coins_1000', name: '1000 Coins', price: 0.99, type: 'coins', amount: 1000 },
                { id: 'coins_5000', name: '5000 Coins', price: 3.99, type: 'coins', amount: 5000 },
                { id: 'coins_10000', name: '10000 Coins', price: 6.99, type: 'coins', amount: 10000 }
            ]
        };
    }

    /**
     * Internal helper to simulate different prices based on skin ID or some logic.
     */
    _calculatePrice(skinId) {
        // Just a simple deterministic "price" for now
        let hash = 0;
        for (let i = 0; i < skinId.length; i++) {
            hash = skinId.charCodeAt(i) + ((hash << 5) - hash);
        }
        const basePrice = Math.abs(hash % 10) * 500;
        return basePrice || 500; // Minimum 500
    }

    /**
     * Process a purchase request.
     * @param {string} itemId The ID of the item to purchase.
     * @param {number} currentCoins The user's current coin balance.
     * @returns {Promise<Object>} Result of the purchase.
     */
    async purchaseItem(item, currentCoins) {
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 100));

        if (item.type === 'coins') {
            // In a real app, this would involve a payment gateway redirect/verification
            return { success: true, coinsAdded: item.amount };
        }

        if (currentCoins >= item.price) {
            return { 
                success: true, 
                coinsDeducted: item.price,
                itemId: item.id
            };
        }

        return { success: false, error: 'Insufficient coins' };
    }
}

export default new ShopAPI();
