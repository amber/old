var mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId;

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
UserSchema.methods.toggleFavoriteProject = function (project, cb) {
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
};
UserSchema.methods.serialize = function () {
    return {
        name: this.name,
        group: this.group || null
    };
};
var User = exports.User = mongoose.model('User', UserSchema);


var ProjectSchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    name: String,
    created: {type: Date, default: Date.now},
    authors: [{type: String, ref: 'User'}],
    notes: String,
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
    favoriters: [{type: String, ref: 'User'}],
    favorites: Number,
    parent: {type: ObjectId, ref: 'Project'},
    remixes: [{type: ObjectId, ref: 'Project'}],
    remixCount: Number
});
ProjectSchema.pre('save', function (cb) {
    this.loves = this.lovers.length;
    this.remixCount = this.remixes.length;
    this.favorites = this.favoriters.length;
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
        favorites: this.favorites,
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
    assets.get(this.versions[version], function (data) {
        cb(data);
    });
};
ProjectSchema.methods.update = function (data, cb) {
    var versions = this.versions;
    assets.set(JSON.stringify(data), function (hash) {
        versions.push(hash);
    });
};
var Project = exports.Project = mongoose.model('Project', ProjectSchema);

var CollectionSchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    name: String,
    created: {type: Date, default: Date.now},
    modified: {type: Date, default: Date.now},
    curators: [{
        permission: [String],
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
var Collection = exports.Collection = mongoose.model('Collection', CollectionSchema);


var ForumCategorySchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    name: String,
    forums: [{type: ObjectId, ref: 'Forum'}]
});
var ForumCategory = exports.ForumCategory = mongoose.model('ForumCategory', ForumCategorySchema);

var ForumSchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    name: String,
    description: String,
    topics: [{type: ObjectId, ref: 'Topic'}]
});
var Forum = exports.Forum = mongoose.model('Forum', ForumSchema);

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
TopicSchema.pre('save', function (cb) {
    this.postCount = this.posts.length;
    cb();
});
TopicSchema.methods.addPost = function (post) {
    this.posts.push(post._id);
    if (this.posts.length === 1) {
        post.isHead = true;
    }
    post.topic = this._id;
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
    }]
})
PostSchema.virtual('modified').get(function () {
    return this.newest.date;
});
PostSchema.virtual('newest').get(function () {
    return this.versions[this.versions.length - 1];
});
PostSchema.methods.addAuthor = function (author) {
    if (this.authors.indexOf(author) === -1) {
        this.authors.push(author);
        this.$dirty = true;
    }
};
PostSchema.methods.edit = function (author, body, name) {
    this.name = name;
    this.versions.push({
        author: author,
        body: body
    });
    this.addAuthor(author);
    this.$dirty = true;
};
PostSchema.pre('save', function (cb) {
    if (this.$dirty) {
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
        });
        this.$dity = false;
    } else {
        cb();
    }
});
var Post = exports.Post = mongoose.model('Post', PostSchema);
