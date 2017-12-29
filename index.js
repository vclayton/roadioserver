/*
 * Total IO: 2048
 * Inputs: 44 (Switch points, occupancy detectors, push buttons)
 * Outputs: The rest (signals, gates, switch position indicators), 
 * 
 * Reading an input: write 8-bit address, toggle control line, read 8-bit data
 * Writing an output: write 8-bit address, set data to OUTPUT, write 8-bit data, toggle control line, set data to INPUT
 */

var express = require('express'); // The webserver library
var bodyParser = require('body-parser'); // An input parsing plugin for the webserver
var wpi = require('wiring-pi'); // The GPIO library
var EventEmitter = require('events').EventEmitter;
var messageBus = new EventEmitter();
messageBus.setMaxListeners(100);

var counter = 0;

const PIN_ON = wpi.LOW;
const PIN_OFF = wpi.HIGH;

var INPUT = 0;
var OUTPUT = 1;

const A0 = 17;
const A1 = 18;
const A2 = 23;
const A3 = 24;
const A4 = 25;
const A5 = 8;
const A6 = 7;
const A7 = 12;
const addrPins = [A0, A1, A2, A3, A4, A5, A6, A7];

const D0 = 16;
const D1 = 20;
const D2 = 21;
const D3 = 5;
const D4 = 6;
const D5 = 13;
const D6 = 19;
const D7 = 26;
const dataPins = [D0, D1, D2, D3, D4, D5, D6, D7];

const C_ENABLE = 2;
const C_READ = 3;
const C_WRITE = 4;
const controlPins = [C_ENABLE, C_READ, C_WRITE];


const inputBase = 0;
const inputLength = 6;
const outputBase = 6;
const outputLength = 250;

const In0 = 2;
var inputState = PIN_OFF;
var inputs = []; // Stores the current state of all the inputs
var outputs = []; // Stores the current state of all the outputs

for (var i = 0; i < inputLength * 8; i++) inputs[i] = 0;
// @todo It would be nice to store and load the output state to a file
for (var o = 0; o < outputLength * 8; o++) outputs[o] = 0;




// Initialize IO
wpi.setup('gpio');
setPinModes(addrPins, OUTPUT);
setPinModes(dataPins, OUTPUT);
setPinModes(controlPins, OUTPUT);

// GPIO functions
function toggleAddressPin(address) {
	wpi.digitalWrite(addrPins[address], PIN_ON);
}

// Given an array of pins, sets them all to mode
function setPinModes(pins, mode) {
	pins.forEach(function(pin) {
		wpi.pinMode(pin, mode);
	});
}

// Background IO polling, will run as often as possible
function pollInputButton() {
	var input = wpi.digitalRead(In0);
	if (input != inputState) {
		inputState = input;
		console.log('New inputState: ', inputState, pollTime, JSON.stringify(inputs));
		messageBus.emit('message', {
			timestamp: Date.now(),
			event: "input",
			inputs: inputs
		});
	}
}

// Given a byte of data, returns an array of 8 bits
function explodeBits(byte) {
	var bits = [];
	for (var b = 0; b < 8; b++) {
		bits[b] = byte & 0x01;
		byte = byte >> 1;
	}
	return bits;
}

// Given an array of 8 bits, returns 1 byte
function implodeBits(bits) {
	return bits.reduce(function (byte, bit) {
		return (byte << 1) | bit;
	}, 0);
}

// Todo: Could precalculate bit mask and PIN_ON/OFF stuff in a lookup table for speed
function writeByte(pins, byte) {
	wpi.digitalWrite(pins[0], byte & 0x01 ? PIN_ON : PIN_OFF);
	wpi.digitalWrite(pins[1], byte & 0x02 ? PIN_ON : PIN_OFF);
	wpi.digitalWrite(pins[2], byte & 0x04 ? PIN_ON : PIN_OFF);
	wpi.digitalWrite(pins[3], byte & 0x08 ? PIN_ON : PIN_OFF);
	wpi.digitalWrite(pins[4], byte & 0x10 ? PIN_ON : PIN_OFF);
	wpi.digitalWrite(pins[5], byte & 0x20 ? PIN_ON : PIN_OFF);
	wpi.digitalWrite(pins[6], byte & 0x40 ? PIN_ON : PIN_OFF);
	wpi.digitalWrite(pins[7], byte & 0x80 ? PIN_ON : PIN_OFF);
}

// Sets the address pins to match addr
function writeAddress(addr) {
	writeByte(addrPins, addr);
//console.log("Wrote address", addr);
}

// Sets the data pins to match dataByte
function writeData(dataByte) {
	writeByte(dataPins, data);
}

// Returns an 8 element array of 1 or 0
function readData() {
	return dataPins.map(function (dataPin) {
		return wpi.digitalRead(dataPin);
	});
}

function coinFlip() {
	return !!Math.round(Math.random());
}

function toggleControl() {
	wpi.digitalWrite(C_ENABLE, coinFlip() ? PIN_ON : PIN_OFF);
	wpi.digitalWrite(C_READ, coinFlip() ? PIN_ON : PIN_OFF);
	wpi.digitalWrite(C_WRITE, coinFlip() ? PIN_ON : PIN_OFF );
	wpi.digitalWrite(C_READ, coinFlip() ? PIN_ON : PIN_OFF);
}

var pollTime = 0;
// Reading an input: write 8-bit address, toggle control line, read 8-bit data 
function pollInputs() {
	var startTime = process.hrtime();
//	pollInputButton(); // Just for testing
	var addr, data, i = 0;
	for (var a = 0; a < inputLength; a++) {
		addr = inputBase + a;
		writeAddress(addr);
		toggleControl();
		data = readData();
		inputs[i++] = data[0];
		inputs[i++] = data[1];
		inputs[i++] = data[2];
		inputs[i++] = data[3];
		inputs[i++] = data[4];
		inputs[i++] = data[5];
		inputs[i++] = data[6];
		inputs[i++] = data[7];
	}
	var endTime = process.hrtime();
	pollTime = (endTime[0] - startTime[0]) * 1000000 + (endTime[1] - startTime[1]) / 1000;
	setImmediate(pollInputs);
}

// Writing an output: write 8-bit address, set data to OUTPUT, write 8-bit data, toggle control line, set data to INPUT
// Writes a byte of data to the given address
function writeOutput(addr, data) {
	writeAddress(addr);
	setPinModes(dataPins, OUTPUT);
	writeData(data);
	toggleControl();
	setPinModes(dataPins, INPUT);
}

// Given a logical output number and a value, sets the outputs correctly
function setOutput(outputNumber, value) {
	var addr = outputBase + (outputNumber >> 3);
	var outputByteBoundary = (outputNumber >> 3) << 3;
	var outputBits = outputs.slice(outputByteBoundary, 8);
	outputBits[outputNumber & 7] = value;
	writeOutput(addr, implodeBits(outputBits));
}


// Timed logic, if needed
var currentDataPin = 0;
function timerTick() {
	counter++;

//	currentDataPin = (currentDataPin + 1) & 7;
//	wpi.digitalWrite(dataPins[currentDataPin], inputState);

	console.log("Inputs: ", JSON.stringify(inputs));
}

setImmediate(pollInputs);
setInterval(timerTick, 100);





///////////////////////////////////
//////// Web server stuff
/////////////////////////////////
var port = 80;
var app = express();
app.use(bodyParser.urlencoded({extended: false}));

// Handler for main page
app.get('/', function(request, response) {
	response.sendFile('index.html', {root: __dirname});
});

// Handler for POST output
app.post ('/output', function(request, response) {
	var address = parseInt(request.body.address);
	toggleAddressPin(address);
	console.log('Setting output of address ', address, counter, inputState);
	if (request.body.html) {
		response.sendFile('index.html', {root: __dirname});
	} else {
		response.json({
			status: "ok",
			address: address,
			count: counter, // Todo: return a timestamp instead?
			input: inputState
		});
	}
});

// Handler for GET input
app.get('/input', function(request, response) {
	response.json({
		status: "ok",
		count: counter, // This would probably be more useful as a timestamp
		inputs: inputs
	});
});

// Handler for subscribing to the message bus
app.get('/messages', function(request, response) {
	var addListener = function(response) {
		messageBus.once('message', function(msgData) {
			response.json(msgData);
		});
	};
	addListener(response);
});

// Start http server
app.listen(port, function(err) {
	if (err) {
		return console.log('Could not start server', err);
	}
	console.log('Server is listening on port ' + port);
});


