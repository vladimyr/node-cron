'use strict';

const { CronJob } = require('..');

console.log('Before job instantiation');
const job = new CronJob('00 30 11 * * 1-5', () => {
	const d = new Date();
	console.log('onTick:', d);
});
console.log('After job instantiation');
job.start();
