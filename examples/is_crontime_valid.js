'use strict';

const { CronJob } = require('..');

try {
	// eslint-disable-next-line no-new
	new CronJob('NOT VALID', () => console.log("shouldn't get printed"));
} catch (e) {
	console.log('omg err', e);
}
