var sb = require('./sb.js').sb;
var assets = require('./assets.js');

var refactoring = (function () {
    function s(relative, property, value) {
        return [relative ? 'changeVar:by:' : 'setVar:to:', {$: property}, value];
    }
    function r(property) {
        return ['readVariable', {$: property}];
    }

    return {
        'timerReset': function (block) {return s(false, 'timer', 0);},
        'timer': function (block) {return r('timer');},
        
        'costumeIndex': function (block) {return r('costume #');},
        
        'changeXposBy:': function (block) {return s(true, 'x position', block[1]);},
        'changeYposBy:': function (block) {return s(true, 'y position', block[1]);},
        'xpos': function (block) {return r('x position');},
        'ypos': function (block) {return r('y position');},
        'xpos:': function (block) {return s(false, 'x position', block[1]);},
        'ypos:': function (block) {return s(false, 'y position', block[1]);},
        
        'heading:': function (block) {return s(false, 'direction', block[1]);},
        'heading': function (block) {return r('direction');},
        
        'setGraphicEffect:to:': function (block) {return s(false, block[1] + ' effect', block[2]);},
        'changeGraphicEffect:by:': function (block) {return s(true, block[1] + ' effect', block[2]);},
        
        'setVolumeTo:': function (block) {return s(false, 'volume', block[1]);},
        'volume': function (block) {return r('volume');},
        
        'mousePressed': function (block) {return r('mouse down?');},
        'mouseX': function (block) {return r('mouse x');},
        'mouseY': function (block) {return r('mouse y');},
        
        'setSizeTo:': function (block) {return s(false, 'size', block[1]);},
        'changeSizeBy:': function (block) {return s(true, 'size', block[1]);},
        'size': function (block) {return r('size');},
        
        'doReturn': function (block) {return ['stopScripts', {$: 'this script'}];},
        'stopAll': function (block) {return ['stopScripts', {$: 'all'}]},
        
        'penColor:': function (block) {return s(false, 'pen color', block[1]);},
        'penSize:': function (block) {return s(false, 'pen size', block[1]);},
        'setPenHueTo:': function (block) {return s(false, 'pen hue', block[1]);},
        'setPenShadeTo:': function (block) {return s(false, 'pen lightness', block[1]);},
    };
}) ();

var c = {
    project: function (obj) {
        var authors = {};
        var name = 'Untitled';
        var parsed = obj.info.history.trim().split('\r').map(function (e) {
            return e.trim().split('\t');
        });
        parsed.forEach(function(e) {
            if (e[1] === 'share') {
                authors[e[3]] = true;
            }
            name = e[2];
        });
        return [{
            created: Date.parse(parsed[0][0]),
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
            scratchX: obj.scratchX,
            scratchY: obj.scratchY,
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
