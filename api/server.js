'use strict';

// We're all Hapi here!
const Hapi = require('hapi');
const Nes = require('nes');
const readline = require('readline');

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
let wsClients = [];

// Server termination function
function terminate() {
    console.log('Shutting down...');

    // TODO: Unsubscribe from WebSocket feeds

    console.log('Shutdown complete, process terminating.');

    // Terminate
    process.exit(0);
}

// Server initialization
async function start() {
    try {
        await apiServer.register(Nes);

        // TODO: Add routes

        // Load list of exchanges and currency pairs from the configuration file
        let exchanges = config.exchanges;

        // TODO: Subscribe to exchange feeds

        // Start the server
        await apiServer.start();
        console.log('Server running on', apiServer.info.uri, "\r\n");

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
    }
    catch (err) {
        console.log('Error was encountered', err);
        process.exit(1);
    }
}

// Run the server
start();


