//require('longjohn');

require('mongoose').connect('mongodb://localhost/amber');
require('./lib/server.js').createServer().listen(process.env.PORT || 8080);

console.log('Server started.');

///////////////////////

var Async = require('async'),
    Promise = require('mpromise'),
    Watch = require('./lib/watch.js'),
    User = require('./lib/user.js'),
    Project = require('./lib/project.js'),
    Client = require('./lib/client.js');


Client.listener.on('watch.home.signedOut', function (client, packet, promise) {
    client.unwatchAll();
    Async.parallel([
        Project.count.bind(Project, {}),
        Project.query.bind(Project, {}, '-created', 0, 20, ['views']),
        Project.query.bind(Project, {}, '-remixCount', 0, 20, ['remixCount']),
        Project.query.bind(Project, {}, '-loves', 0, 20, ['loves']),
        Project.query.bind(Project, {}, '-views', 0, 20, ['views'])
    ], function (err, results) {
        promise.fulfill({
            $: 'result',
            result: {
                projectCount: results[0],
                featured: results[1],
                topRemixed: results[2],
                topLoved: results[3],
                topViewed: results[4]
            }
        });
    });
});
Client.listener.on('watch.home.signedIn', function (client, packet, promise) {
    client.unwatchAll();
    Async.parallel([
        // activity
        Project.query.bind(Project, {}, '-modified', 0, 20, ['views']),
        Project.query.bind(Project, {authors: {$in: client.user.following}}, '-modified', 0, 20, ['authors']),
        // lovedByFollowing
        Project.query.bind(Project, {}, '-remixCount', 0, 20, ['remixCount']),
        Project.query.bind(Project, {}, '-loves', 0, 20, ['loves']),
        Project.query.bind(Project, {}, '-views', 0, 20, ['views'])
    ], function (err, results) {
        promise.fulfill({
            $: 'result',
            result: {
                activity: [],
                featured: results[0],
                byFollowing: results[1],
                lovedByFollowing: [],
                topRemixed: results[2],
                topLoved: results[3],
                topViewed: results[4]
            }
        });
    });
});


/**
 * Queries the list of featured projects, sorted by date.
 *
 * @param {unsigned} offset      the index at which to start returning results
 * @param {unsigned} length      the number of results to return
 *
 * @return {(subset of Project)[]}
 */
Client.listener.on('projects.featured', function (client, packet, promise) {
    // TODO: Replace with collection view
    Project.find().skip(packet.offset).limit(packet.length).exec(function (err, result) {
        promise.fulfill({
            $: 'result',
            result: result.map(function (p) {
                return {
                    id: p._id,
                    views: p.views,
                    project: {
                        name: p.name,
                        thumbnail: p.thumbnail
                    }
                };
            })
        });
    });
});
/**
 * Queries the list of the most loved projects in the past week, sorted by loves.
 *
 * @param {unsigned} offset      the index at which to start returning results
 * @param {unsigned} length      the number of results to return
 *
 * @return {(subset of Project)[]}
 */
Client.listener.on('projects.topLoved', function (client, packet, promise) {
    Project.find().sort('-loves').skip(packet.offset).limit(packet.length).exec(function (e, result) {
        promise.fulfill({
            $: 'result',
            result: result.map(function (p) {
                return {
                    id: p._id,
                    loves: p.loves,
                    project: {
                        name: p.name,
                        thumbnail: p.thumbnail
                    }
                };
            })
        });
    });
});
/**
 * Queries the list of the most viewed projects in the past week, sorted by loves.
 *
 * @param {unsigned} offset      the index at which to start returning results
 * @param {unsigned} length      the number of results to return
 *
 * @return {(subset of Project)[]}
 */
Client.listener.on('projects.topViewed', function (client, packet, promise) {
    Project.find().sort('-views').skip(packet.offset).limit(packet.length).exec(function (err, result) {
        promise.fulfill({
            $: 'result',
            result: result.map(function (p) {
                return {
                    id: p.id,
                    views: p.views,
                    project: {
                        name: p.name,
                        thumbnail: p.thumbnail
                    }
                };
            })
        });
    });
});
/**
 * Queries the list of the most remixed projects in the past week, sorted by loves.
 *
 * @param {unsigned} offset      the index at which to start returning results
 * @param {unsigned} length      the number of results to return
 *
 * @return {(subset of Project)[]}
 */
Client.listener.on('projects.topRemixed', function (client, packet, promise) {
    Project.find().sort('-remixCount').skip(packet.offset).limit(packet.length).populate('remixes').exec(function (e, result) {
        promise.fulfill({
            $: 'result',
            result: result.map(function (p) {
                return {
                    id: p._id,
                    remixes: p.remixes,
                    project: {
                        name: p.name,
                        thumbnail: p.thumbnail
                    }
                };
            })
        });
    });
});
/**
 * Queries the list of projects recently loved by users the current user is following, sorted by date.
 *
 * @param {unsigned} request$id  a client-generated request ID
 * @param {unsigned} offset      the index at which to start returning results
 * @param {unsigned} length      the number of results to return
 *
 * @return {(subset of Project)[]}
 */
Client.listener.on('projects.lovedByFollowing', function (client, packet, promise) {
    if (!client.user) {
        return promise.reject(Error.notAllowed);
    }
    // TODO
});
/**
 * Queries the list of projects by users the current user is following, sorted by date.
 *
 * @param {unsigned} offset      the index at which to start returning results
 * @param {unsigned} length      the number of results to return
 *
 * @return {(subset of Project)[]}
 */
Client.listener.on('projects.user.byFollowing', function (client, packet, promise) {
    if (client.user) {
        promise.reject(Error.notAllowed);
    }
    Project.find({authors: {$in: client.user.following}}).sort('-modified').skip(packet.offset).limit(packet.length).exec(function (err, projects) {
        promise.fulfill({
            $: 'result',
            result: projects.map(function (p) {
                return {
                    id: p._id,
                    authors: p.authors,
                    project: {
                        name: p.name,
                        thumbnail: p.thumbnail
                    }
                };
            })
        });
    });
});
Client.listener.on('projects.byUser', function (client, packet, promise) {
    Project.find({authors: packet.user}).sort('-modified').skip(packet.offset).limit(packet.length).exec(function (err, result) {
        promise.fulfill({
            $: 'result',
            result: result.map(function (p) {
                return {
                    id: p._id,
                    project: {
                        name: p.name,
                        thumbnail: p.thumbnail
                    }
                };
            })
        });
    });
});