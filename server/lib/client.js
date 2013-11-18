var DEBUG_PACKETS = true;

var Client = module.exports = function (connection) {
    this.connection = connection;
    this.watchers = [];
    connection.on('message', this.message.bind(this));
    connection.on('close', this.close.bind(this));
}

var EventEmitter = require('events').EventEmitter;

Client.prototype.listener = Client.listener = new EventEmitter();

var Domain = require('domain'),
    Promise = require('mpromise'),
    Crypto = require('crypto'),
    Watch = require('./watch.js'),
    User = require('./user.js');

Client.prototype.packetTuples = {}; // TODO: Add for deploy version
Client.prototype.watch = function (watcher) {
    this.watchers.push(watcher);
};
Client.prototype.unwatchAll = function () {
    this.watchers.forEach(function (watcher) {
        Watch.unwatch(watcher);
    });
    this.watchers = [];
};
Client.prototype.decodePacket = function (string) {
    var tuple = JSON.parse(string);
    if (!Array.isArray(tuple)) {
        tuple.$ = tuple.$type;
        delete tuple.$type;
        return tuple;
    }
    var type = this.packetTuples['Client:' + tuple[0]],
        packet = {$: tuple[0]};
    if (!type) {
        return null;
    }
    for (var i = 1; i < tuple.length; i++) {
        packet[type[i - 1]] = tuple[i];
    }
    return packet;
};
Client.prototype.encodePacket = function (packet) {
    if (DEBUG_PACKETS) {
        packet.$type = packet.$;
        delete packet.$;
        return JSON.stringify(packet);
    }
    var type = this.packetTuples['Server:' + packet.$],
        tuple = [packet.$];
    for (var i = 0; i < type.length; i++) {
        tuple.push(packet[type[i]]);
    }
    return JSON.stringify(tuple);
};
Client.prototype.message = function (m) {
    var self = this;
    var domain = Domain.create();
    
    domain.on('error', function(err) {
        self.sendPacket({
            $: 'error',
            name: err.name,
            message: err.message,
            stack: err.stack
        });
    });
    domain.add(this.connection);
    domain.run(function () {
        if (m.type === 'utf8') {
            var packet = self.decodePacket(m.utf8Data);
            if (packet) {
                self.processPacket(packet);
            }
        }
    });
};
Client.prototype.close = function () {
    this.unwatchAll();
};
Client.prototype.sendPacket = function (packet) {
    this.connection.send(this.encodePacket(packet));
};
Client.prototype.processPacket = function (packet) {
    var self = this;
    var promise = new Promise(function (err, res) {
        var response = (err === null) ? res : {
            $: 'requestError',
            reason: err
        };
        if (packet.request$id) {
            response.request$id = packet.request$id;
        }
        self.sendPacket(response);
    });
    this.listener.emit(packet.$, this, packet, promise);
};

/**
 * Re Client:connect.
 *
 * @param {User?}    user       the client’s current user or null if the client is not logged in
 * @param {unsigned} sessionId  the client’s session ID
 */
Client.listener.on('connect', function (client, packet, promise) {
    if (packet.sessionId) {
        client.session = packet.sessionId;
        User.findOne({session: packet.sessionId}, function (err, user) {
            if (user) {
                client.user = user;
            }
            promise.fulfill({
                $: 'connect',
                sessionId: client.session,
                user: user ? user.serialize() : null
            });
        });
    } else {
        client.session = Crypto.randomBytes(20).toString('hex');
        promise.fulfill({
            $: 'connect',
            sessionId: client.session
        });
    }
});

module.exports = Client;