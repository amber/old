var mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId,
    Watch = require('./watch.js'),
    Client = require('./client.js');


var EventSchema = Schema({
    _id: {type: ObjectId, auto: true},
    date: {type: Date, default: Date.now},
    actor: {type: ObjectId, ref: 'User'},
    action: {type: String, enum: ['follow', 'love', 'share', 'create', 'comment', 'subscribe', 'addProject', 'addCurator', 'addPost', 'addTopic']},
    contentType: {type: String, enum: ['User', 'Project', 'Collection', 'Post', 'ForumTopic']},
    contentUser: {type: ObjectId, ref: 'User'},
    contentProject: {type: ObjectId, ref: 'Project'},
    contentCollection: {type: ObjectId, ref: 'Collection'},
    contentPost: {type: ObjectId, ref: 'Post'},
    contentForumTopic: {type: ObjectId, ref: 'ForumTopic'}
});
EventSchema.plugin(Watch.updateHooks);
var Event = mongoose.model('Event', EventSchema);

var ActivitySchema = Schema({
    events: [Event]
})

var NotificationSchema = Schema({
    event: {type: Date, ref: 'Event'},
    recipient: {type: ObjectId, ref: 'User'},
    isRead: Boolean,
    dateSent: {type: Date}
}, {collection: 'ANotification'});
NotificationSchema.plugin(Watch.updateHooks);
var Notification = exports.Notification = mongoose.model('Notification', NotificationSchema);