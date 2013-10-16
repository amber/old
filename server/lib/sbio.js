var sb = require('./sb.js').sb;
var assets = require('./assets.js');

var refactoring = (function () {
    function s(property, value) {
        return ['setVar:to:', {$: property}, value];
    }
    function c(property, value) {
        return ['changeVar:by:', {$: property}, value];
    }
    function r(property) {
        return ['readVariable', {$: property}];
    }

    return {
        'timerReset': function (block) {return s('timer', 0);},
        'timer': function (block) {return r('timer');},
        
        'costumeIndex': function (block) {return r('costume #');},
        
        'changeXposBy:': function (block) {return c('x position', block[1]);},
        'changeYposBy:': function (block) {return c('y position', block[1]);},
        'xpos': function (block) {return r('x position');},
        'ypos': function (block) {return r('y position');},
        'xpos:': function (block) {return s('x position', block[1]);},
        'ypos:': function (block) {return s('y position', block[1]);},
        
        'heading:': function (block) {return s('direction', block[1]);},
        'heading': function (block) {return r('direction');},
        
        'setGraphicEffect:to:': function (block) {return s(block[1] + ' effect', block[2]);},
        'changeGraphicEffect:by:': function (block) {return c(block[1] + ' effect', block[2]);},
        
        'setVolumeTo:': function (block) {return s('volume', block[1]);},
        'volume': function (block) {return r('volume');},
        
        'mousePressed': function (block) {return r('mouse down?');},
        'mouseX': function (block) {return r('mouse x');},
        'mouseY': function (block) {return r('mouse y');},
        
        'setSizeTo:': function (block) {return s('size', block[1]);},
        'changeSizeBy:': function (block) {return c('size', block[1]);},
        'size': function (block) {return r('size');},
        
        'doReturn': function (block) {return ['stopScripts', {$: 'this script'}];},
        'stopAll': function (block) {return ['stopScripts', {$: 'all'}]},
        
        'penColor:': function (block) {return s('pen color', block[1]);},
        'penSize:': function (block) {return s('pen size', block[1]);},
        'setPenHueTo:': function (block) {return s('pen hue', block[1]);},
        'setPenShadeTo:': function (block) {return s('pen lightness', block[1]);},
    };
}) ();

var c = {
    project: function (obj) {
        var authors = {};
        var name = 'Untitled';
        var created = Date.now();
        obj.info.history.split('\r').forEach(function(l) {
            var match = /(\d+-\d+-\d+ \d+:\d+:\d+)\t(\w*)\t(\w*)\t(\w*)/.exec(l);
            if (match[2] === 'share' && match[3]) {
                created = Date.parse(match[1]);
                authors[match[4]] = true;
            }
            name = match[3];
        });
        return [{
            created: created,
            authors: Object.keys(authors),
            name: name,
            notes: obj.info.comment.replace(/\r/g, '\n'),
            stage: c.stage(obj.stage)
        }, c.form(obj.info.thumbnail)];
    },
    stage: function (obj) {
        return {
            children: obj.children.filter(function (child) { // TODO: Watchers
                return child.objName;
            }).map(function (child) {
                return c.sprite(child);
            }),
            scripts: obj.scripts.map(function (script) {
                return c.script(script);
            }),
            costumes: obj.costumes.map(function (costume) {
                return c.costume(costume);
            }),
            currentCostumeIndex: obj.currentCostumeIndex,
            sounds: obj.sounds.map(function (sound) {
                return c.sound(sound);
            }),
            tempo: obj.tempoBPM,
            volume: obj.volume,
            variables: obj.variables.map(function (obj) { // TODO: Lists
                return {
                    name: obj.name,
                    value: obj.value
                };
            })
        };
    },
    sprite: function (obj) {
        return {
            objName: obj.objName,
            scripts: obj.scripts.map(c.script),
            costumes: obj.costumes.map(c.costume),
            currentCostumeIndex: obj.currentCostumeIndex,
            sounds: obj.sounds.map(c.sound),
            x: obj.scratchX,
            y: obj.scratchY,
            direction: obj.direction,
            rotationStyle: obj.rotationStyle,
            isDraggable: obj.isDraggable,
            volume: obj.volume,
            scale: obj.scale,
            visible: obj.visible,
            variables: obj.variables.map(function (obj) { // TODO: Lists
                return {
                    name: obj.name,
                    value: obj.value
                };
            })
        };
    },
    costume: function (obj) {
        return {
            name: obj.name,
            rotationCenterX: obj.rotationCenterX,
            rotationCenterY: obj.rotationCenterY,
            hash: c.form(obj.image)
        };
    },
    sound: function (obj) { // TODO: Sounds
        return {
            name: obj.name,
            hash: null // c.sound(obj.sound)
        };
    },
    form: function (obj) {
        return assets.set(obj.toBuffer());
    },
    script: function (obj) {
        return [
            obj[0],
            obj[1],
            obj[2].map(function (block) {
                return c.block(block);
            })
        ];
    },
    block: function (obj) {
        if (refactoring[obj[0]]) {
            obj = refactoring[obj[0]](obj);
        }
        return obj.map(function (arg) {
            if (Array.isArray(arg)) {
                return arg.map(function (block) {
                    if (Array.isArray(block)) {
                        return c.block(block);
                    } else {
                        return block;
                    }
                });
            }
            return arg;
        });
    }
};

exports.fromSB = function (data, callback) {
    var project = new sb.Project(data);
    project.open(function (success) {
        if (success) {
            callback(c.project(project));
        }
    })
};
