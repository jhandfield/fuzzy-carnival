const config = require("./config.json");
const dateFormat = require("dateformat");
const winston = require("winston");
const events = require("events");
const express = require("express");
const http = require("http");
const app = express();
const eventEmitter = new events.EventEmitter();

const appPort = 3000;		// Port the express app should listen on
const hueIP = "192.168.1.49";		// IP address of the Hue bridge
const hueUsername = "PlX16CEbg1u5iyZuxc-kie1cMPDbGn0-6zaKBGge";		// Username to use with the Hue API

// const users = [];
// users[0] = {
// 	id: "cfb78822e5f14e078dbd9e5ed3be35a3",
// 	name: "Justin",
// 	state: "home"
// };
// users[1] = {
// 	id: "c4bac848d6644c229b6b712630466a99",
// 	name: "Jannette",
// 	state: "home"
// }

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
			logger.info(`Setting console logging level to ${config.logging.consoleLoggingLevel} as per configuration`);

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

	logger.info(`Application finished initializing at ${dateFormat(Date.now(), "d mmm yyyy HH:MM:ss")}, beginning normal operation.`);
}

// DEFINE ROUTES
// Basic test route, verifies that the application is working
app.get('/', function (req, res) {
	res.send('Hello World!')
})

// Retrieve current status of users
app.get('/users', (req, res) => {
	res.send(users);
});

// Update a user's state
app.put('/user/:userId/:state', function (req, res) {
	
	console.log(`Updating user with user ID ${req.params.userId}`)

	// Test that we recognize the userId
	if (users.find(u => u.id === req.params.userId) == null)
		{
			console.log(`ERROR: No user with ID ${req.params.userId} exists.`);

			res.status(400);
			res.send(`No user exists with ID ${req.params.userId}`);
			return;
		}
	
	// Test that the state provided is valid
	if (req.params.state !== "home" && req.params.state !== "away")
		{
			console.log(`ERROR: Invalid state ${req.params.state} provided`);

			res.status(400);
			res.send(`Invalid user state "${req.params.state}" provided - state must be either "home" or "away"`);
			return;
		}

	// All is well - log the request and update the state
	var user = users.find(u => u.id === req.params.userId);
	var origState = user.state;
	var newState = req.params.state;

	console.log(`Changing state of user ${req.params.userId} (${user.name}) from ${user.state} to ${req.params.state}`);

	// Update the user
	user.state = req.params.state;

	// Emit a userStateChanged event
	eventEmitter.emit("userStateChanged", user, origState, newState);

	// Send a response
	res.send("OK");
});
// END DEFINE ROUTES

// Start Express
app.listen(appPort, function () {
	logger.info(`Express listening for connections on port ${config.application.port}`);
})

eventEmitter.on("userStateChanged", (user, oldState, newState) => {
	console.log(`DEBUG: userStateChanged event fired with params: user = ${JSON.stringify(user)}, oldState = ${oldState}, newState = ${newState}`);

	if (oldState === "home" && newState === "away") {
		// A user was home, but is now leaving - is anyone else still home?
		var usersHome = users.filter(u => u.state === "home");

		if (usersHome.length === 0)
			{
				// No users are home - shut lights off
				console.log("All users have left - shutting lights off.");

				changeLightState(5, false);
				changeLightState(6, false);
			}
	}
	else if (oldState === "away" && newState === "home") {
		// A user was away, but is now home - are they the first one?
		var usersHome = users.filter(u => u.state === "home");

		if (usersHome.length === 1)
			{
				// This is the first user home - turn on the lights
				console.log("This is the first user to come home - turning on the lights.");
				
				changeLightState(5, true);
				changeLightState(6, true);
			}
	}
	else
		console.log("Nothing interesting is going on.");
});

function changeLightState(lightID, state)
{
	const path = `/api/${hueUsername}/lights/${lightID}/state`;
	const body = `{"on":${state}}`;

	makeHueRequest(path, body);
}

function makeHueRequest(path, body) {
	console.log(`Making request to hue at path ${path} with body ${body}`);

	const options = {
		hostname: hueIP,
		port: 80,
		path: path,
		method: "PUT"
	};
	
	const req = http.request(options, (res) => {
		console.log(`Response from Hue Bridge with status code ${res.statusCode}`);
	});

	// Write the body
	req.write(body);
	req.end();
}