var Client = require('./client.js'),
    Project = require('./project.js'),
    Error = require('./error.js');

var sessions = {};

function Session(project) {
    this.id = project._id.toString();
    this.project = project;
    this.users = {};
    this.chat = [];
}

Session.create = function (id, cb) {
    Project.findById(id, function (err, project) {
        if (err) {
            cb(err);
        } else {
            cb(null, new Session(project));
        }
    });
};

Session.prototype.getUsernames = function () {
    return Object.keys(this.users);
};

Session.prototype.getUsers = function () {
    var users = this.users;
    return Object.keys(users).map(function (name) {
        return users[name];
    });
};

Session.prototype.send = function (packet) {
    this.getUsers().forEach(function (user) {
        user.sendPacket(packet);
    });
};

Session.prototype.addClient = function (client) {
    if (this.users[client.user.name]) {
        return; // TODO: Error
    }
    this.users[client.user.name] = client;
    client.editorSession = this;
    this.send({
        $: 'editor.userJoined',
        user: client.user.name
    });
};

Session.prototype.removeClient = function (client) {
    delete this.users[client.user.name];
    client.editorSession = null;
    this.send({
        $: 'editor.userLeft',
        user: client.user.name
    });
};

Session.prototype.sendMessage = function (user, msg) {
    this.chat.push({
        user: user,
        message: msg
    });
    this.send({
        $: 'editor.chat.message',
        user: user,
        message: msg
    });
};

Session.prototype.save = function (cb) {

};

Client.listener.on('editor.connect', function (client, packet, promise) {
    if (!client.user) {
        return promise.reject(Error.noUser);
    }
    if (!client.session) {
        return promise.reject(Error.notAllowed);
    }
    var id = packet.project$id;
    if (sessions[id]) {
        cb(null, sessions[id]);
    } else {
        Session.create(id, cb);
    }
    function cb(err, session) {
        if (err) {
            return promise.reject(Error.notFound);
        }
        sessions[id] = session;
        session.addClient(client);
        promise.fulfill({
            $: 'result',
            result: {
                users: session.getUsernames(),
                chat$length: session.chat.length
            }
        });
    }
});

function disconnect(client, packet, promise) {
    if (!client.editorSession) {
        return promise.reject(Error.notAllowed);
    }
    client.editorSession.removeClient(client);
    promise.fulfill({
        $: 'result'
    });
}

Client.listener.on('editor.disconnect', disconnect);
Client.listener.on('disconnect', function (client, packet, promise) {
    if (client.editorSession) {
        disconnect(client, packet, promise);
    }
});

Client.listener.on('editor.chat.send', function (client, packet, promise) {
    client.editorSession.sendMessage(client.user.name, packet.message);
});

Client.listener.on('editor.chat.history', function (client, packet, promise) {
    promise.fulfill({
        $: 'result',
        result: client.editorSession.chat.slice(packet.offset, packet.offset + packet.length)
    });
});