var mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId,
    Client = require('../client.js'),
    Watch = require('../watch.js'),
    Forum,
    Post,

    Error = require('../error.js'),

    Async = require('async'),
    Serialize = require('../serializer.js');


var TopicSchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    
    name: String,
    
    forum: {type: String, ref: 'Forum'},
    
    posts: {type: [{type: ObjectId, ref: 'Post'}], default: []},
    postCount: Number,
    
    views: {type: Number, default: 0},
    
    authors: {type: [{type: String, ref: 'User'}], default: []},
    
    modified: {type: Date, default: Date.now}
}, {collection: 'ATopic'});

TopicSchema.plugin(Watch.updateHooks);

TopicSchema.statics.create = function (cb) {
    cb(null, new Topic({}));
};

TopicSchema.pre('save', function (cb) {
    this.postCount = this.posts.length;
    if (this.before && (String(this.before.modified) !== String(this.modified))) {
        var self = this;
        Forum.findById(this.forum, function (err, forum) {
            forum.bumpTopic(self);
            forum.save(cb);
        });
    } else {
        cb();
    }
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
TopicSchema.methods.addPost = function (post) {
    this.posts.push(post._id);
    if (this.posts.length === 1) {
        post.isHead = true;
    }
    post.topic = this._id;

};
TopicSchema.methods.getPosts = function (offset, length, cb) {
    this.populate('posts', function (err, self) {
        cb(self.posts.slice(offset, offset + length));
    });
};
var Topic = module.exports = mongoose.model('Topic', TopicSchema);

/**
 * Queries information about a topic.
 *
 * @param {unsigned} request$id  a client-generated request ID
 * @param {objectId} topic$id    the forum ID
 *
 * @return {Topic}
 */
Client.listener.on('forums.topic', function (client, packet, promise) {
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
            promise.reject(Error.notFound);
        }
    });
});

Client.listener.on('forums.topic.add', function (client, packet, promise) {
    var self = client;
    if (!client.user) {
        return promise.reject(Error.notAllowed);
    }
    Forum.findById(packet.forum$id, function (err, forum) {
        if (!forum) {
            return promise.reject(Error.notFound);
        }
        var topic, post;
        Async.parallel([
            Topic.create,
            Post.create
        ],
        function (err, results) {
            var topic = results[0];
            forum.addTopic(topic);
            var post = results[1];
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
    });
});

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
Client.listener.on('forums.topics', function (client, packet, promise) {
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
            promise.reject(Error.notFound);
        }
    });
});

Client.listener.on('watch.topic', function (client, packet, promise) {
    client.unwatchAll();
    var schema = {
        forum$id: 'forum',
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
            return promise.reject(Error.notFound);
        }
        topic.views++;
        topic.save(function (err) {
            topic.getPosts(packet.offset || 0, 20, function (posts) {
                promise.fulfill({
                    $: 'result',
                    result: Serialize(topic, schema)
                });
                client.watch(Watch.watch('Topic', {_id: packet.topic$id}, schema, function (id, changes) {
                    client.sendPacket({
                        $: 'update',
                        data: changes
                    });
                }));
            });
        });
    });
});

Forum = require('./forum.js');
Post = require('./post.js');