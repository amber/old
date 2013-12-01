var mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    ObjectId = Schema.ObjectId,
    Client = require('./client.js'),
    Watch = require('./watch.js'),
    Topic = require('./forum/topic.js'),

    Error = require('./error.js'),

    Async = require('async');

var defaultProject = '14c7903ef24d4aa4c1c6bb625d2fa05bc3b52e3cc975b23e407451367c5451b1';

var ProjectSchema = Schema({
    _id: {type: ObjectId, auto: true},

    name: {type: String, default: 'Untitled'},
    authors: [{type: String, ref: 'User'}],
    created: {type: Date, default: Date.now},
    modified: Date,

    thumbnail: String, // TODO: Default thumbnail
    
    notes: {type: String, default: ''},
    tags: {type: [{type: ObjectId, ref: 'Tag'}], default: []},
    
    collections: {type: [{type: ObjectId, ref: 'Collection'}], default: []},
    
    topic: {type: ObjectId, ref: 'Topic'},
    
    versions: {type: [{
        asset: String,
        date: {type: Date, default: Date.now}
    }], default: [{
        asset: defaultProject //TODO: Default project asset
    }]},

    views: {type: Number, default: 0},
    lovers: {type: [{type: String, ref: 'User'}], default: []},
    loves: Number,
    parent: {type: ObjectId, ref: 'Project'},
    children: {type: [{type: ObjectId, ref: 'Collection'}], default: []}
}, {collection: 'AProject'});

ProjectSchema.plugin(Watch.updateHooks);

ProjectSchema.statics.create = function (cb) {
    var topic;
    Async.parallel([
        function (cb) {
            Topic.create(function (err, t) {
                topic = t;
                t.save(cb);
            });
        }
    ],
    function (err) {
        cb(null, new Project({
            topic: topic
        }));
    });
};

ProjectSchema.pre('save', function (cb) {
    this.loves = this.lovers.length;
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
        latest: this.newest.asset,
        modified: this.newest.date,
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
var Project = module.exports = mongoose.model('Project', ProjectSchema);

/**
 * Queries information about a project.
 *
 * @param {objectId} project$id  the project ID
 *
 * @return {Project}
 */
Client.listener.on('project', function (client, packet, promise) {
    Project.findById(packet.project$id, function (err, project) {
        if (!project) {
            return promise.reject(Error.notFound);
        }
        promise.fulfill({
            $: 'result',
            result: project.serialize()
        });
    });
});

/**
 * Toggles whether the user loves the given project.
 *
 * @param {objectId} project$id  the project
 *
 * @return {boolean}
 */
Client.listener.on('project.love', function (client, packet, promise) {
    if (!client.user) {
        return promise.reject(Error.notAllowed);
    }
    client.user.toggleLoveProject(packet.project$id, function (love) {
        if (love === null) {
            return promise.reject(Error.notFound);
        }
        promise.fulfill({
            $: 'result'
        });
    });
});

Client.listener.on('project.create', function (client, packet, promise) {
    if (!client.user) {
        return promise.reject(Error.notAllowed);
    }
    var project;
    Async.series([
        function (cb) {
            Project.create(function (err, p) {
                project = p;
                project.authors.push(client.user);
                cb();
            });
        },
        function (cb) {
            client.user.populate('projects', cb)
        },
        function (cb) {
            client.user.projects.addProject(client.user, project);
            client.user.projects.save(cb);
        },
        function (cb) {
            project.save(cb);
        }
    ], function () {
        promise.fulfill({
            $: 'result',
            result: project._id
        });
    });
});

/**
 * Queries the total number of Amber projects.
 *
 * @return {unsigned}
 */
Client.listener.on('projects.count', function (client, packet, promise) {
    Project.count(function (err, count) {
        promise.fulfill({
            $: 'result',
            result: count
        });
    });
});


var TagSchema = Schema({
    _id: String,
    versions: [{
        date: {type: Date, default: Date.now},
        description: String
    }],
    description: String
}, {collection: 'ATag'});
TagSchema.plugin(Watch.updateHooks);
var Tag = Project.Tag = mongoose.model('Tag', TagSchema);


/*function extend(base) {
    [].slice.call(arguments, 1).forEach(function (ex) {
        for (var key in ex) {
            if (ex.hasOwnProperty(key)) {
                base[key] = ex[key];
            }
        }
    });
}

function arrayToJSON(array) {
    return array.map(function (object) {
        return (object && typeof object.arrayToJSON === 'function') ? object.arrayToJSON() : object;
    });
}

function Project(data, id) {
    this.id = id;
    if (data) {
        this.created = new Date(data.created);
        this.authors = data.authors;
        this.name = data.name;
        this.notes = data.notes;
    } else {
        this.created = new Date();
        this.authors = [];
        this.name = 'Project';
        this.notes = 'This is an Amber project.';
    }

    //this.sbjs = project;
    //this.stage = new Stage(project.stage);
}

extend(Project.prototype, {
    toJSON: function () {
        return {
            created: this.created.getTime(),
            authors: this.authors,
            name: this.name,
            notes: this.notes
        };
    },
    serialize: function () {
        return {
            name: this.name,
            notes: this.notes,
            stage: this.stage.serialize()
        };
    },
    updateProject: function () {
        this.sbjs.stage = this.stage.save();
    }
});

function Stage(stage) {
    this.id = objects.sprites.add(this);

    this.objName = 'Stage';
    this.children = [];
    this.scripts = [];
    this.costumes = [];
    this.costumeIndex = 1;
    this.sounds = [];
    this.tempo = 60;
    this.volume = 100;
    this.variables = [];
}

extend(Stage.prototype, {
    toJSON: function () {
        return {
            children: arrayToJSON(this.children),
            scripts: arrayToJSON(this.scripts),
            costumes: arrayToJSON(this.costumes),
            currentCostumeIndex: this.costumeIndex,
            sounds: arrayToJSON(this.sounds),
            tempo: this.tempo,
            volume: this.volume,
            variables: this.variables
        };
    }
});


function Sprite(sprite) {
    this.id = objects.sprites.add(this);

    this.objName = 'Sprite1';
    this.scripts = [];
    this.costumes = [];
    this.currentCostumeIndex = 1;
    this.sounds = [];
    this.scratchX = 0;
    this.scratchY = 0;
    this.direction = 90;
    this.rotationStyle = 'normal';
    this.isDraggable = false;
    this.volume = 100;
    this.scale = 1;
    this.visible = true;
    this.variables = [];
}

extend(Sprite.prototype, {
    toJSON: function () {
        return {
            objName: this.objName,
            scripts: arrayToJSON(this.scripts),
            costumes: arrayToJSON(this.costumes),
            currentCostumeIndex: this.currentCostumeIndex,
            sounds: arrayToJSON(this.sounds),
            scratchX: this.scratchX,
            scratchY: this.scratchX,
            direction: this.direction,
            rotationStyle: this.rotationStyle,
            isDraggable: this.isDraggable,
            volume: this.volume,
            scale: this.scale,
            visible: this.visible,
            variables: this.variables
        };
    }
});

function ImageMedia(media) {
    this.name = 'costume1';
    var self = this;
    this.rotationCenterX = media.rotationCenterX;
    this.rotationCenterY = media.rotationCenterY;
}

extend(ImageMedia.prototype, {
    serialize: function () {
        return {
            id: this.id,
            name: this.name,
            hash: this.hash,
            rotationCenterX: this.rotationCenterX,
            rotationCenterY: this.rotationCenterY
        };
    },
    save: function () {
        return {
            costumeName: this.name,
            rotationCenterX: this.rotationCenterX,
            rotationCenterY: this.rotationCenterY,
            image: this.image
        };
    }
});

function Script(stack, object, is2format) {
    if (arguments.length === 0) {
        return;
    }
    this.parent = object;
    if (object) {
        object.scripts.push(this);
    }
    if (is2format) {
        this.x = stack[0];
        this.y = stack[1];
        this.stack = new Stack(stack[2], this, is2format);
    } else {
        this.setStack(stack);
    }
}

Script.fromSerial = function (data, parent) {
    var script = Object.create(Script.prototype);
    script.x = data[0];
    script.y = data[1];
    script.setStack(Stack.fromSerial(data[2]));
    script.parent = parent;
    return script;
};

extend(Script.prototype, {
    isScript: true,
    serialize: function () {
        return [
            this.x,
            this.y,
            this.stack.serialize()
        ];
    },
    save: function () {
        return [
            this.x,
            this.y,
            this.stack.save()
        ];
    },
    setStack: function (stack) {
        this.stack = stack;
        if (this.stack) {
            this.stack.setParent(this);
        }
    },
    remove: function () {
        var i = this.parent.scripts.indexOf(this);
        if (i === -1) {
            console.warn('Parent does not contain script.');
        } else {
            this.parent.scripts.splice(i, 1);
        }
    }
});

function Stack(blocks, parent, is2format) {
    if (arguments.length === 0) {
        return;
    }
    this.setParent(parent);
    if (is2format) {
        var self = this;
        this.blocks = [];
        blocks.forEach(function (block) {
            if (Array.isArray(block)) {
                self.blocks.push(new Block(block, self, is2format));
            }
        });
    } else {
        this.setBlocks(blocks);
    }
}

Stack.fromSerial = function (data) {
    var stack = Object.create(Stack.prototype);
    stack.setBlocks(data.map(function (block) {
        return Block.fromSerial(block);
    }));
    return stack;
};

extend(Stack.prototype, {
    isStack: true,
    serialize: function () {
        return serializeArray(this.blocks);
    },
    save: function () {
        return saveArray(this.blocks);
    },
    setBlocks: function (blocks) {
        this.blocks = blocks;
        if (this.blocks) {
            var self = this;
            this.blocks.forEach(function (block) {
                block.setParent(self);
            });
        }
    },
    setParent: function (parent) {
        this.parent = parent;
    },
    getScript: function () {
        return this.parent ? (this.parent.isScript ? this.parent : this.parent.getScript()) : null;
    },
    split: function (target) {
        var i = target.isBlock ? this.blocks.indexOf(target) : target;
        if (i === -1) {
            console.warn('Stack does not contain target.');
        }
        return new Stack(this.blocks.splice(i, this.blocks.length), null);
    },
    append: function (stack) {
        this.setBlocks(this.blocks.concat(stack.blocks));
    },
    insert: function (stack, target) {
        var i = this.blocks.indexOf(target);
        if (i === -1) {
            console.warn('Stack does not contain target.');
        }
        this.setBlocks(this.blocks.slice(0, i).concat(stack.blocks).concat(this.blocks.slice(i, this.blocks.length)));
    }
});

var cBlocks = {
    doRepeat: [1],
    doUntil: [1],
    doForever: [0],
    doIf: [1],
    doIfElse: [1, 2]
};


function Block(block, parent, is2format) {
    if (arguments.length === 0) {
        return;
    }
    if (is2format && this.toAmber[block[0]]) {
        block = this.toAmber[block[0]].call(this, block);
    }
    this.parent = parent;
    this.id = objects.blocks.add(this);
    this.selector = block[is2format ? 0 : 1];

    this.args = block.slice(is2format ? 1 : 2);
    var i = this.args.length;
    while (i--) {
        if (Array.isArray(this.args[i])) {
            if (cBlocks[this.selector] && cBlocks[this.selector].indexOf(i) !== -1) {
                this.args[i] = new Stack(this.args[i], this, is2format);
            } else {
                this.args[i] = new Block(this.args[i], this, is2format);
            }
        }
    }
}

Block.fromSerial = function (data) {
    var block = Object.create(Block.prototype);
    block.selector = data[1];
    block.args = [];
    var special = cBlocks[block.selector] || [];
    data.slice(2).forEach(function (arg, i) {
        block.setArg(i, special.indexOf(i) === -1 ? (Array.isArray(arg) ? Block.fromSerial(arg) : arg) : Stack.fromSerial(arg || []));
    });
    block.id = objects.blocks.add(block);
    return block;
};

extend(Block.prototype, {
    isBlock: true,
    serialize: function () {
        return [
            this.id,
            this.selector
        ].concat(serializeArray(this.args.map(function (arg) {
            return Array.isArray(arg) && arg.length === 0 ? null : arg;
        })));
    },
    save: function () {
        var self = this;

        if (this.selector === 'readVariable' && this.args[0].$ && this.fromAmber.get[this.args[0].$]) {
            return [this.fromAmber.get[this.args[0].$]];
        }

        var relative = this.selector === 'changeVar:by:';
        if ((relative || this.selector === 'setVar:to:') && this.args[0].$) {
            var format = this.fromAmber[relative ? 'change' : 'set'][this.args[0].$];
            if (format) {
                return saveArray(format.map(function (part) {
                    return typeof part === 'string' ? part : self.args[part];
                }));
            }
        }

        return [this.selector].concat(saveArray(this.args.map(function (arg) {
            return (arg && arg.$) ? arg.$ : arg;
        })));
    },
    getScript: function () {
        return this.parent.getScript();
    },
    setParent: function (parent) {
        this.parent = parent;
    },
    setArg: function (arg, value) {
        if (value.isStack || value.isBlock) {
            value.setParent(this);
        }
        this.args[arg] = value;
    },
    move: function (x, y) {
        var script = this.getScript();
        var object = script.parent;
        if (this.parent.isBlock || this.parent.isStack) {
            if (script && script.stack.blocks[0] === this) {
                script.x = x;
                script.y = y;
            } else {
                var newScript = new Script(this.breakOff(), object);
                newScript.x = x;
                newScript.y = y;
                newScript.stack.setParent(newScript);
            }
        }
    },
    breakOff: function () {
        if (this.parent.isBlock) {
            this.parent.resetArg(this);
            return new Stack([this], null);
        }
        if (this.parent.isStack) {
            var script = this.getScript();
            if (script && script.stack.blocks[0] === this) {
                script.remove();
                return script.stack;
            }
            return this.parent.split(this);
        }
        console.warn('Parent is not block or stack.');
    },
    remove: function () {
        this.breakOff();
    },
    resetArg: function (block) {
        // TODO: Default arg
        this.args[this.args.indexOf(block)] = 'blah blah blah';
    },

    customSetter: function (relative, property, value) {
        return [relative ? 'changeVar:by:' : 'setVar:to:', {$: property}, value];
    },
    customReader: function (property) {
        return ['readVariable', {$: property}];
    },

    toAmber:  {
        'timerReset': function (block) {return this.customSetter(false, 'timer', 0);},
        'timer': function (block) {return this.customReader('timer');},

        'costumeIndex': function (block) {return this.customReader('costume #');},

        'changeXposBy:': function (block) {return this.customSetter(true, 'x position', block[1]);},
        'changeYposBy:': function (block) {return this.customSetter(true, 'y position', block[1]);},
        'xpos': function (block) {return this.customReader('x position');},
        'ypos': function (block) {return this.customReader('y position');},
        'xpos:': function (block) {return this.customSetter(false, 'x position', block[1]);},
        'ypos:': function (block) {return this.customSetter(false, 'y position', block[1]);},

        'heading:': function (block) {return this.customSetter(false, 'direction', block[1]);},
        'heading': function (block) {return this.customReader('direction');},

        'setGraphicEffect:to:': function (block) {return this.customSetter(false, block[1] + ' effect', block[2]);},
        'changeGraphicEffect:by:': function (block) {return this.customSetter(true, block[1] + ' effect', block[2]);},

        'setVolumeTo:': function (block) {return this.customSetter(false, 'volume', block[1]);},
        'volume': function (block) {return this.customReader('volume');},

        'mousePressed': function (block) {return this.customReader('mouse down?');},
        'mouseX': function (block) {return this.customReader('mouse x');},
        'mouseY': function (block) {return this.customReader('mouse y');},

        'setSizeTo:': function (block) {return this.customSetter(false, 'size', block[1]);},
        'changeSizeBy:': function (block) {return this.customSetter(true, 'size', block[1]);},
        'size': function (block) {return this.customReader('size');},

        'doReturn': function (block) {return ['stopScripts', {$: 'this script'}];},
        'stopAll': function (block) {return ['stopScripts', {$: 'all'}];},

        'penColor:': function (block) {return this.customSetter(false, 'pen color', block[1]);},
        'penSize:': function (block) {return this.customSetter(false, 'pen size', block[1]);},
        'setPenHueTo:': function (block) {return this.customSetter(false, 'pen hue', block[1]);},
        'setPenShadeTo:': function (block) {return this.customSetter(false, 'pen lightness', block[1]);}
    },
    fromAmber: {
        get: {
            'x position': 'xpos',
            'y position': 'ypos',
            'direction': 'heading',

            'costume #': 'costumeIndex',
            'size': 'size',

            'timer': 'timer',

            'volume': 'volume',
            'mouse down?': 'mousePressed',
            'mouse x': 'mouseX',
            'mouse y': 'mouseY'
        },
        set: {
            'x position': ['xpos:', 1],
            'y position': ['ypos:', 1],
            'direction': ['heading:', 1],

            'color effect': ['setGraphicEffect:to:', 'color', 1],
            'fisheye effect': ['setGraphicEffect:to:', 'fisheye', 1],
            'whirl effect': ['setGraphicEffect:to:', 'whirl', 1],
            'pixelate effect': ['setGraphicEffect:to:', 'pixelate', 1],
            'mosaic effect': ['setGraphicEffect:to:', 'mosaic', 1],
            'brightness effect': ['setGraphicEffect:to:', 'brightness', 1],
            'ghost effect': ['setGraphicEffect:to:', 'ghost', 1],
            'size': ['setSizeTo:', 1],

            'volume': ['setVolumeTo:', 1],

            'timer': ['timerReset'],

            'pen color': ['penColor:', 1],
            'pen size': ['penSize:', 1],
            'pen hue': ['setPenHueTo:', 1],
            'pen lightness': ['setPenShadeTo:', 1]
        },
        change: {
            'x position': ['changeXposBy:', 1],
            'y position': ['changeYposBy:', 1],

            'color effect': ['changeGraphicEffect:by:', 'color', 1],
            'fisheye effect': ['changeGraphicEffect:by:', 'fisheye', 1],
            'whirl effect': ['changeGraphicEffect:by:', 'whirl', 1],
            'pixelate effect': ['changeGraphicEffect:by:', 'pixelate', 1],
            'mosaic effect': ['changeGraphicEffect:by:', 'mosaic', 1],
            'brightness effect': ['changeGraphicEffect:by:', 'brightness', 1],
            'ghost effect': ['changeGraphicEffect:by:', 'ghost', 1],
            'size': ['changeSizeBy:', 1]
        }
    }
});*/