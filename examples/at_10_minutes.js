'use strict';

const { CronJob } = require('..');

console.log('Before job instantiation');
const job = new CronJob('* 10 * * * *', () => {
	const d = new Date();
	console.log('At Ten Minutes:', d);
});
console.log('After job instantiation');
job.start();
