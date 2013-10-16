var modules = {
    crypto: require('crypto'),
    fs: require('fs')
}

var assetsDirectory = './assets';

exports.set = function (data, callback) {
    var hash = modules.crypto.createHash('sha256').update(data).digest("hex");
    var path = assetsDirectory + '/' + hash;
    modules.fs.exists(path, function (exists) {
        if (!exists) {
            modules.fs.writeFile(path, data, null, function () {
                callback && callback(hash);
            });
        } else {
            callback && callback(hash);
        }
    });
    return hash;
};

exports.get = function (hash, callback) {
    modules.fs.readFile(assetsDirectory + '/' + hash, null, function (error, data) {
        callback(error ? null : data);
    });
};