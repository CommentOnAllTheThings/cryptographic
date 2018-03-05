'use strict';

// We're all Hapi here!
const Hapi = require('hapi');
const Nes = require('nes');
const readline = require('readline');

// Load the Influx client
const Influx = require('influx');

// Include Cryptocurrency exchange libraries
const Gdax = require('gdax');

// Load configuration file
const config = require('../config');

// Initialize our API server
const apiServer = Hapi.server({
    host: 'localhost',
    port: 8000
});

// Create out readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
});

// Keep track of all the WebSocket clients we are using so we can clean up when the server is killed
let wsClients = {};

// Server termination function
function terminate() {
    console.log('Shut down initiated.');

    // Unsubscribe from WebSocket feeds
    for (let exchangeName in wsClients) {
        if (wsClients.hasOwnProperty(exchangeName)) {
            switch (exchangeName.toLowerCase()) {
                case 'gdax':
                    console.log('Removing GDAX subscriptions.');

                    // Get WebSocket data
                    let webSocketData = wsClients[exchangeName];

                    // Check for WebSocket and subscriptions
                    if (!webSocketData.hasOwnProperty('ws') || isEmpty(webSocketData.ws)) {
                        console.log('No WebSocket for GDAX found.');
                        continue;
                    } else if (!webSocketData.hasOwnProperty('subscriptions') || isEmpty(webSocketData.subscriptions)) {
                        console.log('No Subscriptions for GDAX found.');
                        continue;
                    }

                    // Get WebSocket
                    let webSocket = webSocketData.ws;

                    // Unsubscribe from subscriptions
                    webSocket.unsubscribe(webSocketData.subscriptions);
                    delete wsClients[exchangeName];

                    console.log('Done removing GDAX subscriptions.');

                    // Close database server connection
                    if (!webSocketData.hasOwnProperty('database') || isEmpty(webSocketData.database)) {
                        console.log('Closing database connection.');
                        // TODO: Add cleanup for database
                    }

                    break;
                default:
                    console.log('Exchange ' + exchangeName + ' cleanup not implemented.');
                    break;
            }
        }
    }

    console.log('Shutdown complete, process terminating.');

    // Terminate
    process.exit(0);
}

// Checks a field to determine if it is one of the following:
// i) null
// ii) undefined
// iii) length = 0
function isEmpty(value) {
    return value === null || value === undefined || value.length === 0;
}

// Server initialization
async function start() {
    try {
        // Get database config
        let dbConfig = config.database;

        // Check for database configuration information
        if (isEmpty(dbConfig)) {
            console.log('No database configuration parameters specified in configuration file.');
            process.exit(1);
        }

        // Get first entry
        if (isEmpty(dbConfig[0]) || // Check for config
            isEmpty(dbConfig[0].host) || // Check for IP
            isEmpty(dbConfig[0].port) || // Check for Port
            isEmpty(dbConfig[0].username) || // Check for Username
            isEmpty(dbConfig[0].password) || // Check for Password
            isEmpty(dbConfig[0].database) || // Check for Database
            isEmpty(dbConfig[0].table)) { // Check for Table
            console.log('Missing database configuration parameter(s) in configuration file.');
            process.exit(1);
        }

        // Initialize Influx
        const influx = new Influx.InfluxDB({
            host: dbConfig[0].host,
            port: dbConfig[0].port,
            username: dbConfig[0].username,
            password: dbConfig[0].password,
            database: dbConfig[0].database,
            schema: [
                {
                    measurement: dbConfig[0].table,
                    fields: {
                        // The exchange identifier
                        exchange: Influx.FieldType.STRING,

                        // The exchange transaction unique identifier (ie. unique id)
                        transaction_id: Influx.FieldType.STRING,

                        // The currency pairing (ie. XXX-YYY)
                        pair: Influx.FieldType.STRING,

                        // The first currency pairing (ie. XXX in XXX-YYY)
                        sourcePair: Influx.FieldType.STRING,

                        // The second currency pairing (ie. YYY in XXX-YYY)
                        destinationPair: Influx.FieldType.STRING,

                        // The action (ie. buy or sell)
                        action: Influx.FieldType.STRING,

                        // The unit (ie. how many were traded (bought/sold)?)
                        unit: Influx.FieldType.FLOAT,

                        // The price (in $)
                        price: Influx.FieldType.FLOAT,

                        // The timestamp reported by the exchange
                        exchange_timestamp: Influx.FieldType.STRING,
                    },
                    tags: [
                        'host'
                    ]
                }
            ]
        });

        // Register hapines plugin
        await apiServer.register(Nes);

        // Create the possible subscriptions (ie. /{cryptocurrency}/{currency} -- Cryptocurrency TO Currency)
        apiServer.subscription('/BTC/{currency}'); // Bitcoin-Currency
        apiServer.subscription('/BCH/{currency}'); // Bitcoin Cash-Currency
        apiServer.subscription('/ETH/{currency}'); // Ethereum-Currency
        apiServer.subscription('/LTC/{currency}'); // Litecoin-Currency

        // Add status route
        apiServer.route({
            method: 'GET',
            path: '/status',
            config: {
                id: 'status',
                handler: (request, h) => influx.query(`SELECT COUNT(transaction_id) as number_rows FROM ${dbConfig[0].table};`).then((results) => {
                    // Get number of rows
                    let numberRows = 0;
                    if (!isEmpty(results[0]) &&
                        results[0].number_rows !== null &&
                        results[0].number_rows !== undefined) {
                        numberRows = results[0].number_rows;
                    }

                    return {
                        'status': 'operational',
                        'results': numberRows,
                    };
                }).catch((error) => {
                    return {
                        'status': 'operational',
                        'results': 'error'
                    };
                })
            }
        });

        // Add last trade route
        apiServer.route({
            method: 'GET',
            path: '/last',
            config: {
                id: 'lastTrades',
                handler: (request, h) => influx.query(`SELECT exchange, pair, action, unit, price FROM ${dbConfig[0].table} GROUP BY pair ORDER BY time DESC LIMIT 10;`).then((results) => {
                    return {
                        'results': results,
                    };
                }).catch((error) => {
                    return {
                        'results': 'error'
                    };
                })
            }
        });

        // Start the server
        await apiServer.start();
        console.log('Server running on', apiServer.info.uri, "\r\n");

        // Load list of exchanges and currency pairs from the configuration file
        let exchanges = config.exchanges;

        // Check for exchange configuration information
        if (isEmpty(exchanges)) {
            console.log('No exchanges specified in configuration file.');
            process.exit(1);
        }

        // Initialize database
        influx.getDatabaseNames()
            .then(names => {
                // Check if database exists
                if (!names.includes(dbConfig[0].database)) {
                    // Create it, since it doesn't exist
                    console.log(`Creating database ${dbConfig[0].database}`);
                    return influx.createDatabase(dbConfig[0].database);
                }
            })
            .then(() => {
                // All ready to go!
                // Subscribe to exchange feeds
                for (let exchangeName in exchanges) {
                    if (exchanges.hasOwnProperty(exchangeName)) {
                        // Get exchange configuration
                        let exchangeData = exchanges[exchangeName];

                        // Check for WebSocket feed address
                        if (!exchangeData.hasOwnProperty('wsFeed') || isEmpty(exchangeData.wsFeed)) {
                            console.log('No WebSocket feed provided for ' + exchangeName + '.');
                            continue;
                        }

                        // Check for currencies
                        if (!exchangeData.hasOwnProperty('currency') || isEmpty(exchangeData.currency)) {
                            console.log('No currencies provided for ' + exchangeName + '.');
                            continue;
                        }

                        // Determine which library to use depending on the exchange
                        switch (exchangeName) {
                            case 'gdax':
                                // Get product types via GDAX Public API Client
                                const publicClient = new Gdax.PublicClient();
                                publicClient.getProducts()
                                    .then((products) => {
                                        // We are expecting to get an array of "products" which is really just a list of Cryptocurrency pairs
                                        if (products instanceof Array) {
                                            // Validate list of currencies from the config against the ones available on the exchange
                                            let validCryptocurrencyPairs = [];

                                            // Process list of products
                                            products.forEach((value) => {
                                                // Check that each product is set and has an id which is our Cryptocurrency pair
                                                if (!isEmpty(value) && !isEmpty(value.id)) {
                                                    if (exchangeData.currency.indexOf(value.id) !== -1 && // See if the Cryptocurrency is in the config
                                                        validCryptocurrencyPairs.indexOf(value.id) === -1) { // Only add pairs once
                                                        // Add pair
                                                        validCryptocurrencyPairs.push(value.id);
                                                    }
                                                }
                                            });

                                            // We need at least one valid pair to poll the API with
                                            if (validCryptocurrencyPairs.length > 0) {
                                                // Create subscription request
                                                let subscriptions = {
                                                    product_ids: validCryptocurrencyPairs,
                                                    channels: ['ticker'],
                                                };

                                                // Create WebSocket
                                                const gdaxWebsocket = new Gdax.WebsocketClient(subscriptions.product_ids, exchangeData.wsFeed, null, { channels: subscriptions.channels });

                                                // Keep track of subscriptions
                                                wsClients.gdax = {
                                                    ws: gdaxWebsocket,
                                                    subscriptions: subscriptions,
                                                    database: influx,
                                                };

                                                // Handlers for the GDAX WebSocket
                                                gdaxWebsocket.on('message', (data) => {
                                                    // Filter to only display ticker
                                                    if (!isEmpty(data.type)) {
                                                        if (data.type === 'ticker') {
                                                            // Each WebSocket message only has one trade
                                                            // Check that the ticker has an actual trade
                                                            if (isEmpty(data.sequence) ||
                                                                isEmpty(data.product_id) ||
                                                                isEmpty(data.side) ||
                                                                isEmpty(data.last_size) ||
                                                                isEmpty(data.price) ||
                                                                isEmpty(data.time)) {
                                                                // Skip processing
                                                                return;
                                                            }

                                                            // Split the pairing by "-"
                                                            // So example BCH-USD becomes BCH and USD
                                                            let pairings = data.product_id.split('-');
                                                            if (pairings.length > 1 && // Need at least two components to get the crypto pair
                                                                pairings[0].length > 0 && // Make sure source pair is not empty
                                                                pairings[1].length > 0) { // Make sure destination pair is not empty
                                                                // Send updates to clients via WebSocket
                                                                apiServer.publish(
                                                                    `/${pairings[0].toUpperCase()}/${pairings[1].toUpperCase()}`,
                                                                    {
                                                                        exchange: exchangeName.toLowerCase(),
                                                                        action: data.side.toLowerCase(),
                                                                        unit: Number.parseFloat(data.last_size),
                                                                        price: Number.parseFloat(data.price),
                                                                    }
                                                                );

                                                                // Save to database
                                                                influx.writePoints([
                                                                    {
                                                                        measurement: dbConfig[0].table,
                                                                        tags: { host: dbConfig[0].host },
                                                                        fields: {
                                                                            exchange: exchangeName.toLowerCase(),
                                                                            transaction_id: Number.parseInt(data.sequence),
                                                                            pair: data.product_id.toUpperCase(),
                                                                            sourcePair: pairings[0].toUpperCase(),
                                                                            destinationPair: pairings[1].toUpperCase(),
                                                                            action: data.side.toLowerCase(),
                                                                            unit: Number.parseFloat(data.last_size),
                                                                            price: Number.parseFloat(data.price),
                                                                            exchange_timestamp: data.time,
                                                                        },
                                                                    }
                                                                ]).then((result) => {
                                                                    // TODO: Handle Success
                                                                }).catch((error) => {
                                                                    // TODO: Handle Error
                                                                    console.log(`Influx error while writing point ${error}`);
                                                                });
                                                            }
                                                        } else if (data.type === 'heartbeat') {
                                                            // TODO: Verify that trades were all retrieved
                                                        }
                                                    }
                                                });
                                                gdaxWebsocket.on('error', (error) => {
                                                    console.log('Error returned from GDAX WebSocket: ' + error);
                                                });
                                            } else {
                                                console.log('No valid Cryptocurrency pairs found.');
                                            }
                                        }
                                    }).catch((error) => {
                                    console.log('Error returned from GDAX Public Client: ' + error);
                                });
                                break;
                            default:
                                console.log('Exchange "' + exchangeName + '" not implemented');
                                break;
                        }
                    }
                }

                // Get terminal prompt
                rl.prompt();

                // Bind to 'line' and 'close' events
                rl.on('line', (line) => {
                    // User entered input line
                    switch (line.trim().toLowerCase()) {
                        case 'exit':
                        case 'quit':
                        case 'terminate':
                            terminate();
                            break;
                        default:
                            console.log(`Unknown command '${line.trim()}'. Possible commands are \'exit\', \'quit\' and \'terminate\'`);

                            // Only prompt when they haven't killed the server yet
                            rl.prompt();
                            break;
                    }
                }).on('close', terminate); // User hit CTRL+C or input stream killed
            })
            .catch(err => {
                console.error(`Could not create Influx database: ${err}`);
                process.exit(1);
            });
    }
    catch (err) {
        console.log('Error was encountered', err);
        process.exit(1);
    }
}

// Run the server
start();


