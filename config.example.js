// This is a sample configuration file

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

// The configuration for Influx
const database = {
    // For local we only have one node
    '0': {
        'host': '127.0.0.1',
        'port': 8086,
        'username': 'influx',
        'password': 'test',
        'database': 'cryptographic_trade_data',
        'table': 'market_trades',
    }
};

// Export configuration
module.exports = {
    exchanges: exchanges,
    database: database,
};