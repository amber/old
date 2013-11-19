var mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId,
    Watch = require('./watch.js'),
    Topic = require('./forum/topic.js'),

    Async = require('async');


var CollectionSchema = Schema({
    _id: {type: ObjectId, auto: true},

    name: String,
    created: {type: Date, default: Date.now},
    modified: {type: Date, default: Date.now},

    description: [{
        body: {type: String},
        author: {type: String, ref: 'User'},
        date: {type: Date, default: Date.now}
    }],

    projects: [{type: ObjectId, ref: 'Project'}],
    projectCount: Number,

    curators: [{
        user: {type: String, ref: 'User'},
        permission: {type: String, enum: ['curator', 'owner']}
    }],
    
    topic: {type: ObjectId, ref: 'Topic'}
}, {collection: 'ACollection'});

CollectionSchema.plugin(Watch.updateHooks);

CollectionSchema.statics.create = function (cb) {
    var collection = new Collection({});
    Async.series([
        function (cb) {
            Topic.create(function (err, t) {
                collection.topic = t;
                t.save(cb);
            });
        }
    ], function () {
        cb(null, collection);
    });
};

CollectionSchema.methods.addCurator = function (user, permission) {
    this.curators.push({
        user: user,
        permission: permission
    })
};

CollectionSchema.methods.addProject = function (user, project) {
    if (this.can(user, 'add')) {
        this.projects.push(project);
        return true;
    }
    return false;
};

CollectionSchema.methods.can = function (user, action) {
    for (var i = 0; i < this.curators.length; i++) {
        if (user._id === this.curators[i].user) {
            var perms = {
                owner: {
                    add: true,
                    remove: true,
                    edit: true,
                    manage: true
                },
                curator: {
                    add: true,
                    remove: false,
                    edit: false,
                    manage: false
                }
            }
            return !!perms[this.curators[i].permission][action];
        }
    }
    return false;
};

var Collection = module.exports = mongoose.model('Collection', CollectionSchema);