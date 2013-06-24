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
    Promise = require('mpromise'),
    sbIO = require('./sbio.js'),
    Assets = require('./lib/assets.js'),
    Schemas = require('./lib/schemas.js'),
    User = Schemas.User,
    Project = Schemas.Project,
    ForumCategory = Schemas.ForumCategory,
    Forum = Schemas.Forum,
    Topic = Schemas.Topic,
    Post = Schemas.Post;


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
        Assets.get(req.params.hash, function (data) {
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
            Assets.set(data, function (hash) {
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