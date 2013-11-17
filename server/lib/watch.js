var mongoose = require('mongoose'),
    Async = require('async');

var watchers = {};

var modelParents = {
    Project: 'collection',
    Topic: 'forum',
    Post: 'topic'
};

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
        } else if (typeof v === 'string' && v !== '$') {
            myfields[v] = true;
        } else if (Object.prototype.toString.call(v) === '[object Object]') {
            myfields[field] = v;
            var type = paths[field].options.type.ref,
                q = {};
            q[modelParents[type]] = query._id;
            var c = function() {}; // TODO
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
                    c[field] = [[2, i, changes]]; // change
                    cb(obj._id, c);
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
    return cb;
}

function unwatch(cb) {
    var types = Object.keys(watchers);
    for (var i = 0; i < types.length; i++) {
        var w = watchers[types[i]];
        for (var j = w.length - 1; j >= 0; j--) {
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
    o = o ? o.slice() : [];
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
                steps.push([1, i, n[i]]); // add
                o.splice(i, 0, n[i]);
            } else if (removed[o[i]]) {
                steps.push([3, i]); // remove
                o.splice(i, 1);
            } else {
                var f = indexOf(o, n[i]);
                steps.push([3, f]); // remove
                steps.push([1, i, n[i]]); // add
                var t = o[f];
                o.splice(f, 1);
                o.splice(i, 0, t);
            }
        }
    }
    while (o.length !== n.length) {
        steps.push([3, i]);
        o.splice(i, 1);
    }
    return steps;
}

function modelChanges(model, fields, cb) {
    var changes = {},
        changed = false;
    Async.each(Object.keys(fields), function (field, cb) {
        if (!fields[field]) {
            return cb();
        }
        if (Array.isArray(model[field])) {
            var c = arrayChanges(model.before[field], model[field]);
            if (c.length === 0) {
                return cb();
            }
            changes[field] = c;
            changed = true;
            if (fields[field] === true) {
                return cb();
            }
            Async.each(c, function (step, cb) {
                if (step[0] !== 1) { // if not add
                    return cb();
                }
                mongoose.model(model.schema.paths[field].options.type[0].ref).findById(step[2], function (err, obj) {
                    step[2] = {};
                    Object.keys(fields[field]).forEach(function (f) {
                        step[2][f] = obj[f];
                    });
                    cb();
                });
            }, cb);
        } else {
            var alias;
            if (typeof fields[field] === 'string' && fields[field] !== '$') {
                alias = field;
                field = fields[field];
            } else {
                alias = field;
            }
            
            if (!equals(model[field], model.before[field])) {
                changes[alias] = fields[field] === '$' ? {$: model[field]} : model[field];
                changed = true;
                cb();
            } else {
                cb();
            }
        }
    }, function (err) {
        cb(changed ? changes : null);
    });
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
        var myWatchers = watchers[this.constructor.modelName];
        if (myWatchers) {
            myWatchers.forEach(function (watcher) {
                if (matchesQuery(self, watcher.$query)) {
                    modelChanges(self, watcher.fields, function (changes) {
                        if (changes) {
                            watcher.$cb(self._id, changes);
                        }
                    });
                }
            });
        }
    });
}

exports.updateHooks = updateHooks;