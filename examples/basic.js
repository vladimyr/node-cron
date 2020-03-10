'use strict';

const { CronJob } = require('..');

console.log('Before job instantiation');
const job = new CronJob('* * * * * *', () => {
	const d = new Date();
	console.log('Every second:', d);
});
console.log('After job instantiation');
job.start();
