// The exchanges to pull data from, along with the associated cryptocurrency pairs
const exchanges = {
    // GDAX/Coinbase
    'gdax': {
        'wsFeed': 'wss://ws-feed-public.sandbox.gdax.com', // This is expected to be a WebSocket feed
        'currency': [
            'BTC-USD', // Bitcoin/USD
            'BCH-USD', // Bitcoin Cash/USD
            'ETH-USD', // Ethereum/USD
            'LTC-USD', // Litecoin/USD
        ],
    },

    // TODO: Add more exchanges at a later time...
};

// Export configuration
module.exports = exchanges;