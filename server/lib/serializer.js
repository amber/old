function serialize(object, schema) {
    var out = {};
    for (var field in schema) {
        if (schema[field] === true) {
            out[field] = object[field];
        } else if (typeof schema[field] === 'string') {
            if (schema[field] === '$') {
                out[field] = {$: object[field]};
            } else {
                out[field] = object[schema[field]];
            }
        } else if (Array.isArray(schema[field])) {
            if (Array.isArray(object[field])) {
                var sch = schema[field][0];
                out[field] = object[field].map(function (obj) {
                    return serialize(obj, sch);
                });
            } else {
                throw new Error('Field \'' + field + '\' of ' + object + ' is not an array');
            }
        } else {
            out[field] = serialize(out[field], schema[field]);
        }
    }
    return out;
}

module.exports = serialize;