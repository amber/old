var mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId,
    Client = require('../client.js'),
    Watch = require('../watch.js'),
    Error = require('../error.js'),

    Serialize = require('../serializer.js');


var ForumSchema = Schema({
    _id: String,
    name: String,
    description: String,
    topics: {type: [{type: ObjectId, ref: 'Topic'}], default: []}
}, {collection: 'AForum'});

ForumSchema.plugin(Watch.updateHooks);

ForumSchema.statics.create = function (cb) {
    cb(null, new Forum({}));
};

ForumSchema.methods.addTopic = function (topic) {
    this.topics.unshift(topic._id);
    topic.forum = this._id;
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
};
ForumSchema.methods.getTopics = function (offset, length, cb) {
    this.populate('topics', function (err, self) {
        cb(self.topics.slice(offset, offset + length));
    });
};
var Forum = module.exports = mongoose.model('Forum', ForumSchema);

/**
 * Queries information about a forum.
 *
 * @param {unsigned} request$id  a client-generated request ID
 * @param {objectId} forum$id    the forum ID
 *
 * @return {Forum}
 */
Client.listener.on('forums.forum', function (client, packet, promise) {
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
});

Client.listener.on('watch.forum', function (client, packet, promise) {
    client.unwatchAll();
    var self = client;
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
            return promise.reject(Error.notFound);
        }
        forum.getTopics(packet.offset || 0, 20, function (topics) {
            promise.fulfill({
                $: 'result',
                result: Serialize(forum, schema)
            });
            self.watch(Watch.watch('Forum', {_id: packet.forum$id}, schema, function (id, changes) {
                self.sendPacket({
                    $: 'update',
                    data: changes
                });
            }));
        });
    });
});