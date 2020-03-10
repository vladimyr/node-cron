'use strict';

const { CronJob } = require('..');

console.log('Before job instantiation');
const job = new CronJob('00 00 00 * * *', () => {
	const d = new Date();
	console.log('Midnight:', d);
});
console.log('After job instantiation');
job.start();
