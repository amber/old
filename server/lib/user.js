var mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId,
    Crypto = require('crypto'),
    Watch = require('./watch.js'),
    Client = require('./client.js'),
    Project = require('./project.js'),
    Collection = require('./collection.js'),

    Error = require('./error.js'),

    Async = require('async'),
    ScratchAPI = require('./scratchapi.js'),
    Promise = require('mpromise');


var UserSchema = Schema({
    _id: String,

    session: String,

    group: {type: String, enum: ['administrator', 'moderator', 'default', 'limited'], default: 'limited'},
        
    scratchId: {type: Number},
    joined: {type: Date, default: Date.now},

    email: String,
    location: String,

    projects: {type: ObjectId, ref: 'Collection'},
    lovedProjects: {type: ObjectId, ref: 'Collection'},

    followers: {type: [{type: String, ref: 'User'}], default: []},
    following: {type: [{type: String, ref: 'User'}], default: []},

    password: {
        hash: String,
        salt: String
    }
}, {collection: 'AUser'});

UserSchema.plugin(Watch.updateHooks);

UserSchema.statics.create = function (username, cb) {
    var user = new User({_id: username});
    Async.parallel([
        function (cb) {
            Collection.create(function (err, c) {
                user.projects = c;
                c.addCurator(user, 'owner');
                c.save(cb);
            });
        },
        function (cb) {
            Collection.create(function (err, c) {
                user.lovedProjects = c;
                c.addCurator(user, 'owner');
                c.save(cb);
            });
        }
    ], function (err) {
        cb(null, user);
    });
};

UserSchema.virtual('name').get(function () {
    return this._id;
}).set(function (name) {
    this._id = name;
});
UserSchema.methods.sendPacket = function (packet) {
    this.client.sendPacket(packet);
};
UserSchema.methods.setPassword = function (password) {
    this.password.salt = Crypto.randomBytes(20).toString('hex');
    this.password.hash = Crypto.createHash('sha1').update(this.password.salt + password).digest('hex');
};
UserSchema.methods.checkPassword = function (password) {
    return Crypto.createHash('sha1').update(this.password.salt + password).digest("hex") === this.password.hash;
};
UserSchema.methods.toggleFollowing = function (name, cb) {
    var self = this;
    User.findById(name, function (err, user) {
        if (user) {
            var following = self.following.indexOf(user.name) === -1;
            if (following) {
                user.followers.addToSet(self.name);
                self.following.addToSet(user.name);
            } else {
                user.followers.pull(self.name);
                self.following.pull(user.name);
            }
            self.save(function (err) {
                user.save(function (err) {
                    cb(following);
                });
            });
        } else {
            cb(null);
        }
    })
};
UserSchema.methods.toggleLoveProject = function (project, cb) {
    var self = this;
    Project.findById(project, function (err, project) {
        if (project) {
            var love = project.lovers.indexOf(self.name) === -1;
            var love;
            if (love) {
                project.lovers.addToSet(self.name);
                self.lovedProjects.addToSet(project);
                love = true;
            } else {
                project.lovers.pull(self.name);
                self.lovedProjects.pull(project);
                love = false;
            }
            self.save(function (err) {
                project.save(function (err) {
                    cb(love);
                });
            });
        } else {
            cb(null);
        }
    });
};
UserSchema.methods.serialize = function () {
    return {
        name: this.name,
        group: this.group || null,
        scratchId: this.scratchId
    };
};
UserSchema.statics.findByName = function (name, cb) {
    User.findById(new RegExp('^' + name.replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1") + '$', 'i'), cb);
};
var User = module.exports = mongoose.model('User', UserSchema);

/**
 * Initiates a log in attempt.
 *
 * @param {string} username  the username
 */
Client.listener.on('auth.signIn', function (client, packet, promise) {
    User.findByName(packet.username, function (err, user) {
        var p = new Promise();
        p.onFulfill(function (user) {
            client.user = user;
            user.session = client.session;
            user.save();
            promise.fulfill({
                $: 'result',
                result: user.serialize()
            });
        });
        p.onReject(promise.reject.bind(promise));
        if (user && user.checkPassword(packet.password)) {
            p.fulfill(user);
        } else {
            ScratchAPI(packet.username, packet.password, function (err, u) {
                if (err) {
                    p.reject('auth.incorrectCredentials');
                } else {
                    function cb(err, u) {
                        user = u;
                        user.setPassword(packet.password);
                        user.save(function (err) {
                            p.fulfill(user);
                        });
                    }
                    if (!user) {
                        User.create(packet.username, cb);
                    } else {
                        cb(null, user);
                    }
                }
            });
        }
    });
});

/**
 * Initiates a log out attempt.
 */
Client.listener.on('auth.signOut', function (client, packet, promise) {
    if (!client.user) {
        return promise.reject(Error.notAllowed);
    }
    client.user.session = null;
    client.user.save(function (err) {
        promise.fulfill({
            $: 'result'
        });
    });
    client.user = null;
});

/**
 * Toggles following the given user
 *
 * @param {string} user          the user to (un)follow
 *
 * @return {boolean}
 */
Client.listener.on('user.follow', function (client, packet, promise) {
    if (!client.user) {
        return promise.reject(Error.notAllowed);
    }
    client.user.toggleFollowing(packet.user, function (following) {
        promise.fulfill({
            $: 'result',
            result: following
        });
    });
});
Client.listener.on('user.following', function (client, packet, promise) {
    if (!client.user) {
        return promise.reject(Error.notAllowed);
    }
    promise.fulfill(client.user.following.indexOf(packet.user) !== -1);
});
/**
 * Queries information about a user.
 *
 * @return {User?}
 */
Client.listener.on('users.user', function (client, packet, promise) {
    User.findByName(packet.user, function (err, user) {
        promise.fulfill({
            $: 'result',
            result: user.serialize()
        });
    });
});