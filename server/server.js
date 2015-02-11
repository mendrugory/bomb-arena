TILE_SIZE = 40;

// Dependencies
var util = require('util');
var express = require('express');
var app = express();
var server = require('http').createServer(app);
var socket = require('socket.io').listen(server);

// Game objects
var Player = require('./entities/player');
var Bomb = require('./entities/bomb');
var Map = require('./entities/map');
var Game = require('./entities/game');

var games = {};

// Game Variables
var socket;

var spawnLocations = {
	1: [{x: 2, y: 5}, {x: 13, y: 1}, {x: 2, y: 1}, {x: 12, y: 6}]
};

var updateInterval = 100; // Broadcast updates every 100 ms.

app.use(express.static('client'));
server.listen(process.env.PORT || 8000);

init();

function init() {
	//This is the first stage - eventually the games will be created via the lobby.
	var game = new Game();
	games[123] = game;

	// Begin listening for events.
	setEventHandlers();

	// Start game loop
	setInterval(broadcastingLoop, updateInterval);
};

function setEventHandlers () {
	socket.sockets.on("connection", function(client) {
		util.log("New player has connected: " + client.id);

		client.on("new player", onNewPlayer);

		client.on("move player", onMovePlayer);

		client.on("disconnect", onClientDisconnect);

		client.on("place bomb", onPlaceBomb);

		client.on("register map", onRegisterMap);
	});
};

function onClientDisconnect() {
	util.log("Player has disconnected: " + this.id);

	var game = games[this.gameId];

	if(this.id in players) {
		spawnLocations[1].push(game.players[this.id].spawnPoint);
		delete game.players[this.id];

		socket.sockets.emit("remove player", {id: this.id});	
	}
};

function onRegisterMap(data) {
	games[this.gameId].map = new Map(data, TILE_SIZE);
};

function onNewPlayer(data) {
	if(spawnLocations[1].length == 0) {
		return;
	}

	var spawnPoint = spawnLocations[1].shift();

	// This is temporary.
	this.gameId = 123;
	this.join(123);
	var game = games[123];

	// Create new player
	var newPlayer = new Player(spawnPoint.x * TILE_SIZE, spawnPoint.y * TILE_SIZE, 'down', this.id);
	newPlayer.spawnPoint = spawnPoint;

	// Broadcast new player to connected socket clients
	this.broadcast.to(123).emit("new player", newPlayer);

	this.emit("assign id", {x: newPlayer.x, y: newPlayer.y, id: this.id});

	// Notify the new player of the existing players.
	for(var i in game.players) {
		this.emit("new player", game.players[i]);
	}
	
	game.players[this.id] = newPlayer;
	game.bombs[this.id] = {};
};

function onMovePlayer(data) {
	var game = games[this.gameId];

	var movingPlayer = game.players[this.id];

	// Moving player can be null if a player is killed and leftover movement signals come through.
	if(!movingPlayer) {
		return;
	}

	movingPlayer.x = data.x;
	movingPlayer.y = data.y;
	movingPlayer.facing = data.facing;
};

function onPlaceBomb(data) {
	var game = games[this.gameId];
	var gameId = this.gameId;

	var bombId = data.id;
	var playerId = this.id;

	var normalizedBombLocation = game.map.findNearestTileCenter(data.x, data.y);
	game.bombs[playerId][bombId]= new Bomb(normalizedBombLocation.x, normalizedBombLocation.y, bombId);

	setTimeout(function() {
		var explosionData = game.bombs[playerId][bombId].detonate(game.map, 2, game.players);

		delete game.bombs[playerId][bombId];

		socket.sockets.in(gameId).emit("detonate", {explosions: explosionData.explosions, id: bombId});

		explosionData.killedPlayers.forEach(function(killedPlayerId) {
			signalPlayerDeath(killedPlayerId, game, gameId);
		});
	}, 2000);

	socket.sockets.to(this.gameId).emit("place bomb", {x: normalizedBombLocation.x, y: normalizedBombLocation.y, id: data.id});
};

function signalPlayerDeath(id, game, gameId) {
	util.log("Player has been killed: " + id);

	spawnLocations[1].push(game.players[id].spawnPoint);
	delete game.players[id];
	
	socket.sockets.in(gameId).emit("kill player", {id: id});
}

function broadcastingLoop() {
	for(var g in games) {
		var game = games[g];
		for(var i in game.players) {
			var player = game.players[i];
			socket.sockets.in(g).emit("move player", {id: player.id, x: player.x, y: player.y, facing: player.facing, timestamp: (+new Date())});
		}
	}
};