require('longjohn');

var DEBUG_PACKETS = true;

var WebSocket = require('websocket'),
    HTTP = require('http'),
    Crypto = require('crypto'),
    FS = require('fs'),
    URL = require('url'),
    Express = require('express'),
    Async = require('async'),
    mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    Promise = require('mpromise'),
    sbIO = require('./sbio.js');

var ObjectId = Schema.ObjectId;

mongoose.connect('mongodb://localhost/amber');

RegExp.quote = function(string) {
    return string.replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
};

function extend(base) {
    [].slice.call(arguments, 1).forEach(function (ex) {
        for (var key in ex) {
            if (ex.hasOwnProperty(key)) {
                base[key] = ex[key];
            }
        }
    });
}

var assets = {
    path: 'assets/',
    set: function(data, cb) {
        var hash = Crypto.createHash('sha256').update(data).digest("hex");
        var path = this.path + hash;
        Async.waterfall([
            function (cb) {
                FS.exists(path, function (exists) {
                    cb(null, exists);
                });
            },
            function (exists, cb) {
                if (!exists) {
                    FS.writeFile(path, data, null, cb);
                } else {
                    cb();
                }
            }
        ], function () {
            cb(hash);
        });
    },
    get: function(hash, cb) {
        FS.readFile(this.path + hash, null, function (e, data) {
            cb(e ? null : data);
        });
    }
};

var routes = [
    ['use', Express.methodOverride()],
    ['use', function(req, res, next) {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if ('OPTIONS' === req.method) {
            res.send(200);
        } else {
            next();
        }
    }],
    ['get', '/api/assets/:hash', function (req, res) {
        assets.get(req.params.hash, function (data) {
            if (data) {
                res.header('Cache-Control', 'max-age=31557600, public');
                res.end(data);
            } else {
                res.statusCode = 404;
                res.end();
            }
        });
    }],
    ['post', '/api/assets', function (req, res) {
        var buffers = [];
        req.on('data', function (data) {
            buffers.push(data);
        });
        req.on('end', function () {
            var data = Buffer.concat(buffers);
            assets.set(data, function (hash) {
                res.end(hash);
            });
        });
    }],
    ['get', '/api/projects/:pk', function (req, res) {
        Project.findById(req.params.pk, function (err, project) {
            if (project) {
                project.views++;
                project.save();
                project.load(function (data) {
                    res.end(data);
                });
            } else {
                res.statusCode = 404;
                res.end();
            }
        });
    }],
    ['get', '/api/projects/:pk/:v', function (req, res) {
        ProjectInfo.fromID(Number(req.params.pk), function (project) {
            if (project) {
                project.loadVersion(req.params.v, function (data) {
                    if (data) {
                        res.statusCode = 200;
                        res.end(JSON.stringify(project.toJSON(true)));
                    } else {
                        res.statusCode = 404;
                        res.end();
                    }
                });
            } else {
                res.statusCode = 404;
                res.end();
            }
        });
    }],
    ['use', '/', Express.static('./public')]
];

var Errors = {
    NOT_FOUND: 0,
    NO_PERMISSION: 1
};

function Client(connection) {
    this.connection = connection;
    connection.on('message', this.message.bind(this));
    connection.on('close', this.close.bind(this));
}

extend(Client.prototype, {
    packetTuples: {}, // TODO: Add for deploy version
    decodePacket: function (string) {
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
    },
    encodePacket: function (packet) {
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
    },
    message: function (m) {
        if (m.type === 'utf8') {
            var packet = this.decodePacket(m.utf8Data);
            if (packet) {
                this.processPacket(packet);
            }
        }
    },
    close: function () {
        // TODO
    },
    sendPacket: function (packet) {
        this.connection.send(this.encodePacket(packet));
    },
    processPacket: function (packet) {
        var self = this,
            obj = this.packets[packet.$];
        if (typeof obj !== 'function') {
            console.warn('Undefined packet', packet.$);
            return;
        }
        var promise = new Promise(function (err, response) {
            var response = (err === null) ? response : {
                $: 'request.error',
                reason: err
            };
            if (packet.request$id) {
                response.request$id = packet.request$id;
            }
            self.sendPacket(response);
        });
        obj.call(this, packet, promise);
    },
    packets: {
        /**
         * Re Client:connect.
         *
         * @param {User?}    user       the client’s current user or null if the client is not logged in
         * @param {unsigned} sessionId  the client’s session ID
         */
        'connect': function (packet, promise) {
            var self = this;
            if (packet.sessionId) {
                this.session = packet.sessionId;
                User.findOne({session: packet.sessionId}, function (err, user) {
                    if (user) {
                        self.user = user;
                    }
                    promise.fulfill({
                        $: 'connect',
                        sessionId: self.session,
                        user: user ? user.serialize() : null
                    });
                });
            } else {
                this.session = Crypto.randomBytes(20).toString('hex');
                promise.fulfill({
                    $: 'connect',
                    sessionId: this.session
                });
            }
        },

        /**
         * Initiates a log in attempt.
         *
         * @param {string} username  the username
         */
        'request.auth.signIn': function (packet, promise) {
            var self = this;

            User.findById(new RegExp('^' + RegExp.quote(packet.username) + '$', 'i'), function (err, user) {
                var p = new Promise();
                p.onFulfill(function (user) {
                    self.user = user;
                    user.session = self.session;
                    user.save();
                    promise.fulfill({
                        $: 'auth.signIn.succeeded',
                        user: user.serialize()
                    });
                });
                p.onReject(promise.reject);
                if (user && user.checkPassword(packet.password)) {
                    p.fulfill(user);
                } else {
                    HTTP.request({
                        hostname: 'scratch.mit.edu',
                        port: 80,
                        path: '/login/',
                        method: 'POST'
                    }, function(res) {
                        if (res.statusCode === 403) {
                            p.reject('Wrong password');
                        } else {
                            function cb() {
                                user.setPassword(packet.password);
                                user.save(function (err) {
                                    p.fulfill(user);
                                });
                            }
                            if (user) {
                                cb();
                            } else {
                                get('scratch.mit.edu', '/site-api/users/all/' + packet.username + '/', function (data) {
                                    user = new User({_id: JSON.parse(data).user.username});
                                    cb();
                                });
                            }
                        }
                    }).end(JSON.stringify({
                        username: packet.username,
                        password: packet.password
                    }));
                }
            });
        },
        /**
         * Initiates a log out attempt.
         */
        'request.auth.signOut': function (packet, promise) {
            if (this.user) {
                this.user.session = null;
                this.user.save(function (err) {
                    promise.fulfill({
                        $: 'request.result'
                    });
                });
                this.user = null;
            } else {
                promise.reject(Errors.NO_PERMISSION);
            }
        },
        /**
         * Toggles following the given user
         *
         * @param {string} user          the user to (un)follow
         *
         * @return {boolean}
         */
        'request.user.follow': function (packet, promise) {
            if (this.user) {
                this.user.toggleFollowing(packet.user, function (following) {
                    promise.fulfill({
                        $: 'request.result',
                        result: following
                    });
                });
            } else {
                promise.reject(Error.NO_PERMISSION);
            }
        },
        /**
         * Queries information about a user.
         *
         * @return {User?}
         */
        'request.users.user': function (packet, promise) {
            User.findById(new RegExp('^' + RegExp.quote(packet.user) + '$', 'i'), function (err, user) {
                promise.fulfill({
                    $: 'request.result',
                    result: user.serialize()
                });
            });
        },
        /**
         * Queries information about a project.
         *
         * @param {objectId} project$id  the project ID
         *
         * @return {Project}
         */
        'request.project': function (packet, promise) {
            Project.findById(packet.project$id, function (err, project) {
                if (project) {
                    promise.fulfill({
                        $: 'request.result',
                        result: project.serialize()
                    });
                } else {
                    promise.reject(Errors.NOT_FOUND);
                }
            });
        },
        /**
         * Toggles whether the user loves the given project.
         *
         * @param {objectId} project$id  the project
         *
         * @return {boolean}
         */
        'request.project.love': function (packet, promise) {
            if (this.user) {
                this.user.toggleLoveProject(packet.project$id, function (love) {
                    if (love === null) {
                        promise.reject(Errors.NOT_FOUND);
                    } else {
                        promise.fulfill({
                            $: 'request.result'
                        });
                    }
                });
            } else {
                promise.reject(Errors.NO_PERMISSION);
            }
        },
        /**
         * Toggles whether the user favorites the given project.
         *
         * @param {objectId} project$id  the project
         *
         * @return {boolean}
         */
        'request.project.favorite': function (packet, promise) {
            if (this.user) {
                this.user.toggleFavoriteProject(packet.project$id, function (love) {
                    if (love === null) {
                        promise.reject(Errors.NOT_FOUND);
                    } else {
                        promise.fulfill({
                            $: 'request.result'
                        });
                    }
                });
            } else {
                promise.reject(Errors.NO_PERMISSION);
            }
        },
        /**
         * Queries the total number of Amber projects.
         *
         * @return {unsigned}
         */
        'request.projects.count': function (packet, promise) {
            Project.count(function (err, count) {
                promise.fulfill({
                    $: 'request.result',
                    result: count
                });
            });
        },
        /**
         * Queries the list of featured projects, sorted by date.
         *
         * @param {unsigned} offset      the index at which to start returning results
         * @param {unsigned} length      the number of results to return
         *
         * @return {(subset of Project)[]}
         */
        'request.projects.featured': function (packet, promise) {
            // TODO: Replace with collection view
            Project.find().skip(packet.offset).limit(packet.length).exec(function (err, result) {
                promise.fulfill({
                    $: 'request.result',
                    result: result.map(function (p) {
                        return {
                            id: p._id,
                            views: p.views,
                            project: {
                                name: p.name,
                                thumbnail: p.thumbnail
                            }
                        }
                    })
                });
            });
        },
        /**
         * Queries the list of the most loved projects in the past week, sorted by loves.
         *
         * @param {unsigned} offset      the index at which to start returning results
         * @param {unsigned} length      the number of results to return
         *
         * @return {(subset of Project)[]}
         */
        'request.projects.topLoved': function (packet, promise) {
            Project.find().sort('-loves').skip(packet.offset).limit(packet.length).exec(function (e, result) {
                promise.fulfill({
                    $: 'request.result',
                    result: result.map(function (p) {
                        return {
                            id: p._id,
                            loves: p.loves,
                            project: {
                                name: p.name,
                                thumbnail: p.thumbnail
                            }
                        }
                    })
                });
            });
        },
        /**
         * Queries the list of the most viewed projects in the past week, sorted by loves.
         *
         * @param {unsigned} offset      the index at which to start returning results
         * @param {unsigned} length      the number of results to return
         *
         * @return {(subset of Project)[]}
         */
        'request.projects.topViewed': function (packet, promise) {
            Project.find().sort('-views').skip(packet.offset).limit(packet.length).exec(function (err, result) {
                promise.fulfill({
                    $: 'request.result',
                    result: result.map(function (p) {
                        return {
                            id: p.id,
                            views: p.views,
                            project: {
                                name: p.name,
                                thumbnail: p.thumbnail
                            }
                        }
                    })
                });
            });
        },
        /**
         * Queries the list of the most remixed projects in the past week, sorted by loves.
         *
         * @param {unsigned} offset      the index at which to start returning results
         * @param {unsigned} length      the number of results to return
         *
         * @return {(subset of Project)[]}
         */
        'request.projects.topRemixed': function (packet, promise) {
            Project.find().sort('-remixCount').skip(packet.offset).limit(packet.length).populate('remixes').exec(function (e, result) {
                promise.fulfill({
                    $: 'request.result',
                    result: result.map(function (p) {
                        return {
                            id: p._id,
                            remixes: p.remixes,
                            project: {
                                name: p.name,
                                thumbnail: p.thumbnail
                            }
                        }
                    })
                });
            });
        },
        /**
         * Queries the list of projects recently loved by users the current user is following, sorted by date.
         *
         * @param {unsigned} request$id  a client-generated request ID
         * @param {unsigned} offset      the index at which to start returning results
         * @param {unsigned} length      the number of results to return
         *
         * @return {(subset of Project)[]}
         */
        'request.projects.lovedByFollowing': function (packet, promise) {
            if (this.user) {
                
            } else {
                promise.reject(Error.NO_PERMISSION);
            }
        },
        /**
         * Queries the list of projects by users the current user is following, sorted by date.
         *
         * @param {unsigned} offset      the index at which to start returning results
         * @param {unsigned} length      the number of results to return
         *
         * @return {(subset of Project)[]}
         */
        'request.projects.user.byFollowing': function (packet, promise) {
            if (this.user) {
                Project.find({authors: {$in: this.user.following}}).sort('-modified').skip(packet.offset).limit(packet.length).exec(function (err, projects) {
                    promise.fulfill({
                        $: 'request.result',
                        result: projects.map(function (p) {
                            return {
                                id: p._id,
                                authors: this.authors,
                                project: {
                                    name: p.name,
                                    thumbnail: p.thumbnail
                                }
                            }
                        })
                    });
                });
            } else {
                promise.reject(Error.NO_PERMISSION);
            }
        },
        'request.projects.byUser': function (packet, promise) {
            Project.find({authors: packet.user}).sort('-modified').skip(packet.offset).limit(packet.length).exec(function (err, result) {
                promise.fulfill({
                    $: 'request.result',
                    result: result.map(function (p) {
                        return {
                            id: p._id,
                            project: {
                                name: p.name,
                                thumbnail: p.thumbnail
                            }
                        }
                    })
                });
            });
        },
        /**
         * Queries the categories and forums in the Amber forums.
         *
         * @param {unsigned} request$id  a client-generated request ID
         *
         * @return {ForumCategory[]}
         */
        'request.forums.categories': function (packet, promise) {
            ForumCategory.find().populate('forums').exec(function (err, result) {
                promise.fulfill({
                    $: 'request.result',
                    result: result.map(function (category) {
                        return {
                            name: {$: category.name},
                            forums: category.forums.map(function (forum) {
                                return {
                                    id: forum._id,
                                    name: {$: forum.name},
                                    description: {$: forum.description},
                                    isUnread: true // TODO: Implement is unread
                                };
                            })
                        };
                    })
                });
            });
        },
        /**
         * Queries information about a forum.
         *
         * @param {unsigned} request$id  a client-generated request ID
         * @param {objectId} forum$id    the forum ID
         *
         * @return {Forum}
         */
        'request.forums.forum': function (packet, promise) {
            Forum.findById(packet.forum$id, function (err, forum) {
                promise.fulfill({
                    $: 'request.result',
                    result: {
                        id: forum._id,
                        name: {$: forum.name},
                        description: {$: forum.description},
                        topics: forum.topics.length,
                        posts: 0 // TODO: Count posts somehow
                    }
                });
            });
        },
        /**
         * Queries the list of topics in a forum.
         *
         * @param {unsigned} request$id  a client-generated request ID
         * @param {objectId} forum$id    the forum ID
         * @param {unsigned} offset      the index at which to start returning results
         * @param {unsigned} length      the number of results to return
         *
         * @return {Topic[]}
         */
        'request.forums.topics': function (packet, promise) {
            Topic.find({forum: packet.forum$id}).sort('-modified').skip(packet.offset).limit(packet.length).exec(function (err, topics) {
                promise.fulfill({
                    $: 'request.result',
                    result: topics.map(function (topic) {
                        return {
                            id: topic._id,
                            name: topic.name,
                            authors: topic.authors,
                            views: topic.views,
                            posts: topic.posts.length
                        };
                    })
                });
            });
        },
        /**
         * Queries information about a topic.
         *
         * @param {unsigned} request$id  a client-generated request ID
         * @param {objectId} topic$id    the forum ID
         *
         * @return {Topic}
         */
        'request.forums.topic': function (packet, promise) {
            Topic.findById(packet.topic$id, function (err, topic) {
                if (topic) {
                    promise.fulfill({
                        $: 'request.result',
                        result: {
                            id: topic._id,
                            authors: topic.authors,
                            name: topic.name,
                            views: topic.views,
                            posts: topic.posts.length,
                            forum$id: topic.forum
                        }
                    });
                } else {
                    promise.reject(Errors.NOT_FOUND);
                }
            });
        },
        /**
         * Queries the list of posts in a topic.
         *
         * @param {unsigned} request$id  a client-generated request ID
         * @param {objectId} topic$id    the topic ID
         * @param {unsigned} offset      the index at which to start returning results
         * @param {unsigned} length      the number of results to return
         *
         * @return {Post[]}
         */
        'request.forums.posts': function (packet, promise) {
            Topic.findById(packet.topic$id).populate('posts').exec(function (err, topic) {
                if (topic) {
                    var posts = topic.posts.slice(packet.offset, packet.offset + packet.length);
                    promise.fulfill({
                        $: 'request.result',
                        result: posts.map(function (post) {
                            return {
                                id: post._id,
                                authors: post.authors,
                                body: post.newest.body,
                                created: post.created,
                                modified: post.newest.date
                            };
                        })
                    });
                } else {
                    promise.reject(Errors.NOT_FOUND);
                }
            });
        },
        'request.forums.post.add': function (packet, promise) {
            var self = this;
            if (!this.user) {
                promise.reject('Not signed in');
                return;
            }
            Topic.findById(packet.topic$id, function (err, topic) {
                if (topic) {
                    var post = new Post();
                    topic.addPost(post);
                    post.edit(self.user.name, packet.body.trim());
                    topic.save(function (err) {
                        post.save(function (err) {
                            promise.fulfill({
                                $: 'request.result'
                            });
                        });
                    });
                } else {
                    promise.reject(Errors.NOT_FOUND);
                }
            });
        },
        'request.forums.post.edit': function (packet, promise) {
            var self = this;
            Post.findById(packet.post$id, function (err, post) {
                if (post) {
                    post.edit(self.user.name, packet.body.trim(), packet.name);
                    post.save(function (err) {
                        promise.fulfill({
                            $: 'request.result'
                        });
                    });
                } else {
                    promise.reject(Errors.NOT_FOUND);
                }
            });
        },
        'request.forums.topic.add': function (packet, promise) {
            var self = this;
            if (!this.user) {
                promise.reject(Error.NO_PERMISSION);
                return;
            }
            Forum.findById(packet.forum$id, function (err, forum) {
                if (forum) {
                    var topic = new Topic({
                        forum: packet.forum$id,
                        name: packet.name
                    });
                    var post = new Post();
                    topic.addPost(post);
                    post.edit(self.user.name, packet.body.trim());
                    topic.save(function (err) {
                        post.save(function (err) {
                            promise.fulfill({
                                $: 'request.result',
                                result: {
                                    topic$id: topic._id,
                                    post$id: post._id
                                }
                            });
                        });
                    });
                } else {
                    promise.fulfill({
                        $: 'request.error',
                        code: 0
                    });
                }
            });
        },
        'request.forums.topic.view': function (packet, promise) {
            Topic.findById(packet.topic$id, function (err, topic) {
                if (topic) {
                    topic.views++;
                    topic.save(function (err) {
                        promise.fulfill({
                            $: 'request.result'
                        });
                    });
                } else {
                    promise.reject(Errors.NOT_FOUND);
                }
            });
        }
    }
});


function createPacket(type, object) {
    object.$ = type;
    return JSON.stringify(encodePacket(object));
}

function sendPacket(packet, exclude) {
    for (var i in amber.clients) {
        if (amber.clients[i] !== exclude) {
            amber.clients[i].sendPacket(packet);
        }
    }
}

function arrayToJSON(array) {
    return array.map(function (object) {
        return (object && typeof object.arrayToJSON === 'function') ? object.arrayToJSON() : object;
    });
}


var ProjectSchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    name: String,
    created: {type: Date, default: Date.now},
    authors: [{type: String, ref: 'Users'}],
    notes: String,
    versions: [{
        asset: String,
        date: {type: Date, default: Date.now}
    }],
    modified: Date,
    thumbnail: String,
    views: {type: Number, default: 0},
    lovers: [{type: String, ref: 'User'}],
    loves: Number,
    favoriters: [{type: String, ref: 'User'}],
    favorites: Number,
    parent: {type: ObjectId, ref: 'Project'},
    remixes: [{type: ObjectId, ref: 'Project'}],
    remixCount: Number
});
ProjectSchema.pre('save', function (next) {
    this.loves = this.lovers.length;
    this.remixCount = this.remixes.length;
    this.favorites = this.favoriters.length;
    this.modified = this.newest.date;
    next();
});
ProjectSchema.virtual('newest').get(function () {
    return this.versions[this.versions.length - 1];
})
extend(ProjectSchema.methods, {
    serialize: function () {
        return {
            id: this.id,
            name: this.name,
            notes: this.notes,
            authors: this.authors,
            created: this.created,
            favorites: this.favorites,
            loves: this.loves,
            views: this.views,
            hash: this.newest,
            remixes: this.remixes
        };
    },
    load: function () {
        var version,
            cb;
        if (arguments.length === 1) {
            version = this.versions.length - 1;
            cb = arguments[0];
        } else {
            version = arguments[0];
            cb = arguments[1];
        }
        assets.get(this.versions[version], function (data) {
            cb(data);
        });
    },
    update: function (data, cb) {
        var versions = this.versions;
        assets.set(JSON.stringify(data), function (hash) {
            versions.push(hash);
        });
    }
});
var Project = mongoose.model('Project', ProjectSchema);

/*function Project(data, id) {
    this.id = id;
    if (data) {
        this.created = new Date(data.created);
        this.authors = data.authors;
        this.name = data.name;
        this.notes = data.notes;
    } else {
        this.created = new Date();
        this.authors = [];
        this.name = 'Project';
        this.notes = 'This is an Amber project.';
    }

    //this.sbjs = project;
    //this.stage = new Stage(project.stage);
}

extend(Project.prototype, {
    toJSON: function () {
        return {
            created: this.created.getTime(),
            authors: this.authors,
            name: this.name,
            notes: this.notes
        };
    },
    serialize: function () {
        return {
            name: this.name,
            notes: this.notes,
            stage: this.stage.serialize()
        };
    },
    updateProject: function () {
        this.sbjs.stage = this.stage.save();
    }
});*/

function Stage(stage) {
    this.id = objects.sprites.add(this);

    this.objName = 'Stage';
    this.children = [];
    this.scripts = [];
    this.costumes = [];
    this.costumeIndex = 1;
    this.sounds = [];
    this.tempo = 60;
    this.volume = 100;
    this.variables = [];
}

extend(Stage.prototype, {
    toJSON: function () {
        return {
            children: arrayToJSON(this.children),
            scripts: arrayToJSON(this.scripts),
            costumes: arrayToJSON(this.costumes),
            currentCostumeIndex: this.costumeIndex,
            sounds: arrayToJSON(this.sounds),
            tempo: this.tempo,
            volume: this.volume,
            variables: this.variables
        };
    }
});


function Sprite(sprite) {
    this.id = objects.sprites.add(this);

    this.objName = 'Sprite1';
    this.scripts = [];
    this.costumes = [];
    this.currentCostumeIndex = 1;
    this.sounds = [];
    this.scratchX = 0;
    this.scratchY = 0;
    this.direction = 90;
    this.rotationStyle = 'normal';
    this.isDraggable = false;
    this.volume = 100;
    this.scale = 1;
    this.visible = true;
    this.variables = [];
}

extend(Sprite.prototype, {
    toJSON: function () {
        return {
            objName: this.objName,
            scripts: arrayToJSON(this.scripts),
            costumes: arrayToJSON(this.costumes),
            currentCostumeIndex: this.currentCostumeIndex,
            sounds: arrayToJSON(this.sounds),
            scratchX: this.scratchX,
            scratchY: this.scratchX,
            direction: this.direction,
            rotationStyle: this.rotationStyle,
            isDraggable: this.isDraggable,
            volume: this.volume,
            scale: this.scale,
            visible: this.visible,
            variables: this.variables
        };
    }
});

function ImageMedia(media) {
    this.name = 'costume1';
    var self = this;
    this.rotationCenterX = media.rotationCenterX;
    this.rotationCenterY = media.rotationCenterY;
}

extend(ImageMedia.prototype, {
    serialize: function () {
        return {
            id: this.id,
            name: this.name,
            hash: this.hash,
            rotationCenterX: this.rotationCenterX,
            rotationCenterY: this.rotationCenterY
        };
    },
    save: function () {
        return {
            costumeName: this.name,
            rotationCenterX: this.rotationCenterX,
            rotationCenterY: this.rotationCenterY,
            image: this.image
        };
    }
});

function Script(stack, object, is2format) {
    if (arguments.length === 0) {
        return;
    }
    this.parent = object;
    if (object) {
        object.scripts.push(this);
    }
    if (is2format) {
        this.x = stack[0];
        this.y = stack[1];
        this.stack = new Stack(stack[2], this, is2format);
    } else {
        this.setStack(stack);
    }
}

Script.fromSerial = function (data, parent) {
    var script = Object.create(Script.prototype);
    script.x = data[0];
    script.y = data[1];
    script.setStack(Stack.fromSerial(data[2]));
    script.parent = parent;
    return script;
};

extend(Script.prototype, {
    isScript: true,
    serialize: function () {
        return [
            this.x,
            this.y,
            this.stack.serialize()
        ];
    },
    save: function () {
        return [
            this.x,
            this.y,
            this.stack.save()
        ];
    },
    setStack: function (stack) {
        this.stack = stack;
        if (this.stack) {
            this.stack.setParent(this);
        }
    },
    remove: function () {
        var i = this.parent.scripts.indexOf(this);
        if (i === -1) {
            console.warn('Parent does not contain script.');
        } else {
            this.parent.scripts.splice(i, 1);
        }
    }
});

function Stack(blocks, parent, is2format) {
    if (arguments.length === 0) {
        return;
    }
    this.setParent(parent);
    if (is2format) {
        var self = this;
        this.blocks = [];
        blocks.forEach(function (block) {
            if (Array.isArray(block)) {
                self.blocks.push(new Block(block, self, is2format));
            }
        });
    } else {
        this.setBlocks(blocks);
    }
}

Stack.fromSerial = function (data) {
    var stack = Object.create(Stack.prototype);
    stack.setBlocks(data.map(function (block) {
        return Block.fromSerial(block);
    }));
    return stack;
};

extend(Stack.prototype, {
    isStack: true,
    serialize: function () {
        return serializeArray(this.blocks);
    },
    save: function () {
        return saveArray(this.blocks);
    },
    setBlocks: function (blocks) {
        this.blocks = blocks;
        if (this.blocks) {
            var self = this;
            this.blocks.forEach(function (block) {
                block.setParent(self);
            });
        }
    },
    setParent: function (parent) {
        this.parent = parent;
    },
    getScript: function () {
        return this.parent ? (this.parent.isScript ? this.parent : this.parent.getScript()) : null;
    },
    split: function (target) {
        var i = target.isBlock ? this.blocks.indexOf(target) : target;
        if (i === -1) {
            console.warn('Stack does not contain target.');
        }
        return new Stack(this.blocks.splice(i, this.blocks.length), null);
    },
    append: function (stack) {
        this.setBlocks(this.blocks.concat(stack.blocks));
    },
    insert: function (stack, target) {
        var i = this.blocks.indexOf(target);
        if (i === -1) {
            console.warn('Stack does not contain target.');
        }
        this.setBlocks(this.blocks.slice(0, i).concat(stack.blocks).concat(this.blocks.slice(i, this.blocks.length)));
    }
});

var cBlocks = {
    doRepeat: [1],
    doUntil: [1],
    doForever: [0],
    doIf: [1],
    doIfElse: [1, 2]
};


function Block(block, parent, is2format) {
    if (arguments.length === 0) {
        return;
    }
    if (is2format && this.toAmber[block[0]]) {
        block = this.toAmber[block[0]].call(this, block);
    }
    this.parent = parent;
    this.id = objects.blocks.add(this);
    this.selector = block[is2format ? 0 : 1];

    this.args = block.slice(is2format ? 1 : 2);
    var i = this.args.length;
    while (i--) {
        if (Array.isArray(this.args[i])) {
            if (cBlocks[this.selector] && cBlocks[this.selector].indexOf(i) !== -1) {
                this.args[i] = new Stack(this.args[i], this, is2format);
            } else {
                this.args[i] = new Block(this.args[i], this, is2format);
            }
        }
    }
}

Block.fromSerial = function (data) {
    var block = Object.create(Block.prototype);
    block.selector = data[1];
    block.args = [];
    var special = cBlocks[block.selector] || [];
    data.slice(2).forEach(function (arg, i) {
        block.setArg(i, special.indexOf(i) === -1 ? (Array.isArray(arg) ? Block.fromSerial(arg) : arg) : Stack.fromSerial(arg || []));
    });
    block.id = objects.blocks.add(block);
    return block;
};

extend(Block.prototype, {
    isBlock: true,
    serialize: function () {
        return [
            this.id,
            this.selector
        ].concat(serializeArray(this.args.map(function (arg) {
            return Array.isArray(arg) && arg.length === 0 ? null : arg;
        })));
    },
    save: function () {
        var self = this;

        if (this.selector === 'readVariable' && this.args[0].$ && this.fromAmber.get[this.args[0].$]) {
            return [this.fromAmber.get[this.args[0].$]];
        }

        var relative = this.selector === 'changeVar:by:';
        if ((relative || this.selector === 'setVar:to:') && this.args[0].$) {
            var format = this.fromAmber[relative ? 'change' : 'set'][this.args[0].$];
            if (format) {
                return saveArray(format.map(function (part) {
                    return typeof part === 'string' ? part : self.args[part];
                }));
            }
        }

        return [this.selector].concat(saveArray(this.args.map(function (arg) {
            return (arg && arg.$) ? arg.$ : arg;
        })));
    },
    getScript: function () {
        return this.parent.getScript();
    },
    setParent: function (parent) {
        this.parent = parent;
    },
    setArg: function (arg, value) {
        if (value.isStack || value.isBlock) {
            value.setParent(this);
        }
        this.args[arg] = value;
    },
    move: function (x, y) {
        var script = this.getScript();
        var object = script.parent;
        if (this.parent.isBlock || this.parent.isStack) {
            if (script && script.stack.blocks[0] === this) {
                script.x = x;
                script.y = y;
            } else {
                var newScript = new Script(this.breakOff(), object);
                newScript.x = x;
                newScript.y = y;
                newScript.stack.setParent(newScript);
            }
        }
    },
    breakOff: function () {
        if (this.parent.isBlock) {
            this.parent.resetArg(this);
            return new Stack([this], null);
        }
        if (this.parent.isStack) {
            var script = this.getScript();
            if (script && script.stack.blocks[0] === this) {
                script.remove();
                return script.stack;
            }
            return this.parent.split(this);
        }
        console.warn('Parent is not block or stack.');
    },
    remove: function () {
        this.breakOff();
    },
    resetArg: function (block) {
        // TODO: Default arg
        this.args[this.args.indexOf(block)] = 'blah blah blah';
    },

    customSetter: function (relative, property, value) {
        return [relative ? 'changeVar:by:' : 'setVar:to:', {$: property}, value];
    },
    customReader: function (property) {
        return ['readVariable', {$: property}];
    },

    toAmber:  {
        'timerReset': function (block) {return this.customSetter(false, 'timer', 0);},
        'timer': function (block) {return this.customReader('timer');},

        'costumeIndex': function (block) {return this.customReader('costume #');},

        'changeXposBy:': function (block) {return this.customSetter(true, 'x position', block[1]);},
        'changeYposBy:': function (block) {return this.customSetter(true, 'y position', block[1]);},
        'xpos': function (block) {return this.customReader('x position');},
        'ypos': function (block) {return this.customReader('y position');},
        'xpos:': function (block) {return this.customSetter(false, 'x position', block[1]);},
        'ypos:': function (block) {return this.customSetter(false, 'y position', block[1]);},

        'heading:': function (block) {return this.customSetter(false, 'direction', block[1]);},
        'heading': function (block) {return this.customReader('direction');},

        'setGraphicEffect:to:': function (block) {return this.customSetter(false, block[1] + ' effect', block[2]);},
        'changeGraphicEffect:by:': function (block) {return this.customSetter(true, block[1] + ' effect', block[2]);},

        'setVolumeTo:': function (block) {return this.customSetter(false, 'volume', block[1]);},
        'volume': function (block) {return this.customReader('volume');},

        'mousePressed': function (block) {return this.customReader('mouse down?');},
        'mouseX': function (block) {return this.customReader('mouse x');},
        'mouseY': function (block) {return this.customReader('mouse y');},

        'setSizeTo:': function (block) {return this.customSetter(false, 'size', block[1]);},
        'changeSizeBy:': function (block) {return this.customSetter(true, 'size', block[1]);},
        'size': function (block) {return this.customReader('size');},

        'doReturn': function (block) {return ['stopScripts', {$: 'this script'}];},
        'stopAll': function (block) {return ['stopScripts', {$: 'all'}];},

        'penColor:': function (block) {return this.customSetter(false, 'pen color', block[1]);},
        'penSize:': function (block) {return this.customSetter(false, 'pen size', block[1]);},
        'setPenHueTo:': function (block) {return this.customSetter(false, 'pen hue', block[1]);},
        'setPenShadeTo:': function (block) {return this.customSetter(false, 'pen lightness', block[1]);}
    },
    fromAmber: {
        get: {
            'x position': 'xpos',
            'y position': 'ypos',
            'direction': 'heading',

            'costume #': 'costumeIndex',
            'size': 'size',

            'timer': 'timer',

            'volume': 'volume',
            'mouse down?': 'mousePressed',
            'mouse x': 'mouseX',
            'mouse y': 'mouseY'
        },
        set: {
            'x position': ['xpos:', 1],
            'y position': ['ypos:', 1],
            'direction': ['heading:', 1],

            'color effect': ['setGraphicEffect:to:', 'color', 1],
            'fisheye effect': ['setGraphicEffect:to:', 'fisheye', 1],
            'whirl effect': ['setGraphicEffect:to:', 'whirl', 1],
            'pixelate effect': ['setGraphicEffect:to:', 'pixelate', 1],
            'mosaic effect': ['setGraphicEffect:to:', 'mosaic', 1],
            'brightness effect': ['setGraphicEffect:to:', 'brightness', 1],
            'ghost effect': ['setGraphicEffect:to:', 'ghost', 1],
            'size': ['setSizeTo:', 1],

            'volume': ['setVolumeTo:', 1],

            'timer': ['timerReset'],

            'pen color': ['penColor:', 1],
            'pen size': ['penSize:', 1],
            'pen hue': ['setPenHueTo:', 1],
            'pen lightness': ['setPenShadeTo:', 1]
        },
        change: {
            'x position': ['changeXposBy:', 1],
            'y position': ['changeYposBy:', 1],

            'color effect': ['changeGraphicEffect:by:', 'color', 1],
            'fisheye effect': ['changeGraphicEffect:by:', 'fisheye', 1],
            'whirl effect': ['changeGraphicEffect:by:', 'whirl', 1],
            'pixelate effect': ['changeGraphicEffect:by:', 'pixelate', 1],
            'mosaic effect': ['changeGraphicEffect:by:', 'mosaic', 1],
            'brightness effect': ['changeGraphicEffect:by:', 'brightness', 1],
            'ghost effect': ['changeGraphicEffect:by:', 'ghost', 1],
            'size': ['changeSizeBy:', 1]
        }
    }
});

var UserSchema = Schema({
    _id: String,
    session: String,
    joined: {type: Date, default: Date.now},
    group: String,
    email: String,
    location: String,
    projects: [{type: ObjectId, ref: 'Project'}],
    followers: [{type: String, ref: 'User'}],
    following: [{type: String, ref: 'User'}],
    passwordHash: String,
    salt: String,
    lovedProjects: [{type: ObjectId, red: 'Project'}],
    favoriteProjects: [{type: ObjectId, red: 'Project'}],
    activity: []
});
UserSchema.virtual('name').get(function () {
    return this._id;
}).set(function (name) {
    this._id = name;
});
extend(UserSchema.methods, {
    sendPacket: function (packet) {
        this.client.sendPacket(packet);
    },
    setPassword: function (password) {
        this.salt = Crypto.randomBytes(20).toString('hex');
        this.passwordHash = Crypto.createHash('sha1').update(this.salt + password).digest('hex');
    },
    checkPassword: function (password) {
        return Crypto.createHash('sha1').update(this.salt + password).digest("hex") === this.passwordHash;
    },
    toggleFollowing: function (name, cb) {
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
    },
    toggleLoveProject: function (project, cb) {
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
    },
    toggleFavoriteProject: function (project, cb) {
        var self = this;
        Project.findById(project, function (err, project) {
            if (project) {
                var i = project.favoriters.indexOf(self.name);
                var favorite;
                if (i === -1) {
                    project.favoriters.addToSet(self.name);
                    self.favoriteProjects.addToSet(project);
                    favorite = true;
                } else {
                    project.favoriters.pull(self.name);
                    self.favoriteProjects.pull(project);
                    favorite = false;
                }
                self.save(function (err) {
                    project.save(function (err) {
                        cb(favorite);
                    });
                });
            } else {
                cb(null);
            }
        });
    },
    /*processPacket: function (packet) {
        try {
            var path = packet.$.split('.');
            var obj = this.packets;
            path.forEach(function (string) {
                obj = obj[string];
            });
            obj.call(this, packet);
            
        } catch (e) {
            console.log(e.stack);
        }
    },
    packets: {
        script: {
            create: function (packet) {
                var parent = objects.sprites.get(packet.object$id);
                var script = Script.fromSerial(packet.script, parent);
                parent.scripts.push(script);
                var response = {
                    script: script.serialize(),
                    user$id: this.id,
                    object$id: packet.object$id
                };
                sendPacket(createPacket('script.create', response), this);
                response.request$id = packet.request$id;
                this.sendPacket(createPacket('script.create', response));
            }
        },
        block: {
            move: function (packet) {
                objects.blocks.get(packet.block$id).move(packet.x, packet.y);
                packet.user$id = this.id;
                sendPacket(createPacket('block.move', packet), this);
            },
            attach: function (packet) {
                switch (packet.type) {
                case 0:
                    objects.blocks.get(packet.target$id).setArg(packet.slot$index, objects.blocks.get(packet.block$id).breakOff());
                    break;
                case 1:
                    objects.blocks.get(packet.target$id).setArg(packet.slot$index, objects.blocks.get(packet.block$id).breakOff().blocks[0]);
                    break;
                case 2:
                    objects.blocks.get(packet.target$id).parent.insert(objects.blocks.get(packet.block$id).breakOff(), objects.blocks.get(packet.target$id));
                    break;
                case 3:
                    objects.blocks.get(packet.target$id).parent.append(objects.blocks.get(packet.block$id).breakOff());
                    break;
                }
                packet.user$id = this.id;
                sendPacket(createPacket('block.attach', packet), this);
            },
            remove: function (packet) {
                objects.blocks.get(packet.block$id).remove();
                packet.user$id = this.id;
                sendPacket(createPacket('block.remove', packet), this);
            }
        },
        slot: {
            claim: function (packet) {
                packet.user$id = this.id;
                sendPacket(createPacket('slot.claim', packet), this);
            },
            set: function (packet) {
                objects.blocks.get(packet.block$id).setArg(packet.slot$index, packet.value);
                packet.user$id = this.id;
                sendPacket(createPacket('slot.set', packet), this);
            }
        },
        variable: {
            create: function (packet) {
                objects.sprites.get(packet.object$id).variables.push({
                    name: packet.name,
                    value: ''
                });
                packet.user$id = this.id;
                sendPacket(createPacket('variable.create', packet), this);
            }
        },
        chat: {
            message: function (packet) {
                packet.user$id = this.id;
                chatHistory.push([packet.user$id, packet.message]);
                sendPacket(createPacket('chat.message', packet), this);
            }
        },
        save: function (packet) {
            project.updateProject();
            projectData = new Buffer(project.sbjs.save1());
            FS.writeFile('saveTest.sb', projectData);
            console.log('saved');
        }
    },*/
    serialize: function () {
        return {
            name: this.name,
            group: this.group || null
        };
    }
});
var User = mongoose.model('User', UserSchema);


var ForumCategory = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    name: String,
    forums: [{type: ObjectId, ref: 'Forum'}]
});
var ForumCategory = mongoose.model('ForumCategory', ForumCategory);

var ForumSchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    name: String,
    description: String,
    topics: [{type: ObjectId, ref: 'Topic'}]
});
var Forum = mongoose.model('Forum', ForumSchema);

var TopicSchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    name: String,
    forum: {type: ObjectId, ref: 'Forum'},
    posts: [{type: ObjectId, ref: 'Post'}],
    postCount: Number,
    views: {type: Number, default: 0},
    authors: [{type: String, ref: 'User'}],
    modified: Date
});
TopicSchema.pre('save', function (next) {
    this.postCount = this.posts.length;
    next();
});
extend(TopicSchema.methods, {
    addPost: function (post) {
        this.posts.push(post._id);
        if (this.posts.length === 1) {
            post.isHead = true;
        }
        post.topic = this._id;
    }
});
var Topic = mongoose.model('Topic', TopicSchema);

var PostSchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    topic: {type: ObjectId, ref: 'Topic'},
    authors: [{type: String, ref: 'User'}],
    isHead: {type: Boolean, default: false},
    versions: [{
        body: {type: String},
        author: {type: String, ref: 'User'},
        date: {type: Date, default: Date.now}
    }]
})
PostSchema.virtual('modified').get(function () {
    return this.newest.date;
});
PostSchema.virtual('newest').get(function () {
    return this.versions[this.versions.length - 1];
});
extend(PostSchema.methods, {
    addAuthor: function (author) {
        if (this.authors.indexOf(author) === -1) {
            this.authors.push(author);
            this.$dirty = true;
        }
    },
    edit: function (author, body, name) {
        this.name = true;
        this.versions.push({
            author: author,
            body: body
        });
        this.addAuthor(author);
        this.$dirty = true;
    }
});
PostSchema.pre('save', function (next) {
    if (this.$dity) {
        var self = this;
        Topic.findById(this.topic, function (err, topic) {
            if (self.isHead) {
                topic.authors = self.authors;
                if (self.name) {
                    topic.name = self.name;
                }
            }
            topic.modified = self.modified;
            topic.save(next);
        });
        this.$dity = false;
    } else {
        next();
    }
});
var Post = mongoose.model('Post', PostSchema);


function openProjectFromData(data) {
    sbIO.fromSB(data, function (project) {
        var p = new Project();
        p.name = project[0].name;
        p.authors = project[0].authors;
        p.notes = project[0].notes;
        p.update(project[0].stage);
        p.thumbnail = project[1];
        p.save();
    });
}

function openProject(cb, host, path) {
    get(host, path, function (data) {
        openProjectFromData(data);
        cb();
    }, true);
}

function openProjectOnScratch(cb, id) {
    openProject(cb, 'scratch.mit.edu', 'http://scratch.mit.edu/static/projects/nXIII/' + id + '.sb');
}

/*FS.readFile('Pacman.sb', function (err, data) {
    openProjectFromData(data);
});*/

(function () {
    var l = [2516786, 2950693, 2911784, 2270221, 1198025, 1194155, 1089130, 1089026, 1053443, 1027607, 948434, 934410, 934092, 931538, 922876, 907445, 901773, 901587, 898571, 894247];
    function cb(i) {
        openProjectOnScratch(function () {
            if (i + 1 < l.length) {
                cb(i + 1);
            } else {
                console.log('Done!')
            }
        }, l[i]);
        console.log("Loaded", i);
    }
    cb(8);
}) //();



function get(host, path, cb, binary) {
    HTTP.get({
        host: host,
        port: 80,
        path: path,
        method: 'GET'
    }, function(res) {
        var list = [];
        res.on('data', function (chunk) {
            list.push(chunk);
        });

        res.on('end', function () {
            var data = Buffer.concat(list);
            cb(binary ? data : data.toString('utf8'));
        });
    });
}


(function () {
    var fileServer = Express();
    routes.forEach(function (path) {
        fileServer[path[0]].apply(fileServer, path.slice(1));
    });

    var server = HTTP.createServer(fileServer);

    new WebSocket.server({
        httpServer: server,
        autoAcceptConnections: false
    }).on('request', function (req) {
        new Client(req.accept('', req.origin));
    });

    server.listen(process.env.PORT || 8080);
}) ();