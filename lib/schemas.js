var Crypto = require('crypto'),
    Async = require('async')
    Assets = require('./assets.js'),
    mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId;

var listeners = [];

var watchers = {};

/*
{
    Forum: {
        <id here>: {
            fields: ['name', 'modified'],
            cb: <function>
        }
    }
}

function watch(type, id, fields)

fields: {
    name: true,
    created: true,
    views: true,
    authors: [{
        name: true  
    }]
}


*/

var modelParents = {
    Topic: 'forum',
    Post: 'topic',

};

/*
    event: {
        type: ['set', 'add', 'remove', 'replace', 'insert']
    }
*/
function watchCallback(type, id, field, event, cb) {

}
/*
{
    Project: {
        _id: {
            42315432: {
                name: true,
                authors: [{
                    _id: true
                }]
            }   
        },
        authors: {
            
        }
    }
}
*/
function watch(type, query, fields, cb) {
    if (fields.$static) {
        return;
    }
    var model = mongoose.model(type),
        paths = model.schema.paths,
        myfields = {},
        cbs = [];
    Object.keys(fields).forEach(function (field) {
        var v = fields[field];
        if (v === true) {
            myfields[field] = true;
        } else if (Object.prototype.toString.call(v) === '[object Object]') {
            myfields[field] = v;
            var type = paths[field].options.type.ref,
                q = {};
            q[modelParents[type]] = query._id;
            var c = function() {};
            cbs.push(c);
            watch(type, q, v, c);
        } else if (Array.isArray(v)) {
            myfields[field] = v[0];
            var type = paths[field].options.type[0].ref,
                q = {};
            q[modelParents[type]] = query._id;
            var c = function(id, changes) {
                model.findOne(query, function (err, obj) {
                    var i = obj[field].indexOf(id);
                    if (i === -1) {
                        return;
                    }
                    var c = {};
                    c[field] = {
                        $: 'set',
                        index: i,
                        value: changes
                    };
                    cb(obj._id, [c]);
                });
            };
            cbs.push(c);
            watch(type, q, v[0], c);
        }
    });
    var t = watchers[type] || [],
        queryField = Object.keys(query)[0],
        q = {};
    q[queryField] = query[queryField];
    t.push({
        $query: q,
        $cb: cb,
        $subs: cbs,
        fields: myfields
    });
    watchers[type] = t;
}

function unwatch(cb) {
    var types = Object.keys(watchers);
    for (var i = 0; i < types.length; i++) {
        var w = watchers[types[i]];
        for (var j = 0; j < w.length; j++) {
            if (w[j].$cb === cb) {
                var subs = w[j].$subs;
                for (var k = 0; k < subs.length; k++) {
                    unwatch(subs[k]);
                }
                w.splice(j, 1);
            }
        }
    }
}

exports.watch = watch;
exports.unwatch = unwatch;

function equals(a, b) {
    return String(a) === String(b);
}

function indexOf(array, item) {
    for (var i = 0; i < array.length; i++) {
        if (equals(array[i], item)) {
            return i;
        }
    }
    return -1;
}

function matchesQuery(object, query) {
    var fields = Object.keys(query);
    for (var i = 0; i < fields.length; i++) {
        if (!equals(object[fields[i]], query[fields[i]])) {
            return false;
        }
    }
    return true;
}

function arrayChanges(o, n) {
    var steps = [],
        added = {},
        removed = {},
        tmp = {};
    for (var i = 0; i < o.length; i++) {
        removed[o[i]] = true;
        tmp[o[i]] = true;
    }
    for (i = 0; i < n.length; i++) {
        added[n[i]] = true;
    }
    for (i = 0; i < o.length; i++) {
        if (removed[o[i]]) {
            delete added[o[i]];
        }
    }
    for (i = 0; i < n.length; i++) {
        if (tmp[n[i]]) {
            delete removed[n[i]];
        }
    }
    for (i = 0; i < n.length; i++) {
        if (!equals(o[i], n[i])) {
            if (added[n[i]]) {
                steps.push({$: 'add', index: i, value: n[i]});
                o.splice(i, 0, n[i]);
            } else if (removed[o[i]]) {
                steps.push({$: 'remove', index: i});
                o.splice(i, 1);
            } else {
                var f = indexOf(o, n[i]);
                steps.push({$: 'move', from: f, to: i});
                var t = o[f];
                o.splice(f, 1);
                o.splice(i, 0, t);
            }
        }
    }
    while (o.length !== n.length) {
        steps.push({$: 'remove', index: i});
        o.splice(i, 1);
    }
    return steps;
}

function updateHooks(schema, options) {
    schema.post('init', function () {
        this.before = this.toObject({getters: true});
    });
    schema.post('save', function () {
        if (!this.before) {
            this.before = {};
        }
        var self = this;
        var w = watchers[this.constructor.modelName];
        if (w) {
            var cbs = [];
            for (var i = 0; i < w.length; i++) {
                if (matchesQuery(this, w[i].$query)) {
                    var fields = w[i].fields,
                        self = this,
                        changes = {},
                        changed = false,
                        fns = [],
                        cb = w[i].$cb;
                    Object.keys(fields).forEach(function (field) {
                        if (fields[field]) {
                            if (Array.isArray(self[field])) {
                                var c = arrayChanges(self.before[field], self[field]);
                                if (c.length !== 0) {
                                    if (fields[field] !== true) {
                                        for (var i = 0; i < c.length; i++) {
                                            if (c[i].$ === 'add') {
                                                var o = c[i];
                                                fns.push(function (cb) {
                                                    mongoose.model(self.schema.paths[field].options.type[0].ref).findById(o.value, function (err, obj) {
                                                        o.value = {};
                                                        Object.keys(fields[field]).forEach(function (f) {
                                                            o.value[f] = obj[f];
                                                        });
                                                        cb();
                                                    });
                                                });
                                            }
                                        }
                                    }
                                    changes[field] = c;
                                    changed = true;
                                }
                            } else if (!equals(self[field], self.before[field])) {
                                changes[field] = self[field];
                                changed = true;
                            }
                        }
                    });
                    if (changed) {
                        Async.parallel(fns, function () {
                            cb(self._id, changes);
                        });
                    }
                }
            }
        }
    });
}

var UserSchema = Schema({
    _id: String,
    session: String,
    joined: {type: Date, default: Date.now},
    scratchId: {type: Number},
    group: String,
    email: String,
    location: String,
    projects: [{type: ObjectId, ref: 'Project'}],
    followers: [{type: String, ref: 'User'}],
    following: [{type: String, ref: 'User'}],
    passwordHash: String,
    salt: String,
    lovedProjects: [{type: ObjectId, ref: 'Project'}],
    favoriteProjects: [{type: ObjectId, ref: 'Project'}],
    activity: []
});
UserSchema.plugin(updateHooks);
UserSchema.virtual('name').get(function () {
    return this._id;
}).set(function (name) {
    this._id = name;
});
UserSchema.methods.sendPacket = function (packet) {
    this.client.sendPacket(packet);
};
UserSchema.methods.setPassword = function (password) {
    this.salt = Crypto.randomBytes(20).toString('hex');
    this.passwordHash = Crypto.createHash('sha1').update(this.salt + password).digest('hex');
};
UserSchema.methods.checkPassword = function (password) {
    return Crypto.createHash('sha1').update(this.salt + password).digest("hex") === this.passwordHash;
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
var User = exports.User = mongoose.model('User', UserSchema);


var ProjectSchema = Schema({
    _id: {type: ObjectId, auto: true},
    name: String,
    created: {type: Date, default: Date.now},
    authors: [{type: String, ref: 'User'}],
    notes: String,
    tags: [{type: ObjectId, ref: 'Tag'}],
    topic: {type: ObjectId, ref: 'Topic'},
    versions: [{
        asset: String,
        date: {type: Date, default: Date.now}
    }],
    modified: Date,
    thumbnail: String,
    views: {type: Number, default: 0},
    lovers: [{type: String, ref: 'User'}],
    loves: Number,
    parent: {type: ObjectId, ref: 'Project'},
    remixes: [{type: ObjectId, ref: 'Project'}],
    remixCount: Number
});
ProjectSchema.plugin(updateHooks);
ProjectSchema.pre('save', function (cb) {
    this.loves = this.lovers.length;
    this.remixCount = this.remixes.length;
    this.modified = this.newest.date;
    cb();
});
ProjectSchema.virtual('newest').get(function () {
    return this.versions[this.versions.length - 1];
})
ProjectSchema.methods.serialize = function () {
    return {
        id: this.id,
        name: this.name,
        notes: this.notes,
        authors: this.authors,
        created: this.created,
        loves: this.loves,
        views: this.views,
        hash: this.newest,
        remixes: this.remixes
    };
};
ProjectSchema.methods.load = function () {
    var version,
        cb;
    if (arguments.length === 1) {
        version = this.versions.length - 1;
        cb = arguments[0];
    } else {
        version = arguments[0];
        cb = arguments[1];
    }
    Assets.get(this.versions[version].asset, function (data) {
        cb(data);
    });
};
ProjectSchema.methods.update = function (data, cb) {
    var versions = this.versions;
    Assets.set(JSON.stringify(data), function (hash) {
        versions.push(hash);
    });
};
ProjectSchema.statics.query = function (query, sort, offset, length, fields, cb) {
    this.find(query).sort(sort).skip(offset).limit(length).exec(function (err, result) {
        cb(err, result.map(function (p) {
            var o = {
                id: p._id,
                project: {
                    name: p.name,
                    thumbnail: p.thumbnail
                }
            };
            fields.forEach(function (f) {
                o[f] = p[f];
            });
            return o;
        }));
    });
};
var Project = exports.Project = mongoose.model('Project', ProjectSchema);

var CollectionSchema = Schema({
    _id: {type:ObjectId, auto: true},
    name: String,
    created: {type: Date, default: Date.now},
    modified: {type: Date, default: Date.now},
    curators: [{
        permission: [{type: String, enum: ['add', 'remove', 'edit']}],
        user: {type: String, ref: 'User'}
    }],
    projects: [{type: ObjectId, ref: 'Project'}],
    description: [{
        body: {type: String},
        author: {type: String, ref: 'User'},
        date: {type: Date, default: Date.now}
    }],
    topic: {type: ObjectId, ref: 'Topic'}
});
CollectionSchema.plugin(updateHooks);
var Collection = exports.Collection = mongoose.model('Collection', CollectionSchema);

var TagSchema = Schema({
    _id: String,
    versions: [{
        date: {type: Date, default: Date.now},
        description: String
    }],
    description: String
});
TagSchema.plugin(updateHooks);
var Tag = exports.Tag = mongoose.model('Tag', TagSchema);

var EventSchema = Schema({
    _id: {type: ObjectId, auto: true},
    date: {type: Date, default: Date.now},
    actor: {type: ObjectId, ref: 'User'},
    action: {type: String, enum: ['follow', 'love', 'share', 'create', 'comment', 'subscribe', 'addProject', 'addCurator', 'addPost', 'addTopic']},
    contentType: {type: String, enum: ['User', 'Project', 'Collection', 'Post', 'ForumTopic']},
    contentUser: {type: ObjectId, ref: 'User'},
    contentProject: {type: ObjectId, ref: 'Project'},
    contentCollection: {type: ObjectId, ref: 'Collection'},
    contentPost: {type: ObjectId, ref: 'Post'},contentForumTopic: {type: ObjectId, ref: 'ForumTopic'}
});
EventSchema.plugin(updateHooks);
var Event = exports.Event = mongoose.model('Event', EventSchema);

var NotificationSchema = Schema({
    event: {type: Date, ref: 'Event'},
    recipient: {type: ObjectId, ref: 'User'},
    isRead: Boolean,
    dateSent: {type: Date}
});
NotificationSchema.plugin(updateHooks);
var Notification = exports.Notification = mongoose.model('Notification', NotificationSchema);

var ForumCategorySchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    name: String,
    forums: [{type: String, ref: 'Forum'}]
});
ForumCategorySchema.plugin(updateHooks);
var ForumCategory = exports.ForumCategory = mongoose.model('ForumCategory', ForumCategorySchema);

var ForumSchema = Schema({
    _id: String,
    name: String,
    description: String,
    topics: [{type: ObjectId, ref: 'Topic'}]
});
ForumSchema.plugin(updateHooks);
ForumSchema.post('init', function () {
    this.before = this.toObject();
});
ForumSchema.methods.addTopic = function (topic, cb) {
    this.topics.push(topic._id);
    topic.forum = this._id;
    this.save(cb);
};
ForumSchema.methods.deleteTopic = function (topic, cb) {
    var self = this;
    Async.parallel([
        function (cb) {
            self.topics.pull(topic);
            self.save(cb);
        }, function (cb) {
            topic.forum = null;
            topic.save(cb);
        }
    ], cb);
};
ForumSchema.methods.bumpTopic = function (topic, cb) {
    this.topics.pull(topic);
    this.topics.unshift(topic);
    this.save(cb);
};
ForumSchema.methods.getTopics = function (offset, length, cb) {
    this.populate('topics', function (err, self) {
        cb(self.topics.slice(offset, offset + length));
    });
};
var Forum = exports.Forum = mongoose.model('Forum', ForumSchema);

var TopicSchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    name: String,
    forum: {type: String, ref: 'Forum'},
    posts: [{type: ObjectId, ref: 'Post'}],
    postCount: Number,
    views: {type: Number, default: 0},
    authors: [{type: String, ref: 'User'}],
    modified: Date
});
TopicSchema.plugin(updateHooks);
TopicSchema.pre('save', function (cb) {
    this.postCount = this.posts.length;
    cb();
});
TopicSchema.methods.delete = function (cb) {
    var self = this;
    Async.parallel([
        function (cb) {
            if (self.forum) {
                Forum.findById(self.forum, function (err, forum) {
                    forum.topics.pull(self);
                    forum.save(cb);
                });
            } else {
                cb(null);
            }
        },
        function (cb) {
            self.forum = null;
            self.save(cb);
        }
    ], cb);
};
TopicSchema.methods.addPost = function (post, cb) {
    this.posts.push(post._id);
    if (this.posts.length === 1) {
        post.isHead = true;
    }
    post.topic = this._id;
    var self = this;
    Forum.findById(this.forum, function (err, forum) {
        forum.bumpTopic(self._id, cb);
    });
};
TopicSchema.methods.getPosts = function (offset, length, cb) {
    this.populate('posts', function (err, self) {
        cb(self.posts.slice(offset, offset + length));
    });
};
var Topic = exports.Topic = mongoose.model('Topic', TopicSchema);

var PostSchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    topic: {type: ObjectId, ref: 'Topic'},
    authors: [{type: String, ref: 'User'}],
    isHead: {type: Boolean, default: false},
    versions: [{
        body: {type: String},
        author: {type: String, ref: 'User'},
        date: {type: Date, default: Date.now}
    }],
    children: [{type: ObjectId, ref: 'Post'}],
    parent: {type: ObjectId, ref: 'Post'}
});
PostSchema.plugin(updateHooks);
PostSchema.virtual('modified').get(function () {
    return this.newest.date;
});
PostSchema.virtual('newest').get(function () {
    return this.versions[this.versions.length - 1];
});
PostSchema.virtual('body').get(function () {
    return this.newest.body;
});
PostSchema.methods.addAuthor = function (author) {
    this.authors.addToSet(author);
};
PostSchema.methods.edit = function (author, body, name) {
    this.name = name;
    this.versions.push({
        author: author,
        body: body
    });
    this.addAuthor(author);
};
PostSchema.methods.delete = function (cb) {
    var self = this;
    Topic.findById(this.topic, function (err, topic) {
        if (self.isHead) {
            topic.delete(cb);
        } else {
            topic.posts.remove(self._id);
            topic.save(cb)
        }
    });
};
PostSchema.pre('save', function (cb) {
    var self = this;
    Topic.findById(this.topic, function (err, topic) {
        if (self.isHead) {
            topic.authors = self.authors;
            if (self.name) {
                topic.name = self.name;
            }
        }
        topic.modified = self.modified;
        topic.save(cb);
        cb();
    });
});
var Post = exports.Post = mongoose.model('Post', PostSchema);
