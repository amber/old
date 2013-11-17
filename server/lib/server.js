var PORT = 8080;

var WebSocket = require('websocket'),
    HTTP = require('http'),
    Express = require('express'),
    Domain = require('domain'),
    Client = require('./client.js'),
    Assets = require('./assets.js'),
    Project = require('./project.js'),

    ForumCategory = require('./forum/forumCategory.js'),
    Forum = require('./forum/forum.js'),
    Topic = require('./forum/topic.js')
    Post = require('./forum/post.js');

var server = Express();
server.use(function(req, res, next) {
    var domain = Domain.create();
    domain.on('error', function(err) {
        res.statusCode = 500;
        res.end(err.message + '\n');

        domain.dispose();
    });
    domain.run(next);
});
server.use(Express.methodOverride());
server.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.send(200);
    } else {
        next();
    }
});
server.get('/api/assets/:hash', function (req, res) {
    Assets.get(req.params.hash, function (data) {
        if (data) {
            res.header('Cache-Control', 'max-age=31557600, public');
        } else {
            res.statusCode = 404;
        }
        res.end(data || '');
    });
});
server.post('/api/assets', function (req, res) {
    var buffers = [];
    req.on('data', function (data) {
        buffers.push(data);
    });
    req.on('end', function () {
        var data = Buffer.concat(buffers);
        Assets.set(data, function (hash) {
            res.end(hash);
        });
    });
});
server.get('/api/projects/:pk', function (req, res) {
    Project.findById(req.params.pk, function (err, project) {
        if (project) {
            project.views++;
            project.save();
            project.load(function (data) {
                res.end(data);
            });
        } else {
            res.statusCode = 404;
            res.end();
        }
    });
});
server.get('/api/projects/:pk/:v', function (req, res) {
    Project.findById(req.params.pk, function (err, project) {
        if (project) {
            project.load(req.params.v, function (data) {
                if (data) {
                    res.statusCode = 200;
                    res.end(JSON.stringify(project.serialize()));
                } else {
                    res.statusCode = 404;
                    res.end();
                }
            });
        } else {
            res.statusCode = 404;
            res.end();
        }
    });
});
server.use('/', Express.static('../client'));

exports.createServer = function () {
    return (new WebSocket.server({
        httpServer: HTTP.createServer(server),
        autoAcceptConnections: false
    }).on('request', function (req) {
        new Client(req.accept('', req.origin));
    })).config.httpServer;
};