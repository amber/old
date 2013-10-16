require('longjohn');

var DEBUG_PACKETS = true;

var WebSocket = require('websocket'),
    HTTP = require('http'),
    Crypto = require('crypto'),
    Domain = require('domain'),
    FS = require('fs'),
    URL = require('url'),
    Express = require('express'),
    Async = require('async'),
    mongoose = require('mongoose'),
    Promise = require('mpromise'),
    //sbIO = require('./lib/sbio.js'),
    Assets = require('./lib/assets.js'),
    Schemas = require('./lib/schemas.js'),
    Serialize = require('./lib/serializer.js'),
    ScratchAPI = require('./lib/scratchapi.js'),
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
    ['use', function(req, res, next) {
        var domain = Domain.create();
        domain.on('error', function(err) {
            res.statusCode = 500;
            res.end(err.message + '\n');

            domain.dispose();
        });
        domain.run(next);
    }],
    ['use', Express.methodOverride()],
    ['use', function(req, res, next) {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.send(200);
        } else {
            next();
        }
    }],
    ['get', '/api/assets/:hash', function (req, res) {
        Assets.get(req.params.hash, function (data) {
            if (data) {
                res.header('Cache-Control', 'max-age=31557600, public');
            } else {
                res.statusCode = 404;
            }
            res.end(data || '');
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
        Project.findById(req.params.pk, function (err, project) {
            if (project) {
                project.load(req.params.v, function (data) {
                    if (data) {
                        res.statusCode = 200;
                        res.end(JSON.stringify(project.serialize()));
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
    ['use', '/', Express.static('./client')]
];


var clients = [];


var Errors = {
    notFound: 0,
    auth: {
        incorrectCredentials: 1
    },
    NO_PERMISSION: 2
};

function Client(connection) {
    this.connection = connection;
    clients.push(this);
    this.watchers = [];
    connection.on('message', this.message.bind(this));
    connection.on('close', this.close.bind(this));
}

extend(Client.prototype, {
    packetTuples: {}, // TODO: Add for deploy version
    watch: function (watcher) {
        this.watchers.push(watcher);
    },
    unwatchAll: function () {
        this.watchers.forEach(function (watcher) {
            Schemas.unwatch(watcher);
        });
        this.watchers = [];
    },
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
    },
    close: function () {
        this.unwatchAll();
        clients.splice(clients.indexOf(this), 1);
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
        'watch.home.signedOut': function (packet, promise) {
            this.unwatchAll();
            Async.parallel([
                Project.count.bind(Project, {}),
                Project.query.bind(Project, {}, '-created', 0, 20, ['views']),
                Project.query.bind(Project, {}, '-remixCount', 0, 20, ['remixCount']),
                Project.query.bind(Project, {}, '-loves', 0, 20, ['loves']),
                Project.query.bind(Project, {}, '-views', 0, 20, ['views'])
            ], function (err, results) {
                promise.fulfill({
                    $: 'result',
                    result: {
                        projectCount: results[0],
                        featured: results[1],
                        topRemixed: results[2],
                        topLoved: results[3],
                        topViewed: results[4]
                    }
                });
            });
        },
        'watch.home.signedIn': function (packet, promise) {
            this.unwatchAll();
            Async.parallel([
                // activity
                Project.query.bind(Project, {}, '-modified', 0, 20, ['views']),
                Project.query.bind(Project, {authors: {$in: this.user.following}}, '-modified', 0, 20, ['authors']),
                // lovedByFollowing
                Project.query.bind(Project, {}, '-remixCount', 0, 20, ['remixCount']),
                Project.query.bind(Project, {}, '-loves', 0, 20, ['loves']),
                Project.query.bind(Project, {}, '-views', 0, 20, ['views'])
            ], function (err, results) {
                promise.fulfill({
                    $: 'result',
                    result: {
                        activity: [],
                        featured: results[0],
                        byFollowing: results[1],
                        lovedByFollowing: [],
                        topRemixed: results[2],
                        topLoved: results[3],
                        topViewed: results[4]
                    }
                });
            });
        },
        /*'watch.project': function (packet, promise) {
            project:
            title: String,
            isSubscribed: Boolean,
            authors: [String],
            notes: String,
            tags: [String],
            viewCount: Number,
            loveCount: Number,
            remixCount: Number,
            isLoved: Boolean,
            activity: [Event], // first 30 items
            collections: [Collection], // first 20 items
            topic$id: objectId,
            posts: [Post] // first 20 items
        },*/
        'watch.forum': function (packet, promise) {
            this.unwatchAll();
            var self = this;
            var schema = {
                name: '$',
                description: '$',
                topics: [{
                    id: true,
                    name: true,
                    authors: true,
                    views: true,
                    posts: 'postCount'
                }]
            };
            Forum.findById(packet.forum$id, function (err, forum) {
                if (!forum) {
                    promise.reject(Errors.notFound);
                    return;
                }
                forum.getTopics(packet.offset || 0, 20, function (topics) {
                    promise.fulfill({
                        $: 'result',
                        result: Serialize(forum, schema)
                    });
                    self.watch(Schemas.watch('Forum', {_id: packet.forum$id}, schema, function (id, changes) {
                        self.sendPacket({
                            $: 'update',
                            data: changes
                        });
                    }));
                });
            });
        },
        'watch.topic': function (packet, promise) {
            this.unwatchAll();
            var self = this;
            var schema = {
                forum: true,
                name: true,
                views: true,
                posts: [{
                    id: true,
                    authors: true,
                    body: true,
                    modified: true
                }]
            };
            Topic.findById(packet.topic$id).exec(function (err, topic) {
                if (!topic) {
                    promise.reject(Errors.notFound);
                    return;
                }
                topic.views++;
                topic.save(function (err) {
                    topic.getPosts(packet.offset || 0, 20, function (posts) {
                        promise.fulfill({
                            $: 'result',
                            result: Serialize(topic, schema)
                        });
                        self.watch(Schemas.watch('Topic', {_id: packet.topic$id}, schema, function (id, changes) {
                            self.sendPacket({
                                $: 'update',
                                data: changes
                            });
                        }));
                    });
                });
            });
        },
        /**
         * Initiates a log in attempt.
         *
         * @param {string} username  the username
         */
        'auth.signIn': function (packet, promise) {
            var self = this;
            User.findById(new RegExp('^' + RegExp.quote(packet.username) + '$', 'i'), function (err, user) {
                var p = new Promise();
                p.onFulfill(function (user) {
                    self.user = user;
                    user.session = self.session;
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
                            if (!user) {
                                user = new User({_id: u.username});
                            }
                            user.setPassword(packet.password);
                            user.save(function (err) {
                                p.fulfill(user);
                            });
                        }
                    });
                }
            });
        },
        /**
         * Initiates a log out attempt.
         */
        'auth.signOut': function (packet, promise) {
            if (this.user) {
                this.user.session = null;
                this.user.save(function (err) {
                    promise.fulfill({
                        $: 'result'
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
        'user.follow': function (packet, promise) {
            if (this.user) {
                this.user.toggleFollowing(packet.user, function (following) {
                    promise.fulfill({
                        $: 'result',
                        result: following
                    });
                });
            } else {
                promise.reject(Errors.NO_PERMISSION);
            }
        },
        'user.following': function (packet, promise) {
            if (this.user) {
                promise.fulfill(this.user.following.indexOf(packet.user) !== -1);
            } else {
                promise.reject(Errors.NO_PERMISSION);
            }
        },
        /**
         * Queries information about a user.
         *
         * @return {User?}
         */
        'users.user': function (packet, promise) {
            User.findById(new RegExp('^' + RegExp.quote(packet.user) + '$', 'i'), function (err, user) {
                promise.fulfill({
                    $: 'result',
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
        'project': function (packet, promise) {
            Project.findById(packet.project$id, function (err, project) {
                if (project) {
                    promise.fulfill({
                        $: 'result',
                        result: project.serialize()
                    });
                } else {
                    promise.reject(Errors.notFound);
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
        'project.love': function (packet, promise) {
            if (this.user) {
                this.user.toggleLoveProject(packet.project$id, function (love) {
                    if (love === null) {
                        promise.reject(Errors.notFound);
                    } else {
                        promise.fulfill({
                            $: 'result'
                        });
                    }
                });
            } else {
                promise.reject(Errors.NO_PERMISSION);
            }
        },
        'project.create': function (packet, promise) {
            if (this.user) {
                Project.create(this.user, function (project) {
                    promise.fulfill({
                        $: 'result',
                        result: project._id
                    });
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
        'projects.count': function (packet, promise) {
            Project.count(function (err, count) {
                promise.fulfill({
                    $: 'result',
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
        'projects.featured': function (packet, promise) {
            // TODO: Replace with collection view
            Project.find().skip(packet.offset).limit(packet.length).exec(function (err, result) {
                promise.fulfill({
                    $: 'result',
                    result: result.map(function (p) {
                        return {
                            id: p._id,
                            views: p.views,
                            project: {
                                name: p.name,
                                thumbnail: p.thumbnail
                            }
                        };
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
        'projects.topLoved': function (packet, promise) {
            Project.find().sort('-loves').skip(packet.offset).limit(packet.length).exec(function (e, result) {
                promise.fulfill({
                    $: 'result',
                    result: result.map(function (p) {
                        return {
                            id: p._id,
                            loves: p.loves,
                            project: {
                                name: p.name,
                                thumbnail: p.thumbnail
                            }
                        };
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
        'projects.topViewed': function (packet, promise) {
            Project.find().sort('-views').skip(packet.offset).limit(packet.length).exec(function (err, result) {
                promise.fulfill({
                    $: 'result',
                    result: result.map(function (p) {
                        return {
                            id: p.id,
                            views: p.views,
                            project: {
                                name: p.name,
                                thumbnail: p.thumbnail
                            }
                        };
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
        'projects.topRemixed': function (packet, promise) {
            Project.find().sort('-remixCount').skip(packet.offset).limit(packet.length).populate('remixes').exec(function (e, result) {
                promise.fulfill({
                    $: 'result',
                    result: result.map(function (p) {
                        return {
                            id: p._id,
                            remixes: p.remixes,
                            project: {
                                name: p.name,
                                thumbnail: p.thumbnail
                            }
                        };
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
        'projects.lovedByFollowing': function (packet, promise) {
            if (this.user) {

            } else {
                promise.reject(Errors.NO_PERMISSION);
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
        'projects.user.byFollowing': function (packet, promise) {
            if (this.user) {
                Project.find({authors: {$in: this.user.following}}).sort('-modified').skip(packet.offset).limit(packet.length).exec(function (err, projects) {
                    promise.fulfill({
                        $: 'result',
                        result: projects.map(function (p) {
                            return {
                                id: p._id,
                                authors: p.authors,
                                project: {
                                    name: p.name,
                                    thumbnail: p.thumbnail
                                }
                            };
                        })
                    });
                });
            } else {
                promise.reject(Errors.NO_PERMISSION);
            }
        },
        'projects.byUser': function (packet, promise) {
            Project.find({authors: packet.user}).sort('-modified').skip(packet.offset).limit(packet.length).exec(function (err, result) {
                promise.fulfill({
                    $: 'result',
                    result: result.map(function (p) {
                        return {
                            id: p._id,
                            project: {
                                name: p.name,
                                thumbnail: p.thumbnail
                            }
                        };
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
        'forums.categories': function (packet, promise) {
            ForumCategory.find().populate('forums').exec(function (err, result) {
                promise.fulfill({
                    $: 'result',
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
        'forums.forum': function (packet, promise) {
            Forum.findById(packet.forum$id, function (err, forum) {
                promise.fulfill({
                    $: 'result',
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
        'forums.topics': function (packet, promise) {
            Forum.findById(packet.forum$id, function (err, forum) {
                if (forum) {
                    forum.getTopics(packet.offset, packet.length, function (topics) {
                        promise.fulfill({
                            $: 'result',
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
                } else {
                    promise.reject(Errors.notFound);
                }
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
        'forums.topic': function (packet, promise) {
            Topic.findById(packet.topic$id, function (err, topic) {
                if (topic) {
                    promise.fulfill({
                        $: 'result',
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
                    promise.reject(Errors.notFound);
                }
            });
        },
        'forums.topic.add': function (packet, promise) {
            var self = this;
            if (!this.user) {
                promise.reject(Errors.NO_PERMISSION);
                return;
            }
            Forum.findById(packet.forum$id, function (err, forum) {
                if (!forum) {
                    promise.reject(Errors.notFound);
                    return;
                }
                var topic = new Topic();
                forum.addTopic(topic);
                var post = new Post();
                topic.addPost(post);
                post.edit(self.user.name, packet.body.trim(), topic, packet.name);
                topic.modified = post.modified;
                Async.series([
                    post.save.bind(post),
                    topic.save.bind(topic),
                    forum.save.bind(forum)
                ], function (err) {
                    promise.fulfill({
                        $: 'result',
                        result: {
                            topic$id: topic._id,
                            post$id: post._id
                        }
                    });
                });
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
        'forums.posts': function (packet, promise) {
            Topic.findById(packet.topic$id).populate('posts').exec(function (err, topic) {
                if (!topic) {
                    return promise.reject(Errors.notFound);
                }
                var posts = topic.posts.slice(packet.offset, packet.offset + packet.length);
                promise.fulfill({
                    $: 'result',
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
            });
        },
        'forums.post.delete': function (packet, promise) {
            var self = this;
            Post.findById(packet.post$id, function (err, post) {
                if (!post) {
                    return promise.reject(Errors.notFound);
                }
                if (post.authors.indexOf(self.user.name) > -1) {
                    post.delete(promise.fulfill.bind(promise, {
                        $: 'result'
                    }));
                } else {
                    promise.reject(Errors.NO_PERMISSION);
                }
            });
        },
        'forums.post.add': function (packet, promise) {
            var self = this;
            if (!this.user) {
                return promise.reject(Errors.NO_PERMISSION);
            }
            Topic.findById(packet.topic$id, function (err, topic) {
                if (!topic) {
                    return promise.reject(Errors.notFound);
                }
                var post = new Post();
                topic.addPost(post);
                post.edit(self.user.name, packet.body.trim(), topic);
                topic.modified = post.modified;
                Async.series([
                    post.save.bind(post),
                    topic.save.bind(topic)
                ], function (err) {
                    promise.fulfill({
                        $: 'result',
                        result: post._id
                    });
                });
            });
        },
        'forums.post.edit': function (packet, promise) {
            var self = this;
            Post.findById(packet.post$id).populate('topic').exec(function (err, post) {
                if (!post) {
                    return promise.reject(Errors.notFound);
                }
                var topic = post.topic;
                post.edit(self.user.name, packet.body.trim(), topic, packet.name);
                Async.series([
                    post.save.bind(post),
                    topic.save.bind(topic)
                ], function (err) {
                    promise.fulfill({$: 'result'});
                });
            });
        }
    }
});

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
