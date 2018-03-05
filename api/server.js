'use strict';

// We're all Hapi here!
const Hapi = require('hapi');
const Nes = require('nes');
const readline = require('readline');

// Load the Riak client
const Riak = require('basho-riak-client');

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
                        webSocketData.database.stop((err, rslt) => {
                            if (!isEmpty(err)) {
                                console.log('Error encountered while closing database connection: ' + err);
                            }
                        });
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
            return;
        }

        // Get first entry
        if (isEmpty(dbConfig[0]) || // Check for config
            isEmpty(dbConfig[0].ip) || // Check for IP
            isEmpty(dbConfig[0].port) || // Check for port
            isEmpty(dbConfig[0].table)) { // Check for table
            console.log('Missing database configuration parameter(s) in configuration file.');
            return;
        }

        // Get table name
        let dbTable = dbConfig[0].table;

        // Build connection string
        let dbConnectionStr = `${dbConfig[0].ip}:${dbConfig[0].port}`;

        // Register hapines plugin
        await apiServer.register(Nes);

        // Create the possible subscriptions (ie. /{cryptocurrency}/{currency} -- Cryptocurrency TO Currency)
        apiServer.subscription('/btc/{currency}'); // Bitcoin-Currency
        apiServer.subscription('/bch/{currency}'); // Bitcoin Cash-Currency
        apiServer.subscription('/eth/{currency}'); // Ethereum-Currency
        apiServer.subscription('/ltc/{currency}'); // Litecoin-Currency

        // Start the server
        await apiServer.start();
        console.log('Server running on', apiServer.info.uri, "\r\n");

        // Load list of exchanges and currency pairs from the configuration file
        let exchanges = config.exchanges;

        // Check for exchange configuration information
        if (isEmpty(exchanges)) {
            console.log('No exchanges specified in configuration file.');
            return;
        }

        // Connect to database server
        new Riak.Client([dbConnectionStr], (error, client) => {
            if (isEmpty(error)) {
                // TODO: Figure out how to call StartTls to initiate a secure connection to Riak
                if (!isEmpty(client)) {
                    // Create table
                    let cmd = new Riak.Commands.TS.Query.Builder()
                        .withQuery("CREATE TABLE " + dbTable + " ( \
                                    sequence SINT64 NOT NULL, \
                                    exchange VARCHAR NOT NULL, \
                                    currency_pair VARCHAR NOT NULL, \
                                    action VARCHAR NOT NULL, \
                                    size DOUBLE NOT NULL, \
                                    price DOUBLE NOT NULL, \
                                    trade_time TIMESTAMP NOT NULL, \
                                    PRIMARY KEY ( \
                                        (sequence, QUANTUM(trade_time, 15, 'm')), \
                                        sequence, trade_time \
                                    )\
                                );"
                        )
                        .withCallback((error, result) => {
                            // Handle error
                            if (!isEmpty(error)) {
                                console.log('Riak Create Table Error: ' + error);
                            } else {
                                console.log(result);
                            }
                        })
                        .build();

                    client.execute(cmd);
                }

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
                                                    database: client,
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

                                                            // TODO: Determine table structure and data to be saved to the database
                                                            let row = [
                                                                [
                                                                    data.sequence,
                                                                    exchangeName.toLowerCase(),
                                                                    data.product_id.toUpperCase(),
                                                                    data.side.toLowerCase(),
                                                                    data.last_size,
                                                                    data.price,
                                                                    Date.parse(data.time) // Convert ISO 8601 to timestamp
                                                                ]
                                                            ];

                                                            // Store the trade if Riak is available
                                                            if (!isEmpty(client) && row.length > 0) {
                                                                let cmd = new Riak.Commands.TS.Store.Builder()
                                                                    .withTable(dbTable)
                                                                    .withRows(row)
                                                                    .withCallback((error, result) => {
                                                                        // Handle error
                                                                        if (!isEmpty(error)) {
                                                                            console.log('Riak Command Error: ' + error);
                                                                        } else {
                                                                            console.log(result);
                                                                        }
                                                                    })
                                                                    .build();

                                                                client.execute(cmd);
                                                            }
                                                        } else if (data.type === 'heartbeat') {
                                                            // TODO: Verify that trades were all retrieved
                                                        }
                                                    }
                                                });
                                                gdaxWebsocket.on('error', (error) => {
                                                    // TODO: Log errors
                                                    console.log('Error returned from GDAX WebSocket: ' + error);
                                                });
                                            } else {
                                                console.log('No valid Cryptocurrency pairs found.');
                                            }
                                        }
                                    }).catch((err) => {
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
            } else {
                // Terminate
                console.log('Riak Client Error: ' + error);
                process.exit(1);
            }
        });
    }
    catch (err) {
        console.log('Error was encountered', err);
        process.exit(1);
    }
}

// Run the server
start();


