var Crypto = require('crypto'),
    FS = require('fs');

var dir = 'assets/';
exports.set = function(data, cb) {
    var hash = Crypto.createHash('sha256').update(data).digest("hex");
    var path = dir + hash;
    FS.exists(path, function (exists) {
        if (!exists) {
            FS.writeFile(path, data, null, function (err) {
                cb(hash);
            });
        } else {
            cb(hash);
        }
    });
};
exports.get = function(hash, cb) {
    FS.readFile(dir + hash, null, function (err, data) {
        cb(err ? null : data);
    });
};