var mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId,
    Watch = require('./watch.js'),
    Topic = require('./forum/topic.js');


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
        permission: {type: [{type: String, enum: ['add', 'remove', 'owner']}], default: ['add']}
    }],
    
    topic: {type: ObjectId, ref: 'Topic', default: Topic.create}
}, {collection: 'ACollection'});

CollectionSchema.plugin(Watch.updateHooks);

CollectionSchema.statics.create = function (name, user) {
    return new Collection({});
};

CollectionSchema.methods.addCurator = function (user, permission) {
    this.curators.push({
        user: user,
        permission: [permission]
    })
};
var Collection = module.exports = mongoose.model('Collection', CollectionSchema);