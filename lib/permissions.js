module.exports = {
    guest: {
        'forums.post.add': false,

        'forums.post.edit.self': false,
        'forums.post.edit.other': false,

        'forums.post.delete.self': false,
        'forums.post.delete.other': false,
    },
    limited: {
        'forums.post.add': true,

        'forums.post.edit.self': false,
        'forums.post.edit.other': false,

        'forums.post.delete.self': false,
        'forums.post.delete.other': false,
    },
    default: {
        'forums.post.add': true,

        'forums.post.edit.self': true,
        'forums.post.edit.other': false,

        'forums.post.delete.self': true,
        'forums.post.delete.other': false,
    },
    moderator: {
        'forums.post.add': true,

        'forums.post.edit.self': true,
        'forums.post.edit.other': true,

        'forums.post.delete.self': true,
        'forums.post.delete.other': true,
    },
    administrator: {
        'forums.post.add': true,

        'forums.post.edit.self': true,
        'forums.post.edit.other': true,

        'forums.post.delete.self': true,
        'forums.post.delete.other': true,
    }
};