'use strict';

function isDiscordSnowflake(value) {
    return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

module.exports = { isDiscordSnowflake };
