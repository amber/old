var mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId,
    Client = require('../client.js'),
    Watch = require('../watch.js'),
    Topic,

    Error = require('../error.js'),

    Async = require('async');


var PostSchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    topic: {type: ObjectId, ref: 'Topic'},
    authors: {type: [{type: String, ref: 'User'}], default: []},
    isHead: {type: Boolean, default: false},
    versions: [{
        body: {type: String},
        author: {type: String, ref: 'User'},
        date: {type: Date, default: Date.now}
    }],
    children: [{type: ObjectId, ref: 'Post'}], // TODO: ???
    parent: {type: ObjectId, ref: 'Post'} // TODO: ???
}, {collection: 'APost'});

PostSchema.plugin(Watch.updateHooks);

PostSchema.statics.create = function (cb) {
    cb(null, new Post({}));
};

PostSchema.virtual('modified').get(function () {
    if (!this.newest) {
        return null;
    }
    return this.newest.date;
});
PostSchema.virtual('newest').get(function () {
    return this.versions[this.versions.length - 1];
});
PostSchema.virtual('body').get(function () {
    if (!this.newest) {
        return null;
    }
    return this.newest.body;
});
PostSchema.methods.addAuthor = function (author) {
    this.authors.addToSet(author);
};
PostSchema.methods.edit = function (author, body, topic, name) {
    this.versions.push({
        author: author,
        body: body
    });
    this.addAuthor(author);
    if (this.isHead) {
        topic.authors = this.authors;
        if (name) {
            topic.name = name;
        }
    }
    topic.modified = this.modified;
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
var Post = module.exports = mongoose.model('Post', PostSchema);

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
Client.listener.on('forums.posts', function (client, packet, promise) {
    Topic.findById(packet.topic$id).populate('posts').exec(function (err, topic) {
        if (!topic) {
            return promise.reject(Error.notFound);
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
});

Client.listener.on('forums.post.delete', function (client, packet, promise) {
    var self = client;
    Post.findById(packet.post$id, function (err, post) {
        if (!post) {
            return promise.reject(Error.notFound);
        }
        if (post.authors.indexOf(self.user.name) > -1) {
            post.delete(promise.fulfill.bind(promise, {
                $: 'result'
            }));
        } else {
            promise.reject(Error.noUser);
        }
    });
});

Client.listener.on('forums.post.add', function (client, packet, promise) {
    var self = client;
    if (!client.user) {
        return promise.reject(Error.noUser);
    }
    Topic.findById(packet.topic$id, function (err, topic) {
        if (!topic) {
            return promise.reject(Error.notFound);
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
});

Client.listener.on('forums.post.edit', function (client, packet, promise) {
    var self = client;
    Post.findById(packet.post$id).populate('topic').exec(function (err, post) {
        if (!post) {
            return promise.reject(Error.notFound);
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
});

Topic = require('./topic.js');