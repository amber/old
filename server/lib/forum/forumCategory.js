var mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId,
    Client = require('../client.js'),
    Watch = require('../watch.js');


var ForumCategorySchema = Schema({
    _id: {type: Schema.ObjectId, auto: true},
    name: String,
    forums: {type: [{type: String, ref: 'Forum'}], default: []}
}, {collection: 'AForumCategory'});

ForumCategorySchema.plugin(Watch.updateHooks);

ForumCategorySchema.statics.create = function (cb) {
    cb(null, new ForumCategory({}));
};

var ForumCategory = module.exports = mongoose.model('ForumCategory', ForumCategorySchema);

/**
 * Queries the categories and forums in the Amber forums.
 *
 * @param {unsigned} request$id  a client-generated request ID
 *
 * @return {ForumCategory[]}
 */
Client.listener.on('forums.categories', function (client, packet, promise) {
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
});