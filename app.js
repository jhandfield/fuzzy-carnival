// Core Node services
const events = require("events");
const eventEmitter = new events.EventEmitter();
const http = require("http");
const rp = require("request-promise");

// Third-party libraries
const dateFormat = require("dateformat");
const winston = require("winston");
const express = require("express");
const expressWinston = require("express-winston");
const app = express();

// App configuration
const config = require("./config.json");

// Initialize the logger - logger will always begin with console logging, if the app is configured not to log it will be shut off later
const logger = new winston.Logger({
	level: "debug",
	transports: [
		new (winston.transports.Console)({
			timestamp: function() {
				return dateFormat(Date.now(), "HH:MM:ss");
			},
			formatter: function(options) {
				// Return string will be passed to logger.
				return options.timestamp() +' '+ options.level.toUpperCase() +' '+ (options.message ? options.message : '') +
				(options.meta && Object.keys(options.meta).length ? '\n\t'+ JSON.stringify(options.meta) : '' );
			}
		})
	]
});

// Configure the logger as per settings in the app configuration
if ((config.hasOwnProperty("logging") && config.logging.hasOwnProperty("enabled") && !config.logging.enabled) || !config.hasOwnProperty("logging"))
{
	logger.info("Disabling logging as per configuration");

	// Remove the console logger
	logger.remove(winston.transports.Console);
}
else {
	// Check if we should be logging to console
	if (config.hasOwnProperty("logging") && config.logging.hasOwnProperty("consoleLogging") && config.logging.consoleLogging)
	{
		// Override the default console level if specified
		if (config.hasOwnProperty("logging") && config.logging.hasOwnProperty("consoleLoggingLevel"))
		{
			logger.debug(`Setting console logging level to ${config.logging.consoleLoggingLevel} as per configuration`);

			// Just remove the console logger and readd it, seems simplest
			logger.remove(winston.transports.Console)
			.add(winston.transports.Console, {
				level: config.logging.consoleLoggingLevel,
				timestamp: function() {
						return dateFormat(Date.now(), "HH:MM:ss");
					},
					formatter: function(options) {
						// Return string will be passed to logger.
						return options.timestamp() +' '+ options.level.toUpperCase() +' '+ (options.message ? options.message : '') +
						(options.meta && Object.keys(options.meta).length ? '\n\t'+ JSON.stringify(options.meta) : '' );
					}
				}
			);
		}
	}

	// Check if we should enable file logging
	if (config.hasOwnProperty("logging") && config.logging.hasOwnProperty("fileLogging") && config.logging.fileLogging)
	{
		// Check for a logging level override; default otherwise
		var fileLoggingLevel = (config.hasOwnProperty("logging") && config.logging.hasOwnProperty("fileLoggingLevel")) ? config.logging.fileLoggingLevel : "info";

		// Check for a log filename override; default otherwise
		var fileLoggingFile = (config.hasOwnProperty("logging") && config.logging.hasOwnProperty("fileLoggingFile")) ? config.logging.fileLoggingFile : "log.txt";

		logger.info(`Enabling file logging at level ${fileLoggingLevel} to file ${fileLoggingFile}`);

		// Add a file logger
		logger.add(winston.transports.File, {
			level: fileLoggingLevel,
			filename: fileLoggingFile,
			json: false,
			timestamp: function() {
				return dateFormat(Date.now(), "HH:MM:ss");
			},
			formatter: function(options) {
				// Return string will be passed to logger.
				return options.timestamp() +' '+ options.level.toUpperCase() +' '+ (options.message ? options.message : '') +
				(options.meta && Object.keys(options.meta).length ? '\n\t'+ JSON.stringify(options.meta) : '' );
			}
		});
	}
	
	// Config must specify bridge.address
	if (!config.hasOwnProperty("bridge") || (config.hasOwnProperty("bridge") && (!config.bridge.hasOwnProperty("address") || (config.bridge.hasOwnProperty("address") && config.bridge.address.length < 1))))
	{
		logger.error("Your Hue Bridge's address must be specified in the configuration file as bridge.address; exiting.");
		process.exit(1);
	}
	
	// Config must specify bridge.Username
	if (!config.hasOwnProperty("bridge") || (config.hasOwnProperty("bridge") && (!config.bridge.hasOwnProperty("username") || (config.bridge.hasOwnProperty("username") && config.bridge.username.length < 1))))
	{
		logger.error("Your Hue Bridge's username must be specified in the configuration file as bridge.username; exiting.");
		process.exit(1);
	}

    // Report bridge address and username
    logger.info(`Hue Bridge specified at address ${config.bridge.address} with username ${config.bridge.username}`);
    
    // Test connectivity with the bridge
    rp.get({ uri: `http://${config.bridge.address}/api/${config.bridge.username}` })
        .then((res) => {
            // Parse the response
            let parsedResponse = JSON.parse(res);

            // Check for an error response in the body
            if (Array.isArray(parsedResponse) && parsedResponse[0].hasOwnProperty("error")) {
                logger.error(`Connection test to Hue Bridge failed - received error response: ${parsedResponse[0].error.description}`);
                process.exit(0);
            }
            // Connection test succeeded, continue setting up
            else {
                logger.info("Connection test to Hue Bridge succeeded.");
                logger.info(`Application finished initializing at ${dateFormat(Date.now(), "d mmm yyyy HH:MM:ss")}, beginning normal operation.`);

                // Finish configuring the app
                configureExpress();
            }
        })
        // Catch errors making the request (timeout, bad address, etc.)
        .catch((err) => {
            logger.silly(`Hue connection test error output: ${err}`);
            logger.error("Connection test to Hue Bridge failed - check your settings.");
            process.exit(1);
        });
}

function configureExpress() {
    // Basic test route, verifies that the application is working
    app.get('/', function (req, res) {
        res.send('Hello World!')
    })

    // Retrieve current status of users
    app.get('/users', (req, res) => {
        res.send(config.users);
    });

    // Update a user's state
    app.put('/user/:userId/:state', function (req, res) {
        // Test that we recognize the userId
        if (config.users.find(u => u.id === req.params.userId) == null) {
            logger.error(`No user with ID ${req.params.userId} exists.`);

            res.status(400);
            res.send(`No user exists with ID ${req.params.userId}`);
            return;
        }

        // Test that the state provided is valid
        if (req.params.state !== "home" && req.params.state !== "away") {
            logger.error(`Invalid state ${req.params.state} provided`);

            res.status(400);
            res.send(`Invalid user state "${req.params.state}" provided - state must be either "home" or "away"`);
            return;
        }

        // All is well - log the request and update the state
        const user = config.users.find(u => u.id === req.params.userId);
        const origState = user.state;
        const newState = req.params.state;

        logger.info(`Changing state of user ${req.params.userId} (${user.name}) from ${user.state} to ${req.params.state}`);

        // Update the user
        user.state = req.params.state;

        // Emit a userStateChanged event
        eventEmitter.emit("userStateChanged", user, origState, newState);

        // Send a response
        res.send("OK");
    });

    // Start Express
    app.listen(config.application.port, function () {
        logger.info(`Express listening for connections on port ${config.application.port}`);
    })
}

eventEmitter.on("userStateChanged", (user, oldState, newState) => {
	logger.debug(`userStateChanged event fired with params: user = ${JSON.stringify(user)}, oldState = ${oldState}, newState = ${newState}`);

	if (oldState === "home" && newState === "away") {
		// A user was home, but is now leaving - is anyone else still home?
		const usersHome = config.users.filter(u => u.state === "home");

		if (usersHome.length === 0)
			{
				// No users are home - shut lights off
				logger.debug("All users have left - shutting lights off.");

				changeLightState(4, false);
				changeLightState(7, false);
				changeLightState(8, false);
				changeLightState(9, false);
			}
	}
	else if (oldState === "away" && newState === "home") {
		// A user was away, but is now home - are they the first one?
		const usersHome = config.users.filter(u => u.state === "home");

		if (usersHome.length === 1)
			{
				// This is the first user home - turn on the lights
				logger.debug("This is the first user to come home - turning on the lights.");
				
				changeLightState(4, true);
				changeLightState(7, true);
				changeLightState(8, true);
				changeLightState(9, true);
			}
	}
	else
		logger.debug("Nothing interesting is going on.");
});

function changeLightState(lightID, state)
{
	logger.debug(`Changing state of light ${lightID} to ${state}`);

	const path = `/api/${config.hue.bridgeUsername}/lights/${lightID}/state`;
	const body = `{"on":${state}}`;

	makeHueRequest(path, body);
}

function makeHueRequest(path, body) {
	logger.silly(`Making request to hue at path ${path} with body ${body}`);

	const options = {
		hostname: config.hue.bridgeIP,
		port: 80,
		path: path,
		method: "PUT"
	};
	
	const req = http.request(options, (res) => {
		logger.silly(`Response from Hue Bridge with status code ${res.statusCode}`);
	});

	// Write the body
	req.write(body);
	req.end();
}