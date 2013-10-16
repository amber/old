var HTTP = require('http');

function request(options, cb) {
    var headers = {
        "Cookie": 'csrftoken=a;',
        "X-CSRFToken": 'a'
    };
    if (options.body) {
        headers['Content-Length'] = options.body.length
    }
    if (options.sessionId) {
        headers['Cookie'] += ' sessionid=' + options.sessionId + ';'
    }

    var req = HTTP.request({
        hostname: 'scratch.mit.edu',
        port: 80,
        path: options.path,
        method: options.method || 'GET',
        headers: headers
    }, function (res) {
        res.setEncoding('utf8');
        var body = '';
        res.on('data', function (chunk) {
            body += chunk;
        });
        res.on('end', function () {
            cb(body, res);
        });
    });

    req.on('error', function(e) {
        console.warn('problem with request: ' + e.message);
    });

    if (options.body) {
        req.write(options.body);
    }
    req.end();
};

function parseCookie(cookie) {
    var cookies = {};
    var each = cookie.split(';');
    var i = each.length;
    while (i--) {
        if (each[i].indexOf('=') === -1) {
            continue;
        }
        var pair = each[i].split('=');
        cookies[pair[0].trim()] = pair[1].trim();
    }
    return cookies;
}

function User(options) {
    this.username = options.username;
    this.id = options.id;
    this.sessionId = options.sessionId;
}

User.prototype = {
    setBackpack: function (backpack, cb) {
        request({
            path: '/internalapi/backpack/' + this.username + '/set/',
            method: 'POST',
            sessionId: this.sessionId,
            body: JSON.stringify(backpack)
        }, function (body) {
            cb(body);
        });
    },
    setProject: function (id, project, cb) {
        request({
            path: '/internalapi/project/' + id + '/set/',
            method: 'POST',
            sessionId: this.sessionId,
            body: JSON.stringify(project)
        }, function (body) {
            cb(body);
        });
    }
};

module.exports = function (username, password, cb) {
    request({
        path: '/login/',
        method: 'POST',
        body: JSON.stringify({username: username, password: password})
    }, function (body, res) {
        var r = JSON.parse(body)[0];
        if (r.msg) {
            return cb(new Error('Incorrect credentials'), null);
        }
        var id = r.id;
        var session = parseCookie(res.headers['set-cookie'][0]).sessionid;
        request({
            path: '/api/v1/user/' + id + '/?format=json'
        }, function (body, res) {
            cb(null, new User({
                username: JSON.parse(body).username,
                id: id,
                sessionId: session
            }));
        });
    });
};